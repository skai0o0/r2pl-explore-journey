# Milestone state and backlog

## Current implementation checkpoint — 2026-10-14

Read [progress audit](PROGRESS_AUDIT_2026-10-14.md) and [current completion checklist](COMPLETION_PROGRESS.md) for baseline bf67b66. Dated gate tables and CURRENT/LATEST candidate notes below retain their historical scope; they do not override subsequent owner authorization or prove implementation.

| Boundary | Current state | Remaining gate |
| --- | --- | --- |
| Foundation M0–M3.5 | Accepted/conditional within documented scope | Full production rule freeze and hotspot performance remain open |
| M4-A | Accepted playable baseline; subsequent dev increments implemented | Full Master Plan M4 is PARTIAL: Shared/competition, Landmark contribution and leaderboard absent |
| Eight-school dev build | HQ400 tiles/school + server four-edge exploration + common reward/explore wallet + inventory UI | World reward contact, remaining gameplay and browser reward-spend acceptance |
| M5 / M6 | Preparation and partial synthetic rewards exist; full milestones not completed | External provider, production economy/Gifts, admin/editor/LiveOps |
| M7 / G-V1 / G-FULL | Not achieved | Product journey acceptance, QA and measured launch readiness |

Audit checks:124/124 PostgreSQL/network tests pass, strict/lint/build pass. Dev server health is online; bounded bot run has finished. No new capacity claim or milestone acceptance is inferred.

## Historical decisions and milestone records

> **2026-10-13 OWNER DIRECTION — DEVELOPMENT / INTEGRATION PREPARATION:** The owner authorized completing feasible code and preparing blocked integrations, and named `R2PL_Gamenote_V2_Dong_bo_2026-10-12.txt` as the latest product idea reference. For this bounded increment, its product direction takes precedence over conflicting historical Round-4 proposals; this does not publish a production ruleVersion. Running contracts, synthetic transactional reconciliation, reward reference tables and cooldown preparation are implemented; see [integration preparation report](INTEGRATION_PREPARATION_REPORT_2026-10-13.md). No production endpoint, reward grant, running conversion default or campaign mutation is enabled. Earlier docs-only prohibitions describe earlier authorization, not this preparation increment.

> **AUTHORITATIVE READER NOTE — KNOWLEDGE V1 FREEZE CANDIDATE:** Read [Knowledge Rules v1 canonical candidate](M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md) FIRST, then [M4-D1 readiness audit and tasks](M4D1_IMPLEMENTATION_READINESS_AUDIT_2026-10-12.md). This candidate resolves earlier conflicting clock/grace/transfer/test-fixture statements, but is **NOT a signed production ruleVersion or M4-D1 implementation authorization**. Treat conflicting historical cases as SUPERSEDED, not alternate implementations.

> **ROUND-4 CURRENT RULES OVERRIDE — 2026-10-12:** See [Owner Alignment Round 4](M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md). The lawful incumbent at Contest start retains FREE when challenger leaves; only a surviving non-incumbent claimant consolidates after incumbent leaves. There is NO 6h grace, NO fixed nonresettable 2h Decay: valid >=1 Point paid before expiry RESETS the 2h rolling Decay (capped by a nonresettable 48h hard claim deadline). ceil(N/2) rounds UP; unsuccessful accepted contributions return to their actual individual payers. Four-edge, max-two-school clusters; each Shared tile scores +1 for each active school; C-08 own-school fog and private player-data projections. C-04/C-05 footprint HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40; world layout deferred. Landmark first 1000 Crystals and LINEAR +5% of base per takeover; weekly-verified synced running required for personal UniStop use; finite Key-protected, individually discovered Chest, simple admin editor later. The older 6h grace, 48h-from-forgetting, terminal transfer, linear-not-resetting-Decay, historic first-explorer priority and prior object footprints are SUPERSEDED. M4-D0 docs only; full production freeze and M4-D1/D2 remain blocked.

> **C-03 NEW OWNER DECISIONS (2026-10-12):** [Incumbent, ~2h Decay, 48h Consolidation and Exact Contributor Refund Addendum](M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md) **OVERRIDES conflicting earlier wording.** The *current lawful holder at new Contest start* gets incumbent/free-retention privilege, NOT the first-ever discoverer. When an eligible contested cluster ENTERS DECAY at tDecayStart, **both 2h fade and 48h consolidation clocks start TOGETHER**: forgetting at tDecayStart+2h, settlement deadline at tDecayStart+48h (46h remain after forgetting). The non-incumbent successor's fee is **ceil(N/2) Points**, rounding UP for odd N, with eligible tile/component snapshot rules still pending. Failed consolidation makes eligible inherited Knowledge neutral and **refunds every accepted Point to its ORIGINAL individual contributor**, never the old holder. Store idempotent contributor escrow/refund ledger. 24h initial free shared-upkeep and connected-cluster maintenance rules still apply; global General Decay remains OFF. Earlier grace, contribution eligibility, mixed-holder cases and precise deadline inclusivity remain OPEN. Owner defers bespoke gameplay for exact simultaneous failure of both schools; fail-closed transaction correctness is still mandatory. **Docs only: no production code, no M4-D1/D2 authorization.**

