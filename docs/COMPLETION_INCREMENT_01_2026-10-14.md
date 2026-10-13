# Completion increment01 — 2026-10-14

Status: dev playable integration ready for owner review; G-V1/G-FULL remain incomplete. Base21eb824. Scope implements bounded R9-A fix and parts of R1/R3 from [completion plan](V2_COMPLETION_PLAN_2026-10-13.md); [current status](COMPLETION_PROGRESS.md) records every parity criterion without upgrading missing features.

## Changes and why

The relay claimed up to50 events but released only the failing event when publication/recovery failed. Two remaining events in a three-event test kept a30-second lease. M35FixtureAuthority now catches at batch scope and releases all still-pending rows for its campaign and claim token. Delivered/quarantined rows and replaced tokens are untouched. Cleanup failure preserves the original error and leaves expiry recovery available; telemetry records cleanup release/failure. No event is discarded or ACK semantics changed.

The playable server now seeds a dedicated persistent synthetic campaign with8 generic schools,16 human explorers and24 bot identities. BotPeer and browser use the same v1 Colyseus/PostgreSQL pipeline. Stable actors/wallets and ON CONFLICT seed preserve progress; advisory guard rejects a second local dev writer for that campaign. Tests use separate random campaigns and remove only those fixtures, preventing tests from becoming another writer in the live demo. The session advisory guard is a local dev guard, not production failover/fencing.

DevAccountService reads actor-private profile and last10 receipts from the same durable exploration ledger. Shared devSession parser validates fixture marker, version, token uniqueness, slot bounds, homes and port. main.ts receives roster/port/home through this transport contract, retains legacy Dawn/Dusk fallback only on404, and displays the selected school name. Existing presentation remains; no new renderer/theme/artwork was built.

No new dependency, migration, production resource, production opcode or V1 change. Points/Crystals/Key wallets in running/reward preparation have NOT yet been unified or promoted; this build uses fixture-credit0 only. Rendering still includes legacy Dawn/Dusk fixture HQ and Landmark placeholder assets. Eight start anchors are synthetic planner homes, not8 approved HQ objects.

## Verification

Windows11, Node24.19.0, PostgreSQL16.15 loopback test database, i5-13400F/16 logical CPUs/34,164,097,024 bytes RAM. Full serial PostgreSQL suite:107/107 PASS,0 skipped (~17.82s). [Regression log](benchmarks/bots/completion-full-2026-10-14.log). Strict TS, lint and build pass;2 pre-existing observer.html useTemplate informational diagnostics remain. Client JS808.83kB/gzip216.40kB, existing >500kB warning remains.

New tests: publish failure batch release; poison-recovery failure batch release; delivered/replaced-token fencing; dev session validation; real8-school HTTP/WebSocket integration including private unauthorized access, same-key ACK/receipt/wallet conservation, duplicate writer rejection and reconstruct/restart persistence. First two batch tests failed before fix with leased=2 and pass after with leased=0; no30-second sleep is needed.

[Post-fix reconnect run](benchmarks/bots/2026-10-13T17-02-52-707Z-5dc59df5/report.json):30s mixed/gather,24 clients,3 bots/school, retry every10 actions and reconnect every20.1244 logical actions;165 retries;52 reconnects;405 distinct tiles/266 overlaps; all6 integrity checks pass. ACK p95=30.006ms, own replica p95=42.597ms, max84.937ms;0 missing visibility samples and0 relay error callbacks in this run. It executed while another playable process with24 bots ran on the same host/database, so this is not an isolated capacity comparison. Earlier pre-fix gather max was30045.188ms; no30s tail reproduced here. Original triggering transient relay failure is not conclusively identified; the deterministic stranded-tail mechanism is fixed. M3.6 large hotspot and10k readiness remain open.

Browser Edge smoke: http://127.0.0.1:4176 connected v1; all16 selectors across8 aliases visible. HCMUT and HCMIU bot knowledge rendered in the real Three.js canvas. Switching schools replaced the replica/home and profile. Clicking HCMIU tile(510,511) returned no_change and retained1000 credits; screenshot [playable proof](screenshots/eight-school-play-2026-10-14.png). Full device/GPU/privacy journey acceptance and object gameplay are not claimed from this smoke.

## Run and lifecycle

Set R2PL_BOT_SIMULATION=1 and R2PL_BOT_DATABASE_URL to a disposable loopback r2pl_prep_test_* or r2pl_bot_test_* DB. Run npm run play:schools. HTTP4176/WebSocket2568 keep legacy4173/2567 and bot observer4175 separate. Server prepares baseline migrations, preserves its own campaign rows, and runs bots for up to600s or until wallet/frontier exhausted; webpage/server remain up after bots stop. Human opening credits1000, bots5000 for newly provisioned wallets; restart does not refill them. Ctrl+C stops server; retained data stays in the explicitly synthetic DB. No automatic campaign wipe/reset.

GET /api/fixture/bootstrap exposes only local synthetic human selector tokens and anchors; these are not production authentication. /api/fixture/me, /api/fixture/receipts and /api/fixture/bots require a fixture token and return only that actor or own-school aggregate. No admin combined mask endpoint is served to students.

## Contribution and remaining gates

Codex implemented authoritative relay/account/server integration and the minimal client transport/bootstrap adapter on codex/m4a-playable. Exact runtime model ID is not exposed (GPT-6 based). Antigravity/MiMo CLIs not found in PATH; R2PL Agent Orchestrator agents_status/system_status both returned Session terminated. No external model substitution, contribution or worktree edit is claimed; their branches remain untouched. Frontend redesign and pure gameplay rule work are still assigned externally; the small client change is transport integration, not replacement presentation work.

Owner directive Triển khai authorizes proceeding with the planned development increment. It does not select conflicting gameplay rules, supply the running API, approve production world mapping or activate M5/production. AGENTS requires stopping for owner review after the improved playable build. Remaining: unify Points/Crystals/inventory/account prep, approved object action vertical slice, all R2/R4/R5/R6 journeys, frontend/world assets and real-device QA, real integration/stock and measured launch capacity.
