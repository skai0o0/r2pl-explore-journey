# Decisions and approval ledger

Status on 2026-10-10: **M0 and M1 accepted; M2 conditionally accepted; M2.5 accepted for its measured scope; M3 PostgreSQL technical validation complete and awaiting owner review**. Higher-capacity realtime readiness and M4 remain unapproved. A `proposed` gameplay decision is not a production rule. Master Plan v1.0 fixes the technology and consistency constraints. `OWNER_REQUIREMENTS.md` remains the latest documented gameplay proposal; gameplay parameters stay pending where noted in `SPEC_CONFLICTS.md`.

| ID | Status | Decision and reason | Revisit trigger |
|---|---|---|---|
| ADR-001 | Plan-mandated; M1 package pin verified | Strict TypeScript; Colyseus, Three.js, PostgreSQL, Vite; Redis only when distributed deployment is justified. Use a modular monolith. M1 pins `@colyseus/core` 0.18.18, `@colyseus/ws-transport` 0.18.4, `@colyseus/sdk` 0.18.5, `@colyseus/schema` 5.0.36, Three.js 0.186.1, Vite 8.3.4 and TypeScript 5.9.3. No V1 lockfile migrates. Loopback request and binary transport smoke passes. | 0.18 compatibility or maintenance changes |
| ADR-002 | Plan-mandated | Server owns all shared state, identity, resources, reward outcomes and permissions. Client prediction is visual only. | Never silently weaken |
| ADR-003 | **Approved for M1** | 1000×1000 row-major tiles; `tileIndex=z*1000+x`; uint16 school-presence mask; 64×64 padded little-endian binary chunks; sparse per-school knowledge metadata and separate one-bit per-school fog. See `PROTOCOL.md`. | Format capacity or map geometry changes |
| ADR-004 | **Approved for M1** | 16×16 chunks, 4×4 logical sectors of 4×4 chunks. Replaceable in-process `SectorAuthority`. Future distributed writers require a durable lease/fencing token checked at commit. | Measured single-process bottleneck |
| ADR-005 | M2 test implementation; production policy pending | Colyseus gateway with synthetic identity, full-set viewport subscriptions (64 chunks maximum), per-school revisioned snapshots/deltas, bounded outbound queues, resync and private action ACKs. One-connection-per-player is not enforced by synthetic tests. No tile Schema objects. | Production auth/session and hotspot fanout review |
| ADR-006 | Plan-mandated; M3 fixture verified on PostgreSQL 16 | PostgreSQL commit and idempotency outcome precede a committed-success acknowledgement. M2 uses a clearly marked ephemeral test adapter; production mutating commands fail closed. M3's fixture transaction is not connected to a production opcode. A queued/received response is never called success. | Future production identity/rule and command review |
| ADR-007 | Proposed details | Three.js local instancing/batched buffers, with separate overview strategy and viewport budget. Evaluate V1 50×50 render chunks independently of 64×64 logical data chunks. | Browser GPU measurements |
| ADR-008 | M3 implementation baseline | Use explicit SQL migrations and a narrow repository interface; no ORM initially. This keeps transaction and locking behavior visible. The M3 schema is private `r2pl_v2` with synthetic fixtures only. | A demonstrated need for an ORM plus ADR |
| ADR-009 | **Generic 16-slot registry approved for M1; production roster proposed** | Saved assignments cannot change; additional unused slots may be onboarded. V1 names/bit mapping 0–7 below remain proposed, with 8–15 reserved for production. M1 code contains no production roster. School IDs are never derived from array order or email domains. | Owner registry decision before production campaign data |
| ADR-010 | Proposed | Gameplay rules are versioned configuration records. Unapproved costs, decay, landmark thresholds, and probabilities block affected gameplay commands. No runtime default may quietly become a campaign rule. | Owner approves a rule version |
| ADR-011 | **Full-chunk writes selected for M3; owner review pending** | Both candidates passed PostgreSQL atomicity/recovery tests. Across 200- and 1,000-action balanced/hotspot comparisons, the log often reduced WAL but added replay/checkpoint operations and did not consistently improve contention latency. Use transactional full-chunk mask/fog writes for the M3 baseline; retain the log as an experimental candidate. See `M3_REPORT.md`. | Representative dense worlds, sustained DB load or measured full-chunk write pressure |
| ADR-012 | M2 test-only protocol choice | Versioned `R2` little-endian envelope with CRC32; school/chunk view revisions, 64-chunk subscription cap, 128-frame/1-MiB outbound cap, synthetic-only ACK statuses. Earlier 256-chunk proposal narrowed for bounded fanout. Production quotas and durable ACK contract remain M3 decisions. | M3 transaction protocol and M2 capacity review |
| ADR-013 | M2.5 measured investigation; optional code path | Indexed school/chunk subscribers preserve visibility and revisions in tests, but one matched sustained hotspot run gives only a modest, unreplicated latency benefit. Keep scan as default. Ordered 20 ms delta batching is an unimplemented model: a versioned multi-record protocol and regression tests are required before any wire change. | Replicated isolated and separate-host hotspot measurements |

