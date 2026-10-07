import { performance } from "node:perf_hooks";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5000";

const LOAD_TENANT = `load-test-${Date.now()}`;
const LOAD_SOURCE = "load-source";

const DISTINCT_EVENTS = 1000;
const REPLAYS = 200;
const OUT_OF_ORDER_JOBS = 50;

const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 50);

type EventPayload = {
  tenantId: string;
  sourceId: string;
  eventId: string;
  externalJobId: string;
  version: number;
  operation: "upsert";
  payload: {
    title: string;
    company: string;
    location: string;
    experienceMin: number;
    experienceMax: number;
    applyUrl: string;
    skills: string[];
  };
};

type RequestResult = {
  status: number;
  latencyMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePayload(
  eventId: string,
  externalJobId: string,
  version: number,
): EventPayload {
  return {
    tenantId: LOAD_TENANT,
    sourceId: LOAD_SOURCE,
    eventId,
    externalJobId,
    version,
    operation: "upsert",
    payload: {
      title: `Load Test Engineer ${externalJobId}`,
      company: "Load Test Company",
      location: "Pune",
      experienceMin: 1,
      experienceMax: 5,
      applyUrl: `https://example.com/jobs/${externalJobId}/${version}`,
      skills: ["Node.js", "MongoDB", "TypeScript"],
    },
  };
}

async function postEvent(event: EventPayload): Promise<RequestResult> {
  const started = performance.now();

  const response = await fetch(`${BASE_URL}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  return {
    status: response.status,
    latencyMs: performance.now() - started,
  };
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) {
        return;
      }

      await task(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );

  await Promise.all(workers);
}

function percentile(values: number[], percentage: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentage / 100) * sorted.length) - 1,
  );

  return sorted[index];
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // API is not ready yet.
    }

    await sleep(500);
  }

  throw new Error(`API did not become healthy within 30 seconds: ${BASE_URL}`);
}

async function getJobsPage(cursor?: string): Promise<{
  jobs: Array<{
    externalJobId: string;
    version: number;
    status: string;
  }>;
  nextCursor: string | null;
}> {
  const params = new URLSearchParams({
    tenantId: LOAD_TENANT,
    sourceId: LOAD_SOURCE,
    status: "active",
    limit: "100",
  });

  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(`${BASE_URL}/jobs?${params.toString()}`);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`GET /jobs failed: ${response.status} ${body}`);
  }

  return response.json() as Promise<{
    jobs: Array<{
      externalJobId: string;
      version: number;
      status: string;
    }>;
    nextCursor: string | null;
  }>;
}

async function getAllJobs(): Promise<
  Array<{
    externalJobId: string;
    version: number;
    status: string;
  }>
> {
  const jobs: Array<{
    externalJobId: string;
    version: number;
    status: string;
  }> = [];

  let cursor: string | undefined;

  while (true) {
    const page = await getJobsPage(cursor);

    jobs.push(...page.jobs);

    if (!page.nextCursor) {
      break;
    }

    cursor = page.nextCursor;
  }

  return jobs;
}

async function waitForFinalState(
  expectedJobCount: number,
  timeoutMs = 300_000,
): Promise<{
  jobs: Array<{
    externalJobId: string;
    version: number;
    status: string;
  }>;
  drainMs: number;
}> {
  const started = performance.now();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const jobs = await getAllJobs();

    if (jobs.length === expectedJobCount) {
      const versionedJobs = jobs.filter((job) =>
        job.externalJobId.startsWith("versioned-job-"),
      );

      const allVersionedJobsAtV3 =
        versionedJobs.length === OUT_OF_ORDER_JOBS &&
        versionedJobs.every((job) => job.version === 3);

      if (allVersionedJobsAtV3) {
        return {
          jobs,
          drainMs: performance.now() - started,
        };
      }
    }

    await sleep(500);
  }

  const jobs = await getAllJobs();

  throw new Error(
    `Timed out waiting for final state. ` +
      `Expected ${expectedJobCount} jobs, found ${jobs.length}.`,
  );
}

function buildDistinctEvents(): EventPayload[] {
  const events: EventPayload[] = [];

  /*
   * 50 jobs × 3 versions = 150 events.
   * 850 additional single-version jobs = 850 events.
   *
   * Total = 1000 distinct events.
   */

  for (let job = 1; job <= OUT_OF_ORDER_JOBS; job += 1) {
    const externalJobId = `versioned-job-${job}`;

    // Deliberately submit out of order: v3, v1, v2.
    events.push(makePayload(`versioned-${job}-v3`, externalJobId, 3));

    events.push(makePayload(`versioned-${job}-v1`, externalJobId, 1));

    events.push(makePayload(`versioned-${job}-v2`, externalJobId, 2));
  }

  const remainingEvents = DISTINCT_EVENTS - events.length;

  for (let index = 1; index <= remainingEvents; index += 1) {
    const externalJobId = `single-job-${index}`;

    events.push(makePayload(`single-event-${index}`, externalJobId, 1));
  }

  if (events.length !== DISTINCT_EVENTS) {
    throw new Error(
      `Internal test generation error: expected ${DISTINCT_EVENTS} events, got ${events.length}`,
    );
  }

  return events;
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" Job Ingestion Load Test");
  console.log("========================================");
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`Tenant:   ${LOAD_TENANT}`);
  console.log(`Source:   ${LOAD_SOURCE}`);
  console.log(`Events:   ${DISTINCT_EVENTS}`);
  console.log(`Replays:  ${REPLAYS}`);
  console.log(`Workers:  ${CONCURRENCY}`);
  console.log("");

  await waitForHealth();

  console.log("API health: OK");

  const events = buildDistinctEvents();

  const results: RequestResult[] = [];

  const submissionStarted = performance.now();

  await runConcurrent(events, CONCURRENCY, async (event) => {
    const result = await postEvent(event);
    results.push(result);
  });

  const submissionMs = performance.now() - submissionStarted;

  const accepted = results.filter((result) => result.status === 202).length;

  const errors = results.filter((result) => result.status >= 400).length;

  console.log("");
  console.log("Distinct event submission complete");
  console.log(`Accepted: ${accepted}`);
  console.log(`Errors:   ${errors}`);
  console.log(
    `HTTP p50: ${percentile(
      results.map((result) => result.latencyMs),
      50,
    ).toFixed(2)} ms`,
  );
  console.log(
    `HTTP p95: ${percentile(
      results.map((result) => result.latencyMs),
      95,
    ).toFixed(2)} ms`,
  );
  console.log(`Submission duration: ${submissionMs.toFixed(2)} ms`);

  if (accepted !== DISTINCT_EVENTS) {
    throw new Error(
      `Expected ${DISTINCT_EVENTS} accepted events, got ${accepted}`,
    );
  }

  if (errors !== 0) {
    throw new Error(
      `Unexpected HTTP errors during distinct event submission: ${errors}`,
    );
  }

  /*
   * Exact replay phase.
   *
   * These requests reuse the exact same event identities
   * and exact same content.
   *
   * Expected result:
   * 200 for all 200 requests.
   */

  const replayEvents = events.slice(0, REPLAYS);
  const replayResults: RequestResult[] = [];

  const replayStarted = performance.now();

  await runConcurrent(replayEvents, CONCURRENCY, async (event) => {
    const result = await postEvent(event);
    replayResults.push(result);
  });

  const replayMs = performance.now() - replayStarted;

  const replayCount = replayResults.filter(
    (result) => result.status === 200,
  ).length;

  const replayErrors = replayResults.filter(
    (result) => result.status !== 200,
  ).length;

  console.log("");
  console.log("Replay phase complete");
  console.log(`Replay 200 responses: ${replayCount}`);
  console.log(`Replay errors:        ${replayErrors}`);
  console.log(
    `Replay p50: ${percentile(
      replayResults.map((result) => result.latencyMs),
      50,
    ).toFixed(2)} ms`,
  );
  console.log(
    `Replay p95: ${percentile(
      replayResults.map((result) => result.latencyMs),
      95,
    ).toFixed(2)} ms`,
  );
  console.log(`Replay duration: ${replayMs.toFixed(2)} ms`);

  if (replayCount !== REPLAYS) {
    throw new Error(`Expected ${REPLAYS} replay responses, got ${replayCount}`);
  }

  /*
   * Wait until the asynchronous workers finish processing
   * all 900 logical job projections.
   */

  console.log("");
  console.log("Waiting for workers to drain the queue...");

  const { jobs, drainMs } = await waitForFinalState(900);

  const versionedJobs = jobs.filter((job) =>
    job.externalJobId.startsWith("versioned-job-"),
  );

  const incorrectVersions = versionedJobs.filter((job) => job.version !== 3);

  console.log("");
  console.log("Final projection");
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Versioned jobs: ${versionedJobs.length}`);
  console.log(
    `Versioned jobs at v3: ${versionedJobs.length - incorrectVersions.length}`,
  );
  console.log(`Queue drain duration: ${drainMs.toFixed(2)} ms`);

  if (jobs.length !== 900) {
    throw new Error(`Expected 900 logical jobs, got ${jobs.length}`);
  }

  if (versionedJobs.length !== OUT_OF_ORDER_JOBS) {
    throw new Error(
      `Expected ${OUT_OF_ORDER_JOBS} versioned jobs, got ${versionedJobs.length}`,
    );
  }

  if (incorrectVersions.length > 0) {
    throw new Error(
      `Version safety failure: ${incorrectVersions.length} versioned jobs did not finish at v3`,
    );
  }

  /*
   * Final summary.
   */

  console.log("");
  console.log("========================================");
  console.log(" LOAD TEST PASSED");
  console.log("========================================");
  console.log(`Distinct events:   ${DISTINCT_EVENTS}`);
  console.log(`Accepted:          ${accepted}`);
  console.log(`Exact replays:     ${REPLAYS}`);
  console.log(`Replay 200s:       ${replayCount}`);
  console.log(`HTTP errors:       ${errors + replayErrors}`);
  console.log(`Logical jobs:      ${jobs.length}`);
  console.log(`Out-of-order jobs: ${versionedJobs.length}`);
  console.log(
    `Final v3 jobs:     ${versionedJobs.length - incorrectVersions.length}`,
  );
  console.log(`Submission time:   ${submissionMs.toFixed(2)} ms`);
  console.log(`Queue drain time:  ${drainMs.toFixed(2)} ms`);
  console.log("========================================");
  console.log("");
}

main().catch((error: unknown) => {
  console.error("");
  console.error("LOAD TEST FAILED");
  console.error(error);
  process.exit(1);
});
