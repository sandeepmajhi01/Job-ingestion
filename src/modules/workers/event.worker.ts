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

  const completeEvent = async (
    outcome: "success" | "retryable" | "permanent",
    error?: string,
  ): Promise<void> => {
    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          status: outcome === "success" ? "completed" : "failed",
          processedAt:
            outcome === "success" ? new Date() : undefined,
          ...(error ? { lastError: error } : {}),
        },
        $push: {
          attemptHistory: {
            attempt: event.attempts,
            startedAt: attemptStartedAt,
            finishedAt: new Date(),
            outcome,
            ...(error ? { error } : {}),
          },
        },
        $unset: {
          leaseUntil: 1,
          claimedBy: 1,
          nextAttemptAt: 1,
        },
      },
    );
  };

  try {
    const currentJob = await Job.findOne({
      tenantId: event.tenantId,
      sourceId: event.sourceId,
      externalJobId: event.externalJobId,
    });

    // Ignore stale or already-applied versions.
    if (currentJob && event.version <= currentJob.version) {
      await completeEvent("success");
      return;
    }

    // Verify with provider.
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
              nextAttemptAt: 1,
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
            status: "accepted",
            nextAttemptAt: new Date(
              Date.now() + backoffMs,
            ),
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
            nextAttemptAt: 1,
          },
        },
      );

      return;
    }

    // Provider succeeded.
    if (event.operation === "upsert") {
      try {
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
            returnDocument: "after",
          },
        );
      } catch (error: unknown) {
        /*
         * Concurrent first-write race.
         *
         * Another worker may have created the same job between
         * our initial read and this upsert.
         */
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000
        ) {
          const existingJob = await Job.findOne({
            tenantId: event.tenantId,
            sourceId: event.sourceId,
            externalJobId: event.externalJobId,
          });

          if (!existingJob) {
            throw error;
          }

          /*
           * Another worker already installed an equal or newer
           * version. Therefore this event is stale and can safely
           * complete.
           */
          if (existingJob.version >= event.version) {
            await completeEvent("success");
            return;
          }

          /*
           * The existing document has a lower version.
           * Retry the conditional update without upsert.
           */
          await Job.findOneAndUpdate(
            {
              tenantId: event.tenantId,
              sourceId: event.sourceId,
              externalJobId: event.externalJobId,
              version: {
                $lt: event.version,
              },
            },
            {
              $set: {
                version: event.version,
                status: "active",
                payload: event.payload,
              },
            },
            {
              returnDocument: "after",
            },
          );
        } else {
          throw error;
        }
      }
    }

    // Archive the job.
    if (event.operation === "archive") {
      try {
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
            returnDocument: "after",
          },
        );
      } catch (error: unknown) {
        /*
         * Same first-write race handling for archive events.
         */
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000
        ) {
          const existingJob = await Job.findOne({
            tenantId: event.tenantId,
            sourceId: event.sourceId,
            externalJobId: event.externalJobId,
          });

          if (!existingJob) {
            throw error;
          }

          if (existingJob.version >= event.version) {
            await completeEvent("success");
            return;
          }

          await Job.findOneAndUpdate(
            {
              tenantId: event.tenantId,
              sourceId: event.sourceId,
              externalJobId: event.externalJobId,
              version: {
                $lt: event.version,
              },
            },
            {
              $set: {
                version: event.version,
                status: "archived",
              },
              $unset: {
                payload: 1,
              },
            },
            {
              returnDocument: "after",
            },
          );
        } else {
          throw error;
        }
      }
    }

    // Mark event as completed.
    await completeEvent("success");
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
          nextAttemptAt: 1,
        },
      },
    );
  }
}
