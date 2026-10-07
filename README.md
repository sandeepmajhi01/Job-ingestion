# Reliable Job Feed Ingestion Service

A durable, replay-safe job-feed ingestion service built with Node.js, TypeScript, Express, MongoDB and Docker Compose.

The service accepts job events, durably records them, processes them asynchronously using competing workers, verifies jobs against a provider fixture, retries transient failures, and maintains a version-safe current job projection.

## Architecture

```text
Provider
   |
   | POST /events
   v
+-------------------+
| Express API       |
| Validation        |
| Replay detection  |
+---------+---------+
          |
          | durable write
          v
+-------------------+
| MongoDB           |
|                   |
| events            |
| jobs              |
+---------+---------+
          |
          | claim
          v
+-------------------+
| Worker 1          |
| Worker 2          |
|                   |
| lease + retry     |
| provider verify   |
| version check     |
+---------+---------+
          |
          v
    Current Job State
```

There is deliberately no Redis, Kafka or external queue in the runnable core. MongoDB provides the durable event/work state and current job projection.

## Requirements

- Node.js 22+
- Docker
- Docker Compose
- npm

## Project Structure

```text
job-service/
├── fixtures/
│   └── provider-plan.json
├── scripts/
│   ├── integration-test.ts
│   └── load-test.ts
├── src/
│   ├── config/
│   │   └── database.ts
│   ├── model/
│   │   ├── event.model.ts
│   │   └── job.model.ts
│   ├── modules/
│   │   ├── events/
│   │   │   ├── event.controller.ts
│   │   │   ├── event.routes.ts
│   │   │   ├── event.service.ts
│   │   │   └── event.validation.ts
│   │   ├── jobs/
│   │   │   ├── job.controller.ts
│   │   │   └── job.routes.ts
│   │   └── provider/
│   │       └── provider.service.ts
│   ├── worker/
│   │   ├── event.worker.ts
│   │   └── worker.loop.ts
│   ├── app.ts
│   └── server.ts
├── .env.example
├── docker-compose.yml
├── package.json
├── package-lock.json
├── DESIGN.md
├── SCALE.md
├── AI_USAGE.md
└── QC_REPORT.md
```

## Setup

Clone the repository:

```bash
git clone https://github.com/sandeepmajhi01/Job-ingestion.git
cd Job-ingestion
```

Install dependencies:

```bash
npm install
```

Create the environment file:

```bash
copy .env.example .env
```

On Linux/macOS:

```bash
cp .env.example .env
```

Start MongoDB:

```bash
docker compose up -d
```

Check MongoDB:

```bash
docker compose ps
```

Build the TypeScript project:

```bash
npm run build
```

## Environment

Example `.env`:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/job-service
```

The application uses MongoDB as the durable store.

## Run the API and Workers

Development:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

The server starts:

```text
http://localhost:5000
```

Two worker loops run inside the application process and compete for accepted events using MongoDB leases.

## Health Check

```bash
curl http://localhost:5000/health
```

Expected:

```json
{
  "message": "API Gateway is running 🚀"
}
```

## API

### POST /events

Creates a durable event.

Example:

```bash
curl -X POST http://localhost:5000/events ^
  -H "Content-Type: application/json" ^
  -d "{\"tenantId\":\"tenant-1\",\"sourceId\":\"source-1\",\"eventId\":\"event-1\",\"externalJobId\":\"job-1\",\"version\":1,\"operation\":\"upsert\",\"payload\":{\"title\":\"Backend Engineer\",\"company\":\"Acme\",\"location\":\"Pune\",\"experienceMin\":2,\"experienceMax\":5,\"applyUrl\":\"https://example.com/jobs/1\",\"skills\":[\"Node.js\",\"MongoDB\",\"node.js\"]}}"
