# R2PL V2 — M4-D3c QA Playable Integration Audit (2026-10-13)

**Status:** FIRST ISOLATED QA BROWSER PLAYABLE CODE DELIVERED, NOT YET OWNER-VERIFIED ON REAL POSTGRESQL. Production remains disabled. No real student, vRace, rewards or original land-rush-prototype writes.

**Approved base:** qa/m4d3b-integration-20261013 commit 74aea15fa4141f74d4a81d5603a5579004d5d8c9. **QA branch:** qa/m4d3c-integration-20261013.

## Implemented

- server/qa/KnowledgeQaGatewayV1.ts / scripts/play-knowledge-qa.ts: localhost-only HTTP gateway on 127.0.0.1:4174. Opt-in R2PL_DEV_PLAY=1; approved exact QA/database URL via disposableDatabaseUrl and required NODE_EXTRA_CA_CERTS. PG max six connections. Startup verifies original 1–5 SQL migration checksums. Creates new random synthetic campaign with two synthetic schools, two synthetic actors, test Points wallets. No production handler change.
- Server-owned actor identity via random in-process test tokens; token-based requests never accept actorId/schoolSlot, browser-defined tile geometry or arbitrary SQL. Synthetic fixture switch only exposes synthetic identities on localhost. Same-origin, CSP, request size and static path guards. Unauthorized denied.
- Actual PostgreSQL path: synthetic School 0 starts one development-only succession case via KnowledgeCaseStoreV1.open with server-selected non-overlapping tiles, School 1 contributes Points via KnowledgeCaseStoreV1.contribute, duplicate idempotency key replays cached receipt. POST /api/qa/sync calls the existing KnowledgeDeadlineSchedulerV1 and bounded KnowledgeOwnershipProjectorV1, returns sanitized score/ownership/wallet projection. GET state polls every 2 seconds; no WebSocket or live server push is claimed.
- client/qa-knowledge/index.html, main.ts, style.css: standalone premium dark graphite/yellow QA panel with scenario, verified player selector, personal wallet, progress, deadlines, projected score/tile map, activity feed, explicit retry, manual Sync. Static build via npm run build:knowledge-qa; serve via npm run play:knowledge-qa.
- tests/m4d3c-knowledge-qa-gateway.test.ts: fail-closed env/DB, unauthorized and fake actor requests, local HTTP route and body validations, gated real PG fixture/replay/projection test.
- tests/m4d3c-qa-client-contract.test.ts: UI actions and exact QA endpoint wiring, no actorId override, safe DOM text rendering.

## Verification in local MCP process (does NOT inherit owner's database secret)

| Verification | Status |
|---|---|
| Strict TypeScript typecheck | PASS |
| Biome new TypeScript sources/tests | PASS |
| npm run build:knowledge-qa | PASS, self-contained QA UI bundle |
| npm run build:client | PASS, legacy Vite chunk warning unchanged |
| Full npm test without R2PL_TEST_DATABASE_URL | 227 discovered, 215 PASS / 0 FAIL / 12 SKIP |
| New HTTP route/auth tests without DB | PASS |
| New UI contract tests | PASS |
| New real PostgreSQL QA browser integration | **NOT VERIFIED; intentionally skipped in MCP** |
| Actual browser clicks/screen rendering | **NOT VERIFIED** |
| Production mutation | OFF; unchanged |
| Database migrations | No new SQL migration; existing 1–5 required and read-only checksum verified at startup |

User previously reported M4-D3b DB suite PASS; that does not prove M4-D3c interactive integration. QA synthetic fixture database rows may remain in disposable QA project after running and are never registered into production.

## Running on office PC

Use a PowerShell terminal containing the *private* R2PL_TEST_DATABASE_URL for approved Supabase QA asthukrgcnbskbhhjiiu and NODE_EXTRA_CA_CERTS pointing to the official Supabase project root certificate. Do not paste credentials into ChatGPT. Worktree already updated; no git pull necessary.

1. cd C:\Users\AMTECH\Desktop\explore-journey\agent-worktrees\m4d3c-qa
2. $env:R2PL_DEV_PLAY = "1"
3. npm run play:knowledge-qa
4. Open http://127.0.0.1:4174 using a browser ON THAT SAME PC. Do not expose port publicly or use port forwarding. To stop press Ctrl+C.
5. Switch to synthetic School 0 and initialize the succession case.
6. Switch to synthetic School 1, submit a 1 Point contribution. Confirm wallet debit and success status; press SYNC NOW to see committed ownership and score.
7. Press Replay previous contribution ID. Wallet must remain unchanged (no duplicate debit). Switch back School 0; no other player's wallet/actor receipts appear.
8. In the same terminal or another with QA env, run node --experimental-strip-types --test tests/m4d3c-knowledge-qa-gateway.test.ts and npm test, then inspect failures if any.

## Important unsupported workflows / next release gates

This is an isolated **synthetic succession training QA** using actual PostgreSQL transactions and filtered HTTP state. It is NOT legal real-school departure, original campaign map world_chunks ownership synchronization, actual M3 protocol/Colyseus realtime push, running-data identity validation, Shared upkeep payment UI, lawful school lapse/sponsor decision, or production gameplay. No custom player action may claim school identity from a browser. Never deploy the fixture tokens publicly. A full live game requires separately integrating M3 chunk codec/world origin, verified identity/enrollment source, production-safe event projection and explicit owner-approved school-funded upkeep/lapse policy.
