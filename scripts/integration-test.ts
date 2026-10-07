import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Event } from "../src/model/event.model.js";
import { Job } from "../src/model/job.model.js";

const MONGO_URI =
  process.env.MONGO_URI ??
  "mongodb://localhost:27017/job-service";

const TEST_TENANT = `integration-${Date.now()}`;
const TEST_SOURCE = "integration-source";

function logPass(message: string): void {
  console.log(`PASS  ${message}`);
}

function logSection(message: string): void {
  console.log("");
  console.log(`=== ${message} ===`);
}

async function connect(): Promise<void> {
  await mongoose.connect(MONGO_URI);

  await Promise.all([
    Event.init(),
    Job.init(),
  ]);
}

async function cleanup(): Promise<void> {
  await Event.deleteMany({
    tenantId: {
      $in: [
        TEST_TENANT,
        `${TEST_TENANT}-other`,
      ],
    },
  });

  await Job.deleteMany({
    tenantId: {
      $in: [
        TEST_TENANT,
        `${TEST_TENANT}-other`,
      ],
    },
  });
}

async function testEventUniqueIndex(): Promise<void> {
  logSection("Event unique identity");

  const event = {
    tenantId: TEST_TENANT,
    sourceId: TEST_SOURCE,
    eventId: "unique-event",
    externalJobId: "unique-job",
    version: 1,
    operation: "upsert" as const,
    payload: {
      title: "Backend Engineer",
      company: "Integration Test",
      location: "Pune",
      experienceMin: 1,
      experienceMax: 5,
      applyUrl: "https://example.com/jobs/unique",
      skills: ["node.js"],
    },
  };

  await Event.create(event);

  let duplicateRejected = false;

  try {
    await Event.create(event);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      duplicateRejected = true;
    } else {
      throw error;
    }
  }

  assert.equal(
    duplicateRejected,
    true,
    "duplicate event identity must be rejected",
  );

  logPass(
    "MongoDB rejects duplicate (tenantId, sourceId, eventId)",
  );
}

async function testTenantSourceIsolation(): Promise<void> {
  logSection("Tenant/source isolation");

  const tenantA = TEST_TENANT;
  const tenantB = `${TEST_TENANT}-other`;

  await Event.create({
    tenantId: tenantA,
    sourceId: TEST_SOURCE,
    eventId: "same-event-id",
    externalJobId: "same-job-id",
    version: 1,
    operation: "upsert",
    payload: {
      title: "Tenant A Job",
      company: "Tenant A",
      location: "Pune",
      experienceMin: 1,
      experienceMax: 2,
      applyUrl: "https://example.com/a",
      skills: ["node.js"],
    },
  });

  await Event.create({
    tenantId: tenantB,
    sourceId: TEST_SOURCE,
    eventId: "same-event-id",
    externalJobId: "same-job-id",
    version: 1,
    operation: "upsert",
    payload: {
      title: "Tenant B Job",
      company: "Tenant B",
      location: "Mumbai",
      experienceMin: 1,
      experienceMax: 2,
      applyUrl: "https://example.com/b",
      skills: ["typescript"],
    },
  });

  const tenantAEvent = await Event.findOne({
    tenantId: tenantA,
    sourceId: TEST_SOURCE,
    eventId: "same-event-id",
  });

  const tenantBEvent = await Event.findOne({
    tenantId: tenantB,
    sourceId: TEST_SOURCE,
    eventId: "same-event-id",
  });

  assert.equal(tenantAEvent?.payload?.title, "Tenant A Job");
  assert.equal(tenantBEvent?.payload?.title, "Tenant B Job");

  logPass(
    "Same event identity is isolated across tenants",
  );
}

async function testJobUniqueIndex(): Promise<void> {
  logSection("Job unique identity");

  const job = {
    tenantId: TEST_TENANT,
    sourceId: TEST_SOURCE,
    externalJobId: "unique-job",
    version: 1,
    status: "active" as const,
    payload: {
      title: "Unique Job",
      company: "Integration Test",
      location: "Pune",
      experienceMin: 1,
      experienceMax: 3,
      applyUrl: "https://example.com/job",
      skills: ["mongodb"],
    },
  };

  await Job.create(job);

  let duplicateRejected = false;

  try {
    await Job.create(job);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      duplicateRejected = true;
    } else {
      throw error;
    }
  }

  assert.equal(
    duplicateRejected,
    true,
    "duplicate job identity must be rejected",
  );

  logPass(
    "MongoDB rejects duplicate (tenantId, sourceId, externalJobId)",
  );
}

