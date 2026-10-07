# Design

## 1. Overview

This project implements a reliable job-feed ingestion service using:

- Node.js
- TypeScript with strict mode
- Express
- MongoDB
- Mongoose
- Docker Compose

The service accepts job-feed events through an HTTP API, durably records them in MongoDB, and processes them asynchronously using competing worker loops.

The runnable core does not require Redis, Kafka, or another external queue.

---

## 2. Architecture

The main flow is:

```text
Provider / Client
       |
       | POST /events
       v
   Express API
       |
       | validate + replay check
       v
    MongoDB
       |
       | durable Event work item
       v
  Worker 1 / Worker 2
       |
       | provider verification
       v
   Job Projection
```

The HTTP request does not synchronously execute the complete job-processing workflow.

An accepted event is first durably persisted in MongoDB. The API then returns `202 Accepted`.

Workers continuously search for available events and atomically claim them for processing.

---

## 3. Event Identity

An event is uniquely identified by:

```text
(tenantId, sourceId, eventId)
```

A unique MongoDB index enforces this identity.

If the same event identity is submitted again:

- equivalent content returns `200`
- different content returns `409`

Invalid events are rejected before the event identity is persisted, allowing the same ID to be reused after correcting the request.

---

## 4. Job Identity

A job is uniquely identified by:

```text
(tenantId, sourceId, externalJobId)
```

The Job collection contains the current projection for each job.

A unique MongoDB index prevents duplicate job projections for the same tenant, source, and external job.

---

## 5. Validation and Normalization

The API validates incoming events using Zod.

Validation includes:

- required identifiers
- rejection of surrounding whitespace in identifiers
- positive safe-integer versions
- supported operations
- required payload for `upsert`
- absence of payload for `archive`
- non-empty title/company/location
- experience range between 0 and 50
- `experienceMin <= experienceMax`
- HTTPS application URL
- non-empty skills

Display strings are trimmed.

Skills are:

1. trimmed
2. converted to lowercase
3. deduplicated
4. kept in their first-seen order

---

## 6. Replay Safety

Replay detection happens before treating an event as new work.

The comparison canonicalizes JSON objects by sorting their keys recursively.

Arrays are not sorted.

Therefore:

```json
{"title":"A","company":"B"}
```

and:

```json
{"company":"B","title":"A"}
```

are equivalent.

However:

```json
["node.js", "mongodb"]
```

and:

```json
["mongodb", "node.js"]
```

are different.

This matches the assignment requirement that JSON object key order is ignored while array order remains significant.

---

## 7. Durable Acceptance

The API returns `202 Accepted` only after the event has been persisted to MongoDB.

The persisted Event document is also the durable work item.

This means the service does not depend on in-process memory to remember accepted work.

If the application process terminates after acceptance, the event remains in MongoDB and can be processed after restart.

---

## 8. Event Processing

Each event contains processing state including:

- `status`
- `attempts`
- `claimedBy`
- `leaseUntil`
- `nextAttemptAt`
- `processedAt`
- `attemptHistory`
- `lastError`

The processing states are:

```text
accepted
   |
   v
processing
   |
   +----> completed
   |
   +----> accepted (retry)
   |
   +----> failed
```

---

## 9. Worker Claiming

Workers claim events using MongoDB's atomic `findOneAndUpdate()` operation.

The claim changes the event from an available state to:

```text
status = processing
claimedBy = worker ID
leaseUntil = current time + lease duration
attempts = attempts + 1
```

Because the claim is atomic, two workers cannot successfully claim the same available event at the same time.

Two worker loops are started by the application.

---

## 10. Lease and Recovery

Each processing claim has a 30-second lease.

If a worker disappears after claiming an event, the event remains durable in MongoDB with:

```text
status = processing
leaseUntil < current time
```

Another worker can then reclaim the event.

This prevents abandoned work from remaining permanently stuck.

Crash recovery was manually verified by:

1. creating an event
2. claiming it
3. leaving it in `processing`
4. allowing the lease to expire
5. restarting workers
6. observing the event being reclaimed and completed

The system does not claim exactly-once execution. A crash can cause processing to be attempted again. Version guards and idempotent projection updates provide correctness across such reprocessing.

---

## 11. Version Safety

The current job projection is controlled by the greatest successfully processed version.

A worker checks the existing job version before processing.

If:

```text
incoming version <= current job version
```

the event is treated as stale and does not overwrite the projection.

For an accepted newer version, the job update itself also requires the stored version to be lower than the incoming version.

This protects against out-of-order worker completion.

Example:

```text
v3 arrives
v2 arrives

v3 becomes current
v2 cannot overwrite v3
```

---

## 12. Archive Semantics

An archive operation creates or updates the job projection to:

```text
status = archived
version = event.version
```

The payload is removed.

An archive may therefore arrive before an upsert.

Example:

```text
archive v5
upsert v4
```

The job remains archived at version 5 because version 4 is stale.

A later:

```text
upsert v6
```

can replace the archived projection.

---

## 13. Provider Verification

Provider verification is simulated using:

```text
fixtures/provider-plan.json
```

The default provider result is success.

Supported provider responses