```

The first accepted request returns:

```text
202 Accepted
```

An exact replay returns:

```text
200 OK
```

The same event identity with different content returns:

```text
409 Conflict
```

Invalid input returns:

```text
400 Bad Request
```

### GET /events/:eventId

Example:

```text
GET /events/event-1?tenantId=tenant-1&sourceId=source-1
```

Returns acceptance and processing information including:

- event identity
- status
- attempts
- attempt history
- last error
- processing timestamps

### GET /jobs

Example:

```text
GET /jobs?tenantId=tenant-1&sourceId=source-1
```

Defaults to active jobs.

Pagination:

```text
GET /jobs?tenantId=tenant-1&sourceId=source-1&limit=20&cursor=<cursor>
```

Archived jobs:

```text
GET /jobs?tenantId=tenant-1&sourceId=source-1&status=archived
```

The page size is capped and pagination is deterministic.

## Event Validation

Identifiers:

- `tenantId`
- `sourceId`
- `eventId`
- `externalJobId`

must be non-empty and cannot contain surrounding whitespace.

`version` must be a positive safe integer.

For `upsert`:

- payload is required
- title/company/location must be non-blank
- experience values must be integers between 0 and 50
- `experienceMin <= experienceMax`
- apply URL must use HTTPS
- skills must contain non-blank strings
- skills are trimmed
- skills are lowercased
- duplicate skills are removed while preserving first occurrence

For `archive`:

```text
payload must not be supplied
```

## Replay Safety

Event identity:

```text
(tenantId, sourceId, eventId)
```

Job identity:

```text
(tenantId, sourceId, externalJobId)
```

The event identity has a unique MongoDB index.

Equivalent JSON payloads are considered the same even when object key order differs.

For example:

```json
{
  "title": "Backend Engineer",
  "company": "Acme"
}
```

and:

```json
{
  "company": "Acme",
  "title": "Backend Engineer"
}
```

are equivalent.

Array order remains significant.

An exact replay does not create another work item.

A conflicting request using an existing event identity returns `409`.

## Version Safety

The current job projection only advances when an incoming event has a greater version.

Example:

```text
v1 -> active
v3 -> active
v2 -> ignored as stale
```

Therefore delivery order and worker completion order do not determine the final state.

The highest successfully processed version determines the current job.

Archive events are also versioned.

An archive received before an upsert can create a versioned tombstone.

## Workers

The service runs two competing worker loops.

Workers use MongoDB to:

1. find an accepted event
2. atomically claim it
3. increment its attempt count
4. create a lease
5. verify the event with the provider fixture
6. update the current job projection
7. mark the event completed

If a worker stops after claiming an event, its lease eventually expires and another worker can recover the event.

There is no durable work state stored only in memory.

## Provider Retry Behaviour

Provider behaviour is controlled by:

```text
fixtures/provider-plan.json
```

Example:

```json
{
  "default": "success",
  "events": {
    "event-retry": ["503", "429", "success"],
    "event-permanent": ["422"],
    "event-exhaustion": ["503", "503", "503"]
  }
}
```

Behaviour:

```text
200/success -> complete
422         -> permanent failure
429/503     -> retryable
```

Normal maximum:

```text
3 attempts
```

Retry backoff increases between attempts.

## Run Integration Tests

MongoDB must be running.

Start MongoDB:

```bash
docker compose up -d
```

Run:

```bash
npm run integration:test
```

The integration test uses the real MongoDB instance.

It checks:

- unique event identity
- tenant/source isolation
- job uniqueness
- version race protection
- worker-style atomic claims
- lease expiration
- abandoned work recovery

## Run the 1,000 Event Load Test

Start the service:

```bash
npm run dev
```

In another terminal:

```bash
npm run load:test
```

The load test creates:

```text
1000 distinct events
200 exact replay requests
50 jobs with versions delivered out of order
```

The 1,000 distinct events consist of:

```text
850 single-version jobs
50 jobs × 3 versions = 150 events

850 + 150 = 1000 distinct events
```

The 50 multi-version jobs are submitted in this order:

```text
v3
v1
v2
```

The expected final state is:

```text
version = 3
```

for all 50 jobs.

The load test reports:

- accepted count
- replay count
- error count
- HTTP p50
- HTTP p95
- submission duration
- queue drain duration
- final job count
- final version of all out-of-order jobs

## Expected Load-Test Result

The exact timings depend on the local machine.

The correctness expectations are:

```text
Distinct events:      1000
Accepted:             1000
Exact replays:         200
Replay responses:      200
Unexpected errors:       0
Final jobs:            900
Out-of-order jobs:      50
Out-of-order final v:    3
```

900 final jobs are expected because:

```text
850 unique jobs
+
50 multi-version jobs
=
900 job identities
```

The 150 versioned events for those 50 jobs update the same 50 job projections rather than creating 150 jobs.

## MongoDB Persistence

MongoDB runs with a Docker volume:

```text
mongodb_data
```

Therefore MongoDB data survives application restarts and container recreation unless the volume is explicitly removed.

To remove all local database data:

```bash
docker compose down -v
```

Do this only when intentionally resetting the test environment.

## Useful Commands

```bash
npm install
npm run build
npm run dev
npm start
npm run integration:test
npm run load:test
docker compose up -d
docker compose down
docker compose ps
```

## Design Documentation

See:

- `DESIGN.md` — invariants, lifecycle, atomicity, failure handling and trade-offs
- `SCALE.md` — scaling calculations and capacity assumptions
- `AI_USAGE.md` — AI-assisted implementation record
- `QC_REPORT.md` — final verification evidence

## Known Boundary

The service provides durable internal processing semantics.

External side effects outside MongoDB cannot be claimed as exactly-once merely because event identities are deduplicated.

If an external provider or downstream system requires exactly-once side effects, an additional idempotency mechanism or transactional/outbox-style integration is required.
