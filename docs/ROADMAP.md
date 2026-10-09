# Milestone state and backlog

## Gate status, 2026-10-09

| Milestone | State | Gate |
|---|---|---|
| M0 Specification Freeze and Architecture Audit | **Accepted architecture baseline** | Correction pass reviewed; proposed production school mapping remains pending |
| M1 Million-Cell World Foundation | **Accepted** | Owner accepted `M1_REPORT.md` and authorized M2 |
| M2 Realtime Core | **Implementation complete; owner review pending** | See `M2_REPORT.md`; synthetic test commands only; stop before M3 |
| M3 Durable Persistence and Economy | **Not authorized** | Requires owner review of M2; real PostgreSQL concurrency/restart gate |
| M4 Playable Slice | Not started | Needs approved exploration, competition and Landmark rules |
| M5 Running Integration | Not started | Needs external team's contract |
| M6 Full Gameplay and LiveOps | Not started | Needs reward, gift, admin and event decisions |
| M7 Scaling and Launch | Not started | Needs measured capacity and recovery |

## M1 proposed work items, in dependency order

M1 was authorized with the generic registry exception. These items use strict TypeScript and focused tests. M1 uses inert masks and synthetic fixtures and grants no rewards.

| ID | Work item and dependency | Acceptance criteria |
|---|---|---|
| M1-01 | Create minimal V2 package/workspace, strict TS, lint/format, test runner; resolve exact Colyseus 0.18.x-compatible set (ADR-001). | Clean install/build/test from a new checkout; lockfiles exact; no V1 code import; dependency list and compile/transport compatibility recorded. |
| M1-02 | Define generic immutable school-slot registry (C-04 production mapping deferred). | 16 max, duplicate/changed slot rejected after data exists, adding a new slot preserves prior masks; synthetic slots 0 and 15 round-trip. No production roster persisted. |
| M1-03 | Implement pure coordinates, tile IDs, chunk/sector address conversion and validation. | All 1,000,000 indices round-trip; fractional/NaN/−1/1000 coordinates rejected; 16×16 chunks and 4×4 sectors; final chunk has exactly 1600 real cells. |
| M1-04 | Implement dense uint16 mask and sparse metadata repository interface. | Bit 0 and bit 15 isolate correctly; no per-tile object array; mask presence changes deterministically; measured 2,000,000-byte mask. |
| M1-05 | Implement per-school fog bitsets and reveal primitive without choosing an unapproved gameplay reveal rule. | Exact 512-byte padded chunk format; school isolation; edge padding zero; save/load preserves discovered cells; hidden school data not exposed by API. |
| M1-06 | Implement versioned chunk codec, checksum and validation, with golden fixtures. | Little-endian 8192-byte mask chunks; deterministic encode/decode; rejects malformed size, padding, revision, format, coordinates and checksum before mutation. |
| M1-07 | In-memory repository adapter and complete-world save/restore fixture. | Million-cell state reconstructs exactly after mutation/save/load; mismatched sparse metadata fails closed; no DB service required. |
| M1-08 | Minimal placeholder visualization over world fixture, without gameplay command path. | Renders a local viewport and map overview without a million Mesh/DOM objects; reports frame time, draw calls, heap/GPU memory on named test device. |
| M1-09 | Measurement/report task and M1 gate. | Publish environment, mask/fog/sparse memory, init/serialize/restore times, source/bundle bytes, edge/property test results and risks; verify all preceding criteria. |

## M1 exclusions and approval dependencies

No exploration spending, contest, rewards, production sessions, real Gift handling, distributed sectors or production database writes belong to M1. The owner approved ADR-003 and M1's ADR-004 mapping, permitted a generic immutable 16-slot registry, and deferred production school mapping confirmation. ADR-011 stays open until M3. M1-05 defines fog representation only; reveal gameplay remains pending C-08. M1-08 is a noninteractive visual fixture, not M4 gameplay. HQ coordinates and C-01/C-02/C-03/C-05/C-06/C-07/C-10/C-11/C-12/C-13 are later-stage decisions.

## Later milestone dependencies

M2 adds a gateway, subscription handshake and binary commands/acks; it extends M1's in-process `SectorAuthority` boundary with a measured queue, then proves multi-client convergence with an explicit ephemeral fixture. M3 makes the same command path durable and idempotent before production success acks and selects ADR-011 from measured evidence. M4 needs the gameplay/layout parts of C-01–05, C-08–09 and C-12. M5 needs C-11. M6 needs C-06–07, C-10, C-13 and approved remaining content. M7 uses recorded load and recovery results to decide if Redis and process separation are needed.

## Progressive performance and concurrency gates

Run both **balanced** (actions spread across sectors) and **hotspot** (at least 70% of actions on one sector, including same-chunk and same-tile races) workloads at every network stage. A stage cannot advance if clients diverge, effects duplicate, a queue grows without draining, or the load generator is the bottleneck. `PERFORMANCE_TARGETS.md` defines the metrics and reporting method; these counts are test stages, not capacity claims.

| Milestone | Proposed progressive load | Required report and gate |
|---|---|---|
| M2, ephemeral test adapter | **Completed:** 100 → 500 → 1,000 connected clients; 20 → 100 → 250 scheduled test commands/s in balanced and 70% hotspot runs. **Deferred:** separate 3× bursts. | All six runs converged without observed lost updates. The 1,000-client hotspot missed target throughput and had 2.17 s client ack p95; see `REALTIME_CAPACITY.md`. Server/generator separation, bursts and fanout profiling remain open before capacity claims. No durability claim. |
| M3, real PostgreSQL | 100 → 500 → 1,000 clients; 50 → 250 → 500 durable actions/s, scaled down if correctness fails | Measure commit/lock wait p50/p95/p99, deadlocks/retries, WAL and bytes written per action, chunk-row contention, materializer lag and recovery time for each ADR-011 candidate. Verify zero lost committed acks and duplicate effects under crash/retry. |
| M4, browser slice | 100 → 1,000 connected clients with real browsers sampled at overview and hotspot; use approved gameplay rates | Add browser frame time, GPU/heap, bundle/download sizes and end-to-end convergence. Preserve M3 correctness under playable actions. |
| M7, launch capacity | 1,000 → 5,000 → 10,000 clients; sustained 1,000 actions/s and 3–5× bursts when prior stages pass | Balanced/hotspot stress plus failover; p95 committed ack <300 ms, visible convergence <500 ms in defined environment; publish actual limit and bottleneck. |