## M1 approval record and remaining roster decision

The owner approved ADR-003 and the M1 part of ADR-004, authorized M1 using a generic immutable 16-slot registry, and explicitly deferred confirmation of the V1 school names/bit mapping. ADR-011 now has an M3 benchmark-supported choice, independent of the roster decision. The table below is a **proposal only** and is absent from executable V2 source and M1 snapshots. Its confirmation is a later production campaign data gate, not an M1 engine gate.

| Proposed slot | Code | School from V1 SQL seed | Status |
|---:|---|---|---|
| 0 | HCMUT | Trường Đại học Bách khoa – ĐHQG TP.HCM | Pending owner confirmation |
| 1 | HCMCOU | Trường Đại học Mở TP.HCM | Pending owner confirmation |
| 2 | DTU | Đại học Duy Tân | Pending owner confirmation |
| 3 | DHHP | Trường Đại học Hải Phòng | Pending owner confirmation |
| 4 | HSU | Trường Đại học Hoa Sen | Pending owner confirmation |
| 5 | HUCE | Đại học Xây dựng Hà Nội | Pending owner confirmation |
| 6 | NTU | Đại học Nha Trang | Pending owner confirmation |
| 7 | HCMIU | Đại học Quốc tế – ĐHQG-HCM | Pending owner confirmation |
| 8–15 | — | Reserved; no school assigned | Reserved |

The owner proposal lists only the first five schools; the Master Plan and V1 SQL seed name eight. Confirming this mapping is required before writing production campaign world data. HQ coordinates and the final eight-school layout remain separate M4 decisions.

## ADR-011: world durability and materialization

**Problem.** Rewriting an 8192-byte chunk row for each single-tile action amplifies writes and makes a hotspot chunk a row-lock bottleneck. Delaying chunk writes can reduce cost but cannot make a committed gameplay acknowledgement depend on volatile RAM. Snapshot materialization may lag the durable mutation stream; recovery must still reconstruct exact committed revisions before serving clients.

**M3 comparison:** (A) update the chunk row in every action transaction; (B) append a compact immutable world mutation record in the action transaction and materialize chunk snapshots later. The same PostgreSQL 16 instance ran both under balanced and single-hot-chunk workloads at 16, 32 and 64 concurrent requests; larger stages were repeated in reverse order. Both passed crash/retry, reconciliation, fog and materialization tests. The log saved about 10–20% WAL in most 1,000-action runs, but its p95 transaction latency was higher in the 32-concurrency pairs and mixed at 64; pre-checkpoint recovery and operational work were greater. Select (A) for M3. This fixture throughput is not a 1,000-client capacity test. Exact results and limitations are in `M3_REPORT.md`.

**Non-negotiable consistency:** the wallet debit/credit, authoritative world mutation record or chunk update, chunk revision, command idempotency result and outbox event commit atomically. A materialized snapshot is a derived cache; if it lags, recovery replays committed mutations from its revision. Never acknowledge a successful action based only on a dirty RAM mask or an asynchronously scheduled save. A stale sector writer must fail its database commit after failover.

## Dependency check

V1 pins `colyseus` with `^0.15.16` and uses `colyseus.js` 0.15 in its package files. The [official Colyseus 0.18 migration guide](https://docs.colyseus.io/migrating/0.18) documents 0.18 server and SDK upgrades and the 0.18 Schema 5 requirement. M1 uses exact package pins and tests loopback request/response plus binary messages. Reconnect belongs with the M2 subscription/session path and remains unverified. Optional Colyseus database/admin packages are outside this baseline.

## Decision discipline

Each new ADR records context, options, decision, consequences, owner approval if it changes the Master Plan, and a validation result. Game balance decisions go in `GAME_SPEC.md` and `SPEC_CONFLICTS.md` with rule versions and test cases.
