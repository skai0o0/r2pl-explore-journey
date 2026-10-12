# Milestone state and backlog

## Gate status, 2026-10-10

| Milestone | State | Gate |
|---|---|---|
| M0 Specification Freeze and Architecture Audit | **Accepted architecture baseline** | Correction pass reviewed; proposed production school mapping remains pending |
| M1 Million-Cell World Foundation | **Accepted** | Owner accepted `M1_REPORT.md` and authorized M2 |
| M2 Realtime Core | **Conditionally accepted** | Realtime correctness accepted; higher-capacity claims withheld after the 1,000-client hotspot result |
| M2.5 Realtime Performance Investigation | **Accepted for measured scope** | Isolated-process diagnosis in `REALTIME_PERFORMANCE_INVESTIGATION.md`; higher-capacity readiness remains unapproved |
| M2.6 Realtime Batching Experiment | **Accepted as experiment; rollout declined** | Versioned 20/50 ms batches were compared with v1 deltas in two same-host 1,000-client balanced/hotspot trials and bursts. Protocol v1 remains default; v2 stays on `experiment/m2.6-batching`. |
| M3 Durable Persistence and Economy | **Technically accepted for synthetic foundation** | PostgreSQL 16 correctness and contention tests passed; owner approved ADR-011 full-chunk transactional writes as the revisitable baseline. |
| M3.5 End-to-End Integration Gate | **Correctness accepted; realtime performance gate open** | Synthetic v1 command commits through PostgreSQL with school-filtered outbox deltas and crash/retry convergence. The original hotspot capacity gate failed; see `M3.5_REPORT.md`. |
| M3.6 Realtime Delivery Optimization | **Reviewed; production performance gate open** | Correlated telemetry and three repeated 20-second 1,000-client/250-actions/s balanced/hotspot trials identify sustained hotspot outbox/fanout backlog. All eventually drain, but hotspot ACK p95 is 4.71–5.40 s and visible p95 is 24.82–25.08 s. This is a production launch blocker, not an M4-A development blocker; see `M3.6_REPORT.md`. |
| M4-A Playable Game Vertical Slice | **Authorized; local development build ready for owner review** | Browser game uses synthetic universities, credits and exploration through existing PostgreSQL/Colyseus v1 path. See `README_PLAY.md` and `M4A_REPORT.md`. No production gameplay approval inferred. |
| M4 gameplay expansion | **Not authorized** | Requires owner rules for the next iteration; M5 remains separate. |
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

M2 adds a gateway, subscription handshake and binary commands/acks; it extends M1's in-process `SectorAuthority` boundary with a measured queue, then proves multi-client convergence with an explicit ephemeral fixture. M3 proves the durable transaction and idempotency contract with a separate fixture and selects ADR-011 from measured evidence; production mutation integration waits for approved identity and gameplay rules. M2.6 evaluates a versioned realtime batching option without changing the M2 protocol by default. M4 needs the gameplay/layout parts of C-01–05, C-08–09 and C-12. M5 needs C-11. M6 needs C-06–07, C-10, C-13 and approved remaining content. M7 uses recorded load and recovery results to decide if Redis and process separation are needed.

## Progressive performance and concurrency gates

Run both **balanced** (actions spread across sectors) and **hotspot** (at least 70% of actions on one sector, including same-chunk and same-tile races) workloads at every network stage. A stage cannot advance if clients diverge, effects duplicate, a queue grows without draining, or the load generator is the bottleneck. `PERFORMANCE_TARGETS.md` defines the metrics and reporting method; these counts are test stages, not capacity claims.

