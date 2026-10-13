# Eight-school bot simulation — 2026-10-13

Owner requested bots representing eight schools exploring knowledge at different speeds and meeting each other. Codex delivered a synthetic developer simulator through the existing authoritative server, with private per-school replicas, randomized cadence, explorer/connector/steward planners, stable-key retry, deliberate reconnect, bounded budget and admin map/report artifacts. [Run guide](BOT_SIMULATION.md).

## Scope versus Gamenote and implementation plan

This adds development validation for the M4-A playable exploration baseline, not full M4-D gameplay or M5/M6 completion. Gamenote school names are display aliases only; immutable registry stores generic fixture IDs. Shared and pairwise meeting targets and layout are synthetic fixtures, not approved HQ positions. Protocol v1 and ruleVersion 0 remain unchanged. No frontend, production gameplay rule, production schema or V1 source was edited. No new dependency, broker, engine or Redis coordinator was added.

The feasible portion is multi-school exploration and v0 overlapping presence (default gather lets all eight schools meet). Full Knowledge contest/defense/upkeep/decay, final scoring, landmarks, real running identity and rewards remain unavailable to this command path. The simulator refuses --require-full-gameplay=true before starting. Preparation boundary: planner/config/transport/report modules can be extended once approved authoritative commands exist; unavailable mechanics are declared false in every report.

## Measurements

Windows 11 build 26200, Node v24.19.0, PostgreSQL 16.15 loopback, i5-13400F (16 logical CPUs), 34,164,097,024 bytes RAM. Generator and durable server share one process/host. Each school uses three clients unless stated; region 128, contact layout except the explicit gather run, 500 opening credits/bot. These are local correctness workloads, not production capacity or GPU measurements.

| Run | Duration / clients | Logical actions | Unique / overlapping tiles | ACK p95 | Own replica p95 | Retry / reconnect | Result |
| --- | --- | ---: | --- | ---: | ---: | --- | --- |
| mixed pairwise | 30s / 24 | 1244 | 758 / 373 | 48.215ms | 69.773ms | 165 / 52 | all 6 integrity checks pass |
| gather mixed | 30s / 24 | 1244 | 406 / 260 | 38.615ms | 51.641ms | 165 / 52 | all 6 integrity checks pass |
| fast repeat | 20s / 24 | 1331 | 748 / 453 | 38.327ms | 56.166ms | 197 / 78 | all 6 integrity checks pass |
| bursty spread | 5s / 8, credits 3, region 64 | 25 | 24 / 0 | 29.460ms | 35.817ms | 8 / 0 | all 6 integrity checks pass |
| slow custom .05/s | 1s / 8 | 1 | 1 / 0 | 17.474ms | 18.747ms | 0 / 0 | bounded initial delay; all 6 pass |

[Gather raw report](benchmarks/bots/2026-10-13T15-00-57-315Z-4e1bb0cd/report.json), [gather map](benchmarks/bots/2026-10-13T15-00-57-315Z-4e1bb0cd/map.svg). Gather has 28 interacting pairs out of 28; phase 30.008s, final sample around 60s after lease recovery. Own visibility max 30045.188ms; slow tail remains a real blocker, not hidden by percentile summary.

[Mixed raw report](benchmarks/bots/2026-10-13T14-48-49-390Z-ba6b1ba5/report.json), [mixed map](benchmarks/bots/2026-10-13T14-48-49-390Z-ba6b1ba5/map.svg), [fast raw report](benchmarks/bots/2026-10-13T14-56-44-444Z-a1a42f9c/report.json), [fast map](benchmarks/bots/2026-10-13T14-56-44-444Z-a1a42f9c/map.svg). Raw reports contain exact rates, workload and environment. Each successful run confirms actor wallet/ledger conservation, stable-key idempotency, own-school projection CRC/revision convergence, ACK map matching PostgreSQL, drained outbox and no missing applied-action visibility samples. Synthetic campaigns were cleaned up; report files remain.

## Finding retained for investigation

[First fast run](benchmarks/bots/2026-10-13T14-54-47-405Z-1ea71cd4/report.json) failed the outbox-drained check: 1331 logical actions, 754 unique / 447 overlapping tiles, all other integrity checks true, 9 relay error callbacks and two pending events at the end of the original 20s drain window. One delivered event measured approximately 30s commit-to-claim. Existing outbox lease is 30s; the simulator now waits up to 45s so lease recovery has time to execute. A repeated fast run passed. Default gather also passed after approximately 30s recovery, with 4 relay error callbacks. This does not prove the cause of the relay errors is fixed: investigate relay batch release/reconnect behavior separately; original failed artifact is preserved. Simulator leaves errors visible in serverMetrics and still fails if pending events remain. Production hotspot/capacity gate remains open.

## Verification and contribution

Strict TypeScript compilation, Biome lint/format and client build pass. PostgreSQL regression: 102/102 tests, zero skipped, including 8 new planner/config/report and real-network tests. Existing client bundle size warning remains (~807kB minified); no client source changed. Final strict/lint/full-regression logs are benchmarks/bots/final-check-0..2.log; client build is check-2.log. Historical check-1.log includes a formatter finding fixed before the final check. The main orchestration file is over 400 lines but responsibilities have been separated into planner, config, transport, fixture lifecycle and reporting modules; remaining entry point is coherent run orchestration.

Actual contributor: Codex in the existing workspace branch codex/m4a-playable. Antigravity/MiMo external CLIs were unavailable; neither contribution nor substituted external model is claimed. No separate agent worktree or external commit. Stop for owner review of the simulator; no production activation or next milestone inferred.
