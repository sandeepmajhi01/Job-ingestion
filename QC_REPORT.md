# Quality Control Report

## 1. Scope

This report records the final quality-control review of the job-feed ingestion service.

The review focuses on:

- functional correctness
- validation
- replay safety
- version safety
- worker processing
- retries
- recovery
- tenant isolation
- pagination
- MongoDB persistence
- documentation consistency

---

## 2. Build and Runtime

| Check | Result |
|---|---|
| TypeScript strict build | PASS |
| MongoDB running through Docker Compose | PASS |
| Application startup | PASS |
| MongoDB connection | PASS |
| Two worker loops start | PASS |
| Health endpoint | PASS |

Final build command:

```bash
npm run build
```

---

## 3. Event API

| Scenario | Result |
|---|---|
| Valid upsert accepted | PASS |
| Valid archive accepted | PASS |
| Invalid event rejected with 400 | PASS |
| Identifier surrounding whitespace rejected | PASS |
| Upsert without payload rejected | PASS |
| Archive containing payload rejected | PASS |
| HTTPS URL validation | PASS |
| Experience range validation | PASS |
| Skill normalization | PASS |
| Skill deduplication | PASS |

---

## 4. Replay Safety

| Scenario | Result |
|---|---|
| Same event identity + same content | PASS |
| Same identity + different content | PASS |
| Corrected rejected event ID can be reused | PASS |
| Object key order ignored | PASS after canonical comparison fix |
| Array order preserved as significant | PASS by canonicalization design |

The replay implementation does not claim exactly-once processing. It prevents duplicate event identities from creating duplicate durable work items.

---

## 5. Version Safety

The following behaviors were tested:

| Scenario | Result |
|---|---|
| Version 1 upsert | PASS |
| Version 2 archive | PASS |
| Version 3 upsert | PASS |
| Lower stale version after higher version | PASS |
| Archive before upsert | PASS |
| Higher version replaces older projection | PASS |

The current job projection is protected by version comparisons.

---

## 6. Provider Processing

| Scenario | Result |
|---|---|
| Provider success | PASS |
| 503 retry | PASS |
| 429 retry | PASS |
| Retry eventually succeeds | PASS |
| 422 permanent failure | PASS |
| Failed provider event becomes failed | PASS |
| Attempt history recorded | PASS |
| Failed verification leaves job projection unchanged | PASS |
| Maximum normal attempts = 3 | PASS |

Provider behavior is controlled by:

```text
fixtures/provider-plan.json
```

---

## 7. Worker Processing

| Scenario | Result |
|---|---|
| Continuous worker loop | PASS |
| Two worker loops | PASS |
| Atomic event claim | PASS |
| Competing workers process available work | PASS |
| Processing lease | PASS |
| Abandoned processing recovery | PASS |
| Recovered event completes | PASS |

Crash recovery was deliberately exercised by leaving an event in `processing`, allowing its lease to expire, and restarting workers. The event was subsequently reclaimed and completed.

---

## 8. Read APIs

### GET /jobs

Verified:

- tenant filtering
- source filtering
- default active status
- archived status
- capped page size
- deterministic `_id` ordering
- cursor pagination

### GET /events/:eventId

Verified:

- event lookup
- tenant filtering
- source filtering
- event processing status
- attempts
- attempt history
- errors

---

## 9. Tenant and Source Isolation

Job and event lookups include:

```text
tenantId
sourceId
```

The same external job ID or event ID can therefore exist independently across different tenant/source scopes.

---

## 10. MongoDB Data Integrity

The following indexes are part of the implementation:

```text
Event:
(tenantId, sourceId, eventId) UNIQUE

Job:
(tenantId, sourceId, externalJobId) UNIQUE

Job listing:
(tenantId, sourceId, status, _id)
```

Atomic MongoDB operations are used for worker claims and version-guarded job updates.

---

## 11. Failure Hypotheses Reviewed

### Hypothesis 1 — Concurrent workers could process the same event

Mitigation:

MongoDB atomic `findOneAndUpdate()` claim.

Observed result:

Competing workers successfully processed separate events without duplicate claims.

---

### Hypothesis 2 — A worker could disappear and leave work permanently stuck

Mitigation:

Durable `processing` state plus `leaseUntil`.

Observed result:

After lease expiration, another worker reclaimed and completed the event.

---

### Hypothesis 3 — An older event could overwrite a newer job projection

Mitigation:

Version comparison before projection update and version-guarded update.

Observed result:

Lower-version stale events did not overwrite the newer projection.

---

## 12. Documentation Review

The following documentation is included:

```text
DESIGN.md
SCALE.md
AI_USAGE.md
QC_REPORT.md
```

Documentation describes:

- architecture
- data model
- indexes
- atomicity
- replay behavior
- version behavior
- worker recovery
- retry behavior
- scaling calculations
- operational considerations
- AI usage
- QC results

---

## 13. Known Limitations

The provider is simulated using a fixture rather than an actual external provider, as required by the assignment.

The current implementation uses MongoDB as both the durable event store and work coordination mechanism.

At substantially higher throughput, a dedicated broker could be introduced after measuring MongoDB throughput, worker backlog, provider latency, and burst behavior.

Formal automated integration-test coverage should be expanded if additional time is available, particularly for high-contention version races and concurrent duplicate HTTP submissions. The manually executed scenarios above were used to verify the implemented behavior during development.

---

## 14. Final Assessment

The core ingestion service requirements have been implemented and manually exercised, including:

- durable acceptance
- validation
- replay safety
- conflict detection
- normalization
- version safety
- archive semantics
- asynchronous workers
- provider retries
- permanent failures
- tenant/source isolation
- pagination
- atomic claims
- lease-based recovery

Final submission should include the source code, lockfile, Docker Compose configuration, environment example, fixtures, documentation, and reproducible setup/demo instructions.