| Milestone | Proposed progressive load | Required report and gate |
|---|---|---|
| M2, ephemeral test adapter | **Completed:** 100 → 500 → 1,000 connected clients; 20 → 100 → 250 scheduled test commands/s in balanced and 70% hotspot runs. | All six runs converged without observed lost updates. The original same-process 1,000-client hotspot missed target throughput and had 2.17 s client ACK p95; see `REALTIME_CAPACITY.md`. No durability claim. |
| M2.5, isolated realtime measurement | **Measured:** separate server/generator processes, 1,000-client 20-second balanced and hotspot at 250 actions/s, 5-second 3× bursts. | Balanced and hotspot sustained workloads converged at the requested rate; balanced 3× burst converged; hotspot 3× bursts timed out. Indexed fanout showed a modest single-pair benefit but no stable capacity increase. See `REALTIME_PERFORMANCE_INVESTIGATION.md`. Separate-host and replicated results remain before higher-capacity approval. |
| M3, real PostgreSQL | **Completed fixture stage:** 200 actions/16 concurrent, 1,000 actions/32 and 64 concurrent, balanced and hot chunk, reverse-order repeat. Network client integration remains a later approved command gate. | 20/20 tests passed on PostgreSQL 16.15; all 20 benchmark cases applied all actions with no deadlocks/retries. Full chunks selected for M3 after WAL, lock, recovery and checkpoint comparison. This is transaction evidence, not client capacity. |
| M2.6, experimental realtime batching | **Completed:** two trials of 1,000 clients, balanced/hotspot, 20 s at 250 actions/s and 5 s at 750 actions/s; v1 versus ordered 20/50 ms batches | All sustained runs converged; both v1 hotspot bursts timed out while batches completed. Balanced visible latency worsened under batching. Raw frame, byte, timing, CPU and memory artifacts are `M26_*.json`. Separate-host validation remains open. |
| M3.5, durable network fixture | **Measured:** PostgreSQL-backed v1 commands, 100 → 500 → 1,000 clients with balanced and hotspot subscriptions; separate server/generator processes on one host | Six cases converged. The 1,000-client/250-actions/s hotspot failed bounded convergence twice, with pending outbox work despite all ACKs. Exact transaction and retry tests passed. `M35_*_indexed_*.json` records separate queue, database, ACK/delta, fanout, WAL/pool and host CPU evidence. No production capacity claim. |
| M3.6, durable delivery investigation | **Measured:** three independent 20-second trials per pattern with 1,000 clients at 250 submitted actions/s; repeated 4-second 750/s hotspot bursts; 10-second sampled backlog runs; restart/resync/slow-sink PostgreSQL tests | Balanced outbox peaks around 241, hotspot trial-3 peaks at 4,332; all drain under a 30-second post-ACK bound. Hotspot ACK and visible latency miss readiness; 26/26 suite passes. Separate-process, same-host measurements and raw `M36_*.json`/CPU profile are in `M3.6_REPORT.md`. Independent-host capacity and long-duration memory plateau remain open. |
| M4, browser slice | 100 → 1,000 connected clients with real browsers sampled at overview and hotspot; use approved gameplay rates | Add browser frame time, GPU/heap, bundle/download sizes and end-to-end convergence. Preserve M3 correctness under playable actions. |
| M7, launch capacity | 1,000 → 5,000 → 10,000 clients; sustained 1,000 actions/s and 3–5× bursts when prior stages pass | Balanced/hotspot stress plus failover; p95 committed ack <300 ms, visible convergence <500 ms in defined environment; publish actual limit and bottleneck. |

## 2026-10-11 M4-C / M4-D0 audit+closure update

- **M4-A:** accepted playable baseline. Its loopback-only synthetic PostgreSQL/Colyseus path remains the authoritative development foundation; it did not approve production rules.
- **M4-B:** delivered and reviewed parallel client/pure-rule development increment. Candidate mechanics remain inactive proposals.
- **M4-C:** code delivered at `3d74506`; final visual desktop/mobile E2E and GPU acceptance remain pending. See `M4C_REPORT.md`. The current documentation pass did not rerun PostgreSQL integration, real-browser interaction or GPU performance.
- **M4-D0 decision package:** Drafting was authorized; [M4D_DECISION_PACK.md](M4D_DECISION_PACK.md) is ready for owner review. Individual gameplay rules are still pending owner approval, with no frozen ruleset. No production rule is inferred from synthetic fixture values or candidate functions.
- **Staged implementation after explicit decisions:** M4-D1 Knowledge contest is gated by C-01/C-03/C-08; M4-D2 defense/decay by C-01/C-03/C-08; M4-D3 Landmark by C-02/C-09 (plus C-04/C-05 where layout/footprint applies); M4-D4 gameplay E2E follows those stages and must validate the approved full-map/scoring behavior. C-04 and C-12 must align the official map/roster with scoring and leaderboard semantics.
- **Parallel production blocker:** M3.6 hotspot delivery work continues independently of gameplay development and remains a production launch blocker.
- **Later sequence:** M5 external running API integration; M6 full gameplay/LiveOps and reward operations; M7 measured scale, recovery and launch gate. None is authorized by this addendum.