> **C-03 OWNER ECONOMY CLARIFICATION 2026-10-12 (LATEST, NOT PRODUCTION):** The owner directs a **higher one-time Shared Knowledge join fee (2 Points per newly joined already-known tile, compared with 1 Point to explore a fresh tile, as the working numerical example)**, but **upkeep is charged per connected shared Knowledge cluster, NOT per tile**: **1 Point per paid 24h cycle per participating school per connected shared cluster, irrespective of its tile count**. The first 24h after sharing starts remain upkeep-free (Option C). These example amounts are a working owner balance baseline, not a published ruleVersion. Cluster neighbor definition (4/8), same-school-pair vs cross-pair merging, merge/split timing, payer/treasury, grace and both-unpaid outcomes are OPEN. See [current C-03 Rev2 detailed spec + SC49–SC70](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md). The older per-tile daily-upkeep cost language is SUPERSEDED. No production mutation, scheduled debit, or M4-D1 activation.


> **C-03 REV2 OVERRIDE 2026-10-12 — latest owner direction:** [C-03 Rev2 Shared Knowledge & Contest-specific Upkeep](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md) **supersedes** earlier statements that 24h automatically ends in defender victory/transfer. Two schools may share Knowledge indefinitely while EACH pays Points for its own upkeep; when one misses approved upkeep, only that school forgets and the other keeps Knowledge. **General Decay across noncontested tiles stays OFF; contest-specific upkeep/forgetting is ON as a concept.** **OWNER SELECTED OPTION C:** the first 24h of sharing have no upkeep fee; thereafter each school must pay Points for every 24h upkeep period. Fee, collection mode, cutoff, grace, both-fail outcome, C-08 fog and C-12 scoring remain **PENDING**. This is M4-D0 specification only; **NO production authorization, code or timer activation**. Earlier sections are historical or partially superseded wherever they conflict.

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

## 2026-10-12 M4-D0 preparation update

**C-03 current Option C direction:** initial 24h of shared Knowledge upkeep-free, then a Point obligation per participating school each subsequent 24h; dual sharing can persist indefinitely. Noncontested Knowledge has no General Decay. [Current Rev2 SC01–SC48 worksheet](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md) defines fee/grace/both-fail alternatives without selecting them. C-03 full freeze and M4-D1 remain BLOCKED by remaining C-01/C-03/C-08/C-12 decisions. No production job authorized.

**M4-D0 in progress, partial clarifications, FULL FREEZE pending.** "Proceed M4D" authorizes this documentation preparation only; [M4-D0 owner alignment worksheet](M4D0_OWNER_ALIGNMENT_2026-10-12.md) supersedes the earlier all-pending narrative for the confirmed baseline facts, not full C-ID approval. Priority: freeze C-01/C-03/C-08 with exact signed examples; align C-04/C-05/C-12; then resolve C-02/C-09 before dependent implementation. M4-D1 remains gated and is not started by this update. M4-C still requires actual desktop/mobile browser UX and GPU acceptance. M3.6 hotspot remains a production launch blocker. M5 C-11 is **EXTERNAL BLOCKED** until the campaign/running team supplies schema/endpoints/identity mapping; M6 rewards remain unimplemented and separately gated.

## World Design deferred — owner direction 2026-10-12 (C-04/C-05)

Owner selected school roster from Gamenote V2 and logical footprints: 8 schools, HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40. Exact HQ coordinates and complete 1000x1000 world composition are explicitly DEFERRED. Schedule a later WORLD-DESIGN acceptance gate for eight HQ placements, collision/protected footprints, 10 Landmark artwork and positions, UniStop distribution, fair starting distances, school colors, spawn protection, admin editor placement, versioned publish/rollback and owner visual QA. DO NOT fabricate live coordinates or push layout seed as production.

Knowledge-only M4-D1 development can proceed after separately signed ruleVersion/C01/C03/C08; production campaign map publish remains blocked on the World Design gate and real identity integration.

## 2026-10-12 M4-D0 Knowledge v1 preimplementation audit

[Canonical Knowledge Rules v1 freeze candidate](M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md) now resolves the previous ambiguous/superseded 6h grace, terminal defender/transfer and fixed two-hour fade. [M4-D1 readiness audit](M4D1_IMPLEMENTATION_READINESS_AUDIT_2026-10-12.md) identifies code mismatches and an ordered D1-00...D1-07 work backlog. This is DOCUMENTATION PREPARATION only. Owner has NOT yet signed an immutable production ruleVersion, enabled mutation, approved SQL migration or issued separate M4-D1 authorization. Source unchanged; current C-03 smoke tests still exercise LEGACY pure candidate only.

**Next gate:** Owner signs C-01/C-03/C-08/C-12 Knowledge-only ruleVersion and separately authorizes D1-00 domain/protocol drafting. Complete versioned reducer, ledger/escrow/refund, school-private projections, durable 2h rolling + 48h hard deadlines and PostgreSQL E2E tests in dependency order. Keep PRODUCTION_MUTATION disabled through development; production launch additionally needs actual student/running identity, BTC/world design, M3.6 capacity and M4-C visual QA. Other milestone gates are not waived.

