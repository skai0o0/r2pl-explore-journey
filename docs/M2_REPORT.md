# M2 report — Colyseus Realtime Core

**Status:** implementation complete for owner review, 2026-10-09. M1 was accepted before this work. **M3 has not been started or authorized.**

## Implementation

- Preserved the M1 1,000×1,000 uint16 world, 64×64 little-endian chunks, 16-slot registry, fog and 4×4 logical sectors. No V1 source was changed.
- Established a V2 Git history: committed the accepted M1 baseline (`88360f3`), then added an Ubuntu/Windows Node 24 CI workflow for clean install, strict typecheck, lint, tests, client build and size report. The V2 repository has no remote configured; no `gh` CLI was available. Publishing a remote and confirming CI run require the owner's target account/repository and credentials. The V1 nested repository remained clean.
- Implemented a thin Colyseus Gateway Room, synthetic authentication, in-process per-sector serial queues, versioned binary protocol with CRC32, command bounds and token bucket, actor-key idempotency, full-set chunk subscriptions, per-school visibility projection, revisioned snapshots/deltas, private test ACKs, reconnect snapshots, gap resync, bounded outbound queues, slow-client disconnects and structured counters/histograms.
- The only mutation is `EXPLORE` under synthetic rule version 0: set one school presence bit and reveal that school's tile. It is RAM-only, has no cost/reward, and returns `TEST_APPLIED` or `TEST_NO_CHANGE`. A production mutation opcode returns `PRODUCTION_DISABLED`. No durable committed-success result exists in M2.
- Kept the M1 visual fixture and added a fixture control to compare idle rendering with a one-pixel edit that triggers a full 4 MB texture upload. There is no gameplay UI or renderer replacement.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:client`, and `npm run report:size` passed locally on Windows / Node 24.19.0. **18/18 tests passed**, including M1 regressions; exact binary golden bytes and malformed frames; school isolation and edge padding; same-tile duplicate and conflict handling; 800 concurrent hot-chunk/four-sector writes; stale subscription cancellation and slow-client bounds; lost/reordered/duplicate delta replica behavior; and an actual three-client Colyseus loopback test with rejoin/resync and authoritative final-state checks. The GitHub workflow is prepared but has not run remotely.

Six loopback load runs used 100, 500 and 1,000 simultaneous clients in balanced and 70% one-sector hotspot workloads. Every run had all test actions acknowledged, exact final per-client projected mask/fog convergence, zero observed resyncs, zero client errors and zero rejected actions. The 1,000-client hotspot achieved **180.8 versus 250 requested actions/s** with **2,171 ms p95 client ack latency**. See `REALTIME_CAPACITY.md` and the six JSON result files. This is a capacity shortfall, not a correctness pass for higher load. A separate 3× burst was deferred until generator and server can be profiled separately. The generator ran in the same process and host as the server; these measurements do not establish 10,000 CCU or durable production capacity.

## Visual upload investigation

On this Windows desktop in Edge, 30 baseline frames and 30 one-pixel-change frames used `gl.finish()` after the two-view render. Baseline render+finish was approximately **0.30 ms p50 / 0.40 ms p95**; full 4 MB DataTexture reupload after changing one pixel was approximately **1.0 ms p50 / 4.8 ms p95**. This is a local fixture measurement, not mobile GPU capacity. Candidate follow-up comparisons are: Three.js `DataTexture.addUpdateRange(offset, 4)` for a one-pixel subimage, row-batched update ranges, and chunk-sized GPU textures. Installed Three.js 0.186.1 has a partial texture-update path in its WebGL texture code; measure its actual CPU/GPU cost and draw-call tradeoff before choosing. WebGL did not expose actual GPU allocation.

## Size and deviations

Size report after the final build: **22 first-party source files / 74,410 bytes**, five test files / 31,187 bytes, three scripts / 17,307 bytes. Client output: three files / **535,489 raw bytes**, **133,880 gzip**, **109,732 Brotli**. The JS file is 534,220 raw bytes and triggers Vite's 500 kB warning. The client remains a synthetic fixture; investigate split or tree-shaking only when the M4 real view and target devices are known.

The M1 world representation and school registry did not change. M2 narrowed the earlier proposed 256-chunk subscription limit to 64 and adopted school/chunk view revisions to avoid leaking activity through revision counters; both are recorded in ADR-012. No gameplay balance decision, probability value or proposed production school mapping was changed. The original and revised gacha tables remain in `GAME_SPEC.md`/`OWNER_REQUIREMENTS.md` for later approval.

## Independent review and known issues

MiMo CLI completed a scoped read of the M2 draft and highlighted visibility, malformed-frame, idempotency, revision-fence and identity tests. The final tests and wire fixtures address those categories. Its generated plan was removed from the V2 tree after review. Antigravity CLI was detected but could not complete a headless independent review because it was not authenticated/its sandbox command was denied; no elevated bypass was used. Codex reviewed and integrated the final result.

Open risks: hotspot fanout/client ack latency; no separated load generator or sustained/burst run; no production auth or one-connection-per-player enforcement; no durable replay across restart; in-memory idempotency is single-campaign test scope; `WorldState` must be mutated only through the M2 authority path to keep view revisions coherent; C-08 production visibility is unresolved. The `VISIBILITY_POLICY_PROPOSAL.md` matrix is for owner review and is not active gameplay. No PostgreSQL, economy ledger, outbox or Redis was introduced.

## M3 readiness and requested review

The M2 correctness boundary is ready for owner review: simultaneous clients converged to authoritative projected state in the tested cases without observed lost updates or foreign-school data. **M3 remains gated.** Before authorizing it, review the M2 protocol/test-only status and the 1,000-client hotspot limitation. M3 can investigate ADR-011 and add PostgreSQL transaction-backed world mutation, ledger, idempotency and outbox as a single atomic outcome; it must never acknowledge production success from this RAM adapter. A separate performance track should isolate generator/server fanout, measure visible convergence, and repeat hotspot/burst gates before claiming higher capacity. Production school slots, C-08 gameplay visibility and reward probabilities remain pending their later owner decisions.
