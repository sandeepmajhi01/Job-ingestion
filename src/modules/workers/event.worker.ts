import { randomUUID } from "crypto";
import { Event } from "../../model/event.model.js";
import { Job } from "../../model/job.model.js";
import { verifyJob } from "../provider/provider.service.js";

const WORKER_ID = randomUUID();
const LEASE_DURATION_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1_000;

export async function claimNextEvent() {
  const now = new Date();

  const leaseUntil = new Date(
    now.getTime() + LEASE_DURATION_MS,
  );

  const event = await Event.findOneAndUpdate(
    {
      $or: [
        {
          status: "accepted",
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        },
        {
          status: "processing",
          leaseUntil: { $lte: now },
        },
      ],
    },
    {
      $set: {
        status: "processing",
        claimedBy: WORKER_ID,
        leaseUntil,
      },
      $inc: {
        attempts: 1,
      },
    },
    {
     
  sort: { createdAt: 1 },
  returnDocument: "after",
    },
  );

  return event;
}

export async function processNextEvent(): Promise<void> {
  const event = await claimNextEvent();

  if (!event) {
    return;
  }

  const attemptStartedAt = new Date();

  try {
    const currentJob = await Job.findOne({
      tenantId: event.tenantId,
      sourceId: event.sourceId,
      externalJobId: event.externalJobId,
    });

    // Ignore stale or already-applied versions.
    if (currentJob && event.version <= currentJob.version) {
      await Event.updateOne(
        { _id: event._id },
        {
          $set: {
            status: "completed",
            processedAt: new Date(),
          },
          $push: {
            attemptHistory: {
              attempt: event.attempts,
              startedAt: attemptStartedAt,
              finishedAt: new Date(),
              outcome: "success",
            },
          },
          $unset: {
            leaseUntil: 1,
            claimedBy: 1,
          },
        },
      );

      return;
    }

    // Verify with external provider.
    const providerResult = await verifyJob(
      event.eventId,
      event.attempts,
    );

    // Retryable provider failure: 429 or 503.
    if (providerResult.status === "retryable") {
      const finishedAt = new Date();

      if (event.attempts >= MAX_ATTEMPTS) {
        await Event.updateOne(
          { _id: event._id },
          {
            $set: {
              status: "failed",
              lastError: providerResult.message,
            },
            $push: {
              attemptHistory: {
                attempt: event.attempts,
                startedAt: attemptStartedAt,
                finishedAt,
                outcome: "retryable",
                error: providerResult.message,
              },
            },
            $unset: {
              leaseUntil: 1,
              claimedBy: 1,
            },
          },
        );

        return;
      }

      const backoffMs =
        BACKOFF_BASE_MS * 2 ** (event.attempts - 1);

      await Event.updateOne(
  { _id: event._id },
  {
    $set: {
      status: "completed",
      processedAt: new Date(),
    },
    $push: {
      attemptHistory: {
        attempt: event.attempts,
        startedAt: attemptStartedAt,
        finishedAt: new Date(),
        outcome: "success",
      },
    },
    $unset: {
      leaseUntil: 1,
      claimedBy: 1,
      nextAttemptAt: 1,
      lastError: 1,
    },
  },
);

      return;
    }

    // Permanent provider failure: 422.
    if (providerResult.status === "permanent") {
      await Event.updateOne(
        { _id: event._id },
        {
          $set: {
            status: "failed",
            lastError: providerResult.message,
          },
          $push: {
            attemptHistory: {
              attempt: event.attempts,
              startedAt: attemptStartedAt,
              finishedAt: new Date(),
              outcome: "permanent",
              error: providerResult.message,
            },
          },
          $unset: {
            leaseUntil: 1,
            claimedBy: 1,
          },
        },
      );

      return;
    }

    // Provider succeeded.
    if (event.operation === "upsert") {
      await Job.findOneAndUpdate(
        {
          tenantId: event.tenantId,
          sourceId: event.sourceId,
          externalJobId: event.externalJobId,
          $or: [
            { version: { $lt: event.version } },
            { version: { $exists: false } },
          ],
        },
        {
          $set: {
            tenantId: event.tenantId,
            sourceId: event.sourceId,
            externalJobId: event.externalJobId,
            version: event.version,
            status: "active",
            payload: event.payload,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );
    }

    // Archive the job.
    if (event.operation === "archive") {
      await Job.findOneAndUpdate(
        {
          tenantId: event.tenantId,
          sourceId: event.sourceId,
          externalJobId: event.externalJobId,
          $or: [
            { version: { $lt: event.version } },
            { version: { $exists: false } },
          ],
        },
        {
          $set: {
            tenantId: event.tenantId,
            sourceId: event.sourceId,
            externalJobId: event.externalJobId,
            version: event.version,
            status: "archived",
          },
          $unset: {
            payload: 1,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );
    }

    // Mark event as completed.
    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          status: "completed",
          processedAt: new Date(),
        },
        $push: {
          attemptHistory: {
            attempt: event.attempts,
            startedAt: attemptStartedAt,
            finishedAt: new Date(),
            outcome: "success",
          },
        },
        $unset: {
          leaseUntil: 1,
          claimedBy: 1,
          nextAttemptAt: 1,
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown processing error";

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          status: "failed",
          lastError: message,
        },
        $push: {
          attemptHistory: {
            attempt: event.attempts,
            startedAt: attemptStartedAt,
            finishedAt: new Date(),
            outcome: "permanent",
            error: message,
          },
        },
        $unset: {
          leaseUntil: 1,
          claimedBy: 1,
        },
      },
    );
  }
}