## 2026-10-13 development / integration preparation increment

Owner authorized feasible code and blocked-feature infrastructure preparation with Gamenote V2 as the latest product idea reference. [Preparation report](INTEGRATION_PREPARATION_REPORT_2026-10-13.md): provider/identity contracts, exact reward references, cooldown helpers, synthetic PostgreSQL running reconciliation and guarded test runner delivered; 80/80 regression tests pass. External running API remains unavailable; no production economy or rewards enabled. This is infrastructure preparation, not completion of M5/M6 or a Knowledge v1 rollout.

[M4-C browser smoke](M4C_BROWSER_SMOKE_2026-10-13.md) now records desktop exploration, two-session no-change/sync, reload and narrow-layout pointer evidence. Physical touch/pinch, full visual E2E and GPU/performance acceptance remain open. M3.6 hotspot launch blocker is unchanged. The increment stops for owner review.

## 2026-10-13 durable reward preparation continuation

Owner continued feasible dev/preparation. [Reward transaction report](REWARD_PREPARATION_REPORT_2026-10-13.md): Aspire UniStop durable roll/cooldown, actor-private fixed-reward Chest, atomic Key/inventory/ledger/outbox and crash/retry delivered in r2pl_prep only. 94/94 regression tests pass. Nitro/Predator Gift-bearing profiles fail closed before RNG; Chest gacha/Gifts remain gated. CLI demo is available; no client reward UI or v1 opcode was added. This is preparation, not M6 completion or production authorization. Stop for review.

## 2026-10-13 eight-school bot simulation

Owner requested multi-speed school bots. [Simulator guide](BOT_SIMULATION.md) and [measured report](BOT_SIMULATION_REPORT_2026-10-13.md) deliver private-school WebSocket exploration, eight-way rendezvous/overlap plus pairwise layouts, retry/reconnect and PostgreSQL integrity checks. 102/102 regression passes. Full contest/defense/upkeep and production roster/layout remain gated; no protocol change or M5/M6 completion. First fast workload exposed lease-recovery delay, preserved in the report; a repeat passed with a 45s drain window. Ready for owner review.

## 2026-10-13 completion planning — owner requests at least V1 parity

[Completion implementation plan](V2_COMPLETION_PLAN_2026-10-13.md) defines G-V1 (all core player/operator journeys on the actual Three.js UI, eight schools, synthetic external adapters where necessary) and G-FULL (approved complete campaign integration, rewards/LiveOps and measured production readiness). PV01–PV18 map the read-only V1 feature floor to R0–R9 work packages, dependencies and acceptance evidence. Next proposed increment: reconcile current spec + outbox/reconnect investigation, then unified account/command/private relay and eight-school playable integration. This is planning authorization, not acceptance of gameplay rules, M5 activation, production migrations or launch; existing review gates remain.

## 2026-10-14 completion increment01 — eight-school playable integration

Owner authorized implementation. [Increment report](COMPLETION_INCREMENT_01_2026-10-14.md) delivers outbox batch failure recovery with token-fenced release, actor-private durable profile/receipts, validated dev bootstrap and a persistent8-school playable server with16 human accounts/24 bots in the existing Three.js UI.107/107 regression pass;52-reconnect local run has visibility max84.937ms, no reproduced30s tail. [Completion checklist](COMPLETION_PROGRESS.md) keeps R1 common Points/Crystals/inventory, full object/shared gameplay, external integration and G-V1/G-FULL open. External frontend/pure-rule agent tooling unavailable; no substitution. Owner review gate after improved playable build remains; M3.6 capacity still open.

## 2026-10-14 completion increment02 — common dev reward/account backend

[Increment02 report](COMPLETION_INCREMENT_02_2026-10-14.md): Aspire/fixed Chest now grants/spends through the same v0 wallet/ledger as exploration, separate Crystals/Key/Treasure Map inventory, global command-key namespace, atomic receipt/cooldown/claim/private outbox and authenticated bounded HTTP APIs.114/114 regression pass. [Frontend handoff](FRONTEND_REWARD_HANDOFF_2026-10-14.md) is ready; inventory/reward UI remains unimplemented because the assigned Antigravity tool bridge is unavailable. Nitro/Predator/Gifts, running integration, world contact/catalog and G-V1/G-FULL stay gated. No protocolv1 or production migration change.

## Checkpoint 2026-10-14 — HQ/frontier correction

Owner-authorized core development correction implemented: free initial400-tile HQ Knowledge per school, server-enforced four-edge expansion, protected dev HQ, UI/bot integration and cross-chunk/restart acceptance.124/124 tests pass. This closes a missing gameplay-baseline invariant, not G-V1 or production launch. New versioned synthetic campaign preserves the old unrestricted fixture. [Report](HQ_FRONTIER_INTEGRATION_2026-10-14.md), [updated completion status](COMPLETION_PROGRESS.md).