async function testVersionRace(): Promise<void> {
  logSection("Version race");

  const externalJobId = "version-race-job";

  await Job.create({
    tenantId: TEST_TENANT,
    sourceId: TEST_SOURCE,
    externalJobId,
    version: 1,
    status: "active",
    payload: {
      title: "Version 1",
      company: "Race Test",
      location: "Pune",
      experienceMin: 1,
      experienceMax: 2,
      applyUrl: "https://example.com/v1",
      skills: ["node.js"],
    },
  });

  const applyVersion = async (
    version: number,
    title: string,
  ): Promise<void> => {
    await Job.findOneAndUpdate(
      {
        tenantId: TEST_TENANT,
        sourceId: TEST_SOURCE,
        externalJobId,
        version: {
          $lt: version,
        },
      },
      {
        $set: {
          version,
          status: "active",
          payload: {
            title,
            company: "Race Test",
            location: "Pune",
            experienceMin: 1,
            experienceMax: 5,
            applyUrl: `https://example.com/v${version}`,
            skills: ["node.js"],
          },
        },
      },
      {
        returnDocument: "after",
      },
    );
  };

  /*
   * These operations intentionally complete concurrently.
   *
   * MongoDB's conditional update prevents a lower version
   * from overwriting a greater version.
   */
  await Promise.all([
    applyVersion(2, "Version 2"),
    applyVersion(3, "Version 3"),
  ]);

  const finalJob = await Job.findOne({
    tenantId: TEST_TENANT,
    sourceId: TEST_SOURCE,
    externalJobId,
  });

  assert.ok(finalJob);
  assert.equal(
    finalJob.version,
    3,
    "highest version must win",
  );

  assert.equal(
    finalJob.payload?.title,
    "Version 3",
  );

  logPass(
    "Concurrent version updates leave the highest version as current state",
  );
}

async function testAtomicClaimAndRecovery(): Promise<void> {
  logSection("Atomic claim and lease recovery");

  const eventId = "claim-recovery-event";

  await Event.create({
    tenantId: TEST_TENANT,
    sourceId: TEST_SOURCE,
    eventId,
    externalJobId: "claim-recovery-job",
    version: 1,
    operation: "upsert",
    payload: {
      title: "Claim Recovery Job",
      company: "Recovery Test",
      location: "Pune",
      experienceMin: 1,
      experienceMax: 3,
      applyUrl: "https://example.com/recovery",
      skills: ["node.js"],
    },
    status: "accepted",
    attempts: 0,
  });

  const now = new Date();
  const leaseUntil = new Date(
    now.getTime() + 30_000,
  );

  const firstClaim = await Event.findOneAndUpdate(
    {
      tenantId: TEST_TENANT,
      sourceId: TEST_SOURCE,
      eventId,
      status: "accepted",
      $or: [
        {
          nextAttemptAt: {
            $exists: false,
          },
        },
        {
          nextAttemptAt: {
            $lte: now,
          },
        },
      ],
    },
    {
      $set: {
        status: "processing",
        claimedBy: "integration-worker-1",
        leaseUntil,
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      returnDocument: "after",
    },
  );

  assert.ok(
    firstClaim,
    "first worker should claim the event",
  );

  const secondClaim = await Event.findOneAndUpdate(
    {
      tenantId: TEST_TENANT,
      sourceId: TEST_SOURCE,
      eventId,
      status: "accepted",
    },
    {
      $set: {
        status: "processing",
        claimedBy: "integration-worker-2",
        leaseUntil,
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      returnDocument: "after",
    },
  );

  assert.equal(
    secondClaim,
    null,
    "second worker must not claim an actively leased event",
  );

  /*
   * Simulate worker crash/abandonment by expiring the lease.
   */
  await Event.updateOne(
    {
      tenantId: TEST_TENANT,
      sourceId: TEST_SOURCE,
      eventId,
    },
    {
      $set: {
        leaseUntil: new Date(Date.now() - 1_000),
      },
    },
  );

  const recoveredClaim = await Event.findOneAndUpdate(
    {
      tenantId: TEST_TENANT,
      sourceId: TEST_SOURCE,
      eventId,
      status: "processing",
      leaseUntil: {
        $lte: new Date(),
      },
    },
    {
      $set: {
        status: "processing",
        claimedBy: "integration-worker-2",
        leaseUntil: new Date(
          Date.now() + 30_000,
        ),
      },
      $inc: {
        attempts: 1,
      },
    },
    {
      returnDocument: "after",
    },
  );

  assert.ok(
    recoveredClaim,
    "expired work must be recoverable",
  );

  assert.equal(
    recoveredClaim.attempts,
    2,
    "recovery should represent the second processing attempt",
  );

  assert.equal(
    recoveredClaim.claimedBy,
    "integration-worker-2",
  );

  logPass(
    "Active lease prevents duplicate claim and expired lease enables recovery",
  );
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" MongoDB Integration Test");
  console.log("========================================");
  console.log(`MongoDB: ${MONGO_URI}`);
  console.log(`Tenant:  ${TEST_TENANT}`);
  console.log("");

  try {
    await connect();
    console.log("MongoDB connection: OK");

    await cleanup();

    await testEventUniqueIndex();
    await testTenantSourceIsolation();
    await testJobUniqueIndex();
    await testVersionRace();
    await testAtomicClaimAndRecovery();

    console.log("");
    console.log("========================================");
    console.log(" INTEGRATION TEST PASSED");
    console.log("========================================");
    console.log("");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("");
  console.error("INTEGRATION TEST FAILED");
  console.error(error);
  process.exit(1);
});
