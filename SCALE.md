# Scale and Performance

## 1. Current Implementation

The service uses MongoDB as the durable event store and job projection store.

Background processing is handled by **2 asynchronous worker loops** competing for accepted events.

Each worker:

1. Claims an available event atomically from MongoDB.
2. Marks the event as `processing`.
3. Verifies the job through the provider fixture.
4. Checks the current job version.
5. Applies the event only when its version is newer.
6. Updates the job projection.
7. Marks the event as `completed`.

This allows multiple workers to process different events concurrently while preventing two workers from claiming the same event at the same time.

The system also supports retryable provider responses (`429`/`503`), permanent failures (`422`), leases for abandoned processing, event replay detection, and version-safe job projection.

---

## 2. Local Load Test

The local benchmark was executed using:

- 1,000 distinct valid events
- 200 exact replay requests
- 50 jobs delivered out of order
- 50 concurrent HTTP requests
- 2 background workers
- 500 ms worker polling interval
- Local MongoDB 8 running through Docker Compose
- Local fixture-based provider

The 50 versioned jobs were delivered in the order:

```text
v3 → v1 → v2
```

The expected final state for all of them was version 3.

---

## 3. Achieved Results

The load test completed successfully with:

```text
Distinct events:   1000
Accepted:          1000
Exact replays:     200
Replay 200s:       200
HTTP errors:       0

Logical jobs:      900
Out-of-order jobs: 50
Final v3 jobs:     50

Submission time:   ~2.0 seconds
Queue drain time:  ~257.3 seconds
```

Additional measured HTTP latency:

```text
Submission p50:    ~101 ms
Submission p95:    ~188 ms

Replay p50:        ~67 ms
Replay p95:        ~75 ms
```

The observed background processing throughput was approximately:

```text
1,000 events / 257.3 seconds
≈ 3.9 events/second
```

This is a local single-machine measurement and is not presented as production capacity.

---

## 4. Correctness Under Load

The benchmark also demonstrated that the processing pipeline maintained the expected final state while handling concurrent ingestion and out-of-order delivery.

In particular:

- All 1,000 distinct events were accepted.
- All 200 exact replays were recognized.
- No HTTP errors occurred during the load test.
- 50 versioned jobs were delivered out of order.
- All 50 eventually reached version 3.
- No stale version overwrote a newer version.
- The expected 900 logical jobs were present.
- No failed events remained from the load test.

This demonstrates that the current worker and versioning model can process concurrent event traffic without losing the final version ordering guarantee.

---

## 5. Current Performance Observation

The current benchmark shows that **event ingestion itself is significantly faster than background projection processing**.

Approximately 1,000 events were submitted in about 2 seconds, while the background queue required approximately 257 seconds to fully settle.

Therefore, the current performance focus is the **worker-processing path**, rather than the initial HTTP acceptance path.

---

## 6. Future Scaling Approach

The current implementation is intentionally conservative. Future performance improvements will focus on increasing worker throughput while preserving the existing correctness guarantees.

The main areas for optimization are:

### Worker concurrency

Increase the number of concurrent worker loops and benchmark the point at which additional workers stop providing useful throughput.

### Worker polling

Reduce unnecessary waiting when work is already available. Workers should be able to immediately claim another event after finishing the previous one and only wait when no work is available.

### Provider fixture loading

The provider fixture is static during a run. Loading and parsing it for every verification introduces unnecessary filesystem and JSON parsing overhead. It can be loaded once and reused in memory.

### Database operations

Review the event-processing path to identify unnecessary MongoDB reads and combine operations where possible without weakening:

- atomic claiming
- version ordering
- replay safety
- crash recovery
- lease recovery

### MongoDB indexes

Optimize indexes supporting worker claims, retry scheduling, lease recovery, and job reads as throughput increases.

### Connection and resource tuning

As worker concurrency increases, MongoDB connection-pool sizing and other resource limits should be measured and tuned rather than increased blindly.

### Horizontal scaling

For larger workloads, worker processes can be scaled across multiple application instances. MongoDB remains the coordination point for durable work claiming and job state.

---

## 7. Scaling Principle

Performance changes will be evaluated using the same reproducible workload and actual measurements.

The goal is not simply to add more workers. The goal is to identify the actual bottleneck and increase throughput while maintaining:

```text
Durable acceptance
        +
Safe concurrent claiming
        +
Version-correct projection
        +
Retry/recovery guarantees
        =
Reliable scalable ingestion
```

The current **~3.9 events/sec local throughput** is therefore treated as the baseline from which subsequent optimizations can be measured.
