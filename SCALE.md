# Scale Analysis

## 1. Target

The assignment asks the design to consider growth from:

```text
100,000 events/day
```

to:

```text
10,000,000 events/day
```

with:

- bursts up to 5,000 events/sec
- approximately 1 KB average raw event size
- 7-day raw retention
- approximately 1 million current jobs

---

## 2. Event Rate

### 100,000 events/day

```text
100,000 / 86,400
≈ 1.16 events/sec
```

### 10,000,000 events/day

```text
10,000,000 / 86,400
≈ 115.7 events/sec
```

Therefore the 10M/day average rate is approximately 116 events/sec.

However, the specified 5,000 events/sec burst is much higher than the average and must be treated separately for capacity planning.

---

## 3. Raw Storage

At approximately 1 KB per raw event:

### 100K events/day

```text
100,000 × 1 KB
≈ 100 MB/day
```

Seven-day raw retention:

```text
≈ 700 MB
```

### 10M events/day

```text
10,000,000 × 1 KB
≈ 10 GB/day
```

Seven-day raw retention:

```text
≈ 70 GB
```

These values represent approximate raw payload volume before MongoDB document overhead, indexes, replication, and storage-engine overhead.

Actual capacity must therefore be provisioned above these estimates.

---

## 4. Current Jobs

The assignment targets approximately:

```text
1,000,000 current jobs
```

The current job collection uses a unique identity index:

```text
tenantId + sourceId + externalJobId
```

and a read index:

```text
tenantId + sourceId + status + _id
```

At larger scale, index size and memory pressure should be measured because indexes directly affect write amplification and storage requirements.

---

## 5. Burst Handling

The ingestion endpoint should remain lightweight.

The API performs:

```text
validation
replay detection
durable MongoDB insert
```

It does not wait for provider verification or complete job projection processing before returning `202`.

This separates ingestion throughput from downstream provider-processing throughput.

At 5,000 events/sec bursts, production deployment would require sufficient MongoDB write capacity and horizontally scaled API instances.

---

## 6. Worker Scaling

Workers can be horizontally increased as processing demand grows.

The current design uses MongoDB as the durable work store and atomic claims for worker coordination.

Worker capacity should be based on:

```text
incoming event rate
+
retry rate
+
average provider latency
```

The system should monitor backlog size and processing latency.

---

## 7. Backpressure

At high ingestion rates, MongoDB write capacity becomes an important constraint.

Production controls should include:

- request rate limits
- tenant quotas
- bounded worker concurrency
- monitoring of event backlog
- provider-aware concurrency limits
- retry backoff
- retry jitter

The API should avoid allowing one noisy tenant to consume all available processing capacity.

---

## 8. Noisy Tenant Isolation

A tenant generating a disproportionate volume of events can create worker starvation.

At larger scale, processing can be made fairer using:

- per-tenant quotas
- per-tenant rate limits
- fair scheduling
- tenant-specific concurrency limits

These controls prevent one tenant from monopolizing worker capacity.

---

## 9. Retry Storms

Provider failures can increase workload because one event can result in multiple attempts.

For example:

```text
initial attempt
    ↓
503
    ↓
retry
    ↓
429
    ↓
retry
    ↓
success
```

The implementation limits normal attempts to three and uses increasing backoff.

At production scale, jitter should also be added to prevent synchronized retry waves.

Metrics should track:

- retry count
- retry rate
- provider status code
- exhausted retries
- retry delay
- provider latency

---

## 10. Hot Keys

A single job may receive many versions rapidly.

The job identity:

```text
tenantId + sourceId + externalJobId
```

can therefore become a hot document/key.

Version-guarded updates prevent stale events from overwriting newer state.

At much higher scale, workload distribution and MongoDB write contention should be measured before selecting a sharding strategy.

---

## 11. Sharding

If MongoDB becomes the scaling bottleneck, sharding can be considered.

Potential shard-key candidates include tenant/source dimensions, but the correct shard key must be selected based on actual traffic distribution.

Important considerations include:

- tenant size distribution
- hot tenants
- query patterns
- write distribution
- cardinality
- migration cost

A poor shard key could concentrate traffic rather than distribute it.

---

## 12. Retention

Raw event history has a specified seven-day retention target at scale.

A production implementation could use retention policies or archival storage for historical data depending on the final data-retention requirements.

Current job projections should be retained independently from short-lived raw ingestion records because current jobs represent the latest state.

---

## 13. Metrics

Production monitoring should include:

### Ingestion

- events accepted/sec
- HTTP 400 rate
- HTTP 409 rate
- HTTP 202 rate
- ingestion latency

### Processing

- processing latency
- accepted backlog
- processing backlog
- completed events
- failed events
- stale events
- lease recoveries

### Provider

- success rate
- 429 rate
- 503 rate
- 422 rate
- retry rate
- retry exhaustion
- provider latency

### MongoDB

- write latency
- query latency
- connection pool utilization
- disk utilization
- index size
- replication health

---

## 14. When to Introduce a Broker

The assignment explicitly keeps the runnable core free of Kafka, Redis, and managed queues.

At higher scale, a broker becomes useful when requirements include:

- very high burst absorption
- independent consumer groups
- partition-based ordering
- durable stream replay
- multiple downstream consumers
- stronger queue isolation
- decoupling ingestion from worker storage

Kafka could then act as the event transport while MongoDB remains the durable current-state projection store.

The broker should be introduced based on measured throughput and operational requirements rather than simply because the system has grown.
