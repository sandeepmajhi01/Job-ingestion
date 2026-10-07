# AI Usage

## 1. Overview

AI assistance was used during development as an engineering support tool.

The implementation was reviewed, executed, tested, and adjusted manually rather than being accepted without verification.

---

## 2. Areas Where AI Assistance Was Used

AI assistance was used for:

- understanding and breaking down the assignment requirements
- designing the project folder structure
- reviewing Express and TypeScript implementation patterns
- reviewing MongoDB/Mongoose data models
- implementing request validation
- reasoning about event replay and conflict handling
- debugging TypeScript compilation errors
- debugging Mongoose behavior
- designing worker claiming and lease recovery
- reviewing retry and provider-failure behavior
- designing job pagination
- reviewing tenant/source isolation
- identifying assignment edge cases
- preparing design and scaling documentation
- performing final implementation review

---

## 3. Human Verification

AI-generated suggestions were not treated as automatically correct.

Implementation decisions were verified by:

- running the TypeScript build
- starting the application
- connecting to the Docker MongoDB instance
- sending HTTP requests
- inspecting MongoDB-backed event state
- testing job projections
- testing retry behavior
- testing permanent provider failure
- testing concurrent worker processing
- testing lease-based crash recovery

---

## 4. Important Verification Areas

Particular attention was given to:

- event identity uniqueness
- replay versus conflicting requests
- payload validation
- payload normalization
- version ordering
- stale event handling
- archive-before-upsert
- retry limits
- provider failures
- atomic worker claims
- worker leases
- recovery after an abandoned claim
- tenant/source isolation
- deterministic job pagination

---

## 5. Final Responsibility

The final implementation and repository contents are the responsibility of the developer.

AI assistance was used to accelerate implementation and review, but code behavior was verified against the assignment requirements through local execution and testing.
