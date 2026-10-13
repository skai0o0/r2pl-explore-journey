# R2PL V2 — M4-D4 Main Game Integration Gate (2026-10-13)

**Owner approval:** Proceed with merging tested Knowledge V1 into the isometric game. **Status:** Knowledge Core imported into **isolated QA integration branch**; real game bridging is under implementation and not release-approved.

## Source and target

- Base game branch: `codex/m4a-playable`, immutable observed HEAD `b3fdc7b42a98b0db809b6b7231335e2b71c77fcb`.
- QA-approved Knowledge source: `qa/m4d3c-integration-20261013`, source HEAD `25a5e9e220ddd2104440a12a3c1735b46113b7b6`.
- Main-game integration (not production): `qa/m4d4-main-integration-20261013`; merge commit `e9d3e4ca00f605359b27aa65f90004d4f111ecc0`, with both expected parents.
- All 47 QA branch file differences merged without conflict. This imports only new Knowledge modules, migrations, tests, internal QA gateway and npm scripts; the original isometric `client/src/main.ts`, `client/src/worldView.ts`, `scripts/play-local.ts`, `server/realtime/DurableRealtimeCore.ts` were unchanged by merge.
- Production opcode remains protected by `REASON.PRODUCTION_DISABLED`. Do not merge feature enablement to `codex/m4a-playable` before gates below.

## Verified integration baseline (no database credentials in MCP)

| Gate | Result |
|---|---|
| Git ancestry / no merge conflicts | PASS |
| Strict TypeScript typecheck after merge | PASS |
| Build original isometric client | PASS; existing large Vite bundle advisory |
| Full test suite without R2PL_TEST_DATABASE_URL | 227 discovered; 215 PASS / 0 FAIL / 12 SKIP |
| User-owned prior M4-D2/D3a/D3b QA run | User reported PASS on approved Supabase QA, but not rerun through MCP |
| Isometric Knowledge end-to-end DB and browser | NOT YET VERIFIED |
| Production core files changed by QA merge | NO |
| Production mutation enablement | NO |

## Critical isolation guarantees

- M3 fog/owned mask in `world_chunks` is **not** legally equivalent to Knowledge V1 ACTIVE/SHARED/PROVISIONAL membership. No direct write from Knowledge projector into M3 chunk bytes without a signed handoff/codec and invariants.
- `knowledge_school_scores_v1` cover imported Knowledge projection only, **not global scores of historical M3 tiles**.
- Legacy M3 sandbox fixtures and the new Knowledge QA two-school fixtures have different synthetic campaign IDs and identity sets. They cannot be silently treated as the same verified student or one economy. Any simultaneous dev view must label each origin.
- Browser NEVER dictates `actorId`, `schoolSlot`, wallet, historical world state, ownership effects or school-fee payer; maintain server-owned verified session and sanitized per-viewer output.
- No automatic Shared 24h payment or school departure. Owner policy on who funds school-level upkeep and lapse remains unsigned.
- No replacement of production runner identity, 8-school onboarding, rewards/stock or actual live campus map. Production disabled.

## M4-D4 acceptance gates

1. Merge read-only, development-only Knowledge Core into isolated integration branch; no accidental edits to existing client or production opcode.
2. Add explicit localhost-only, opt-in integrated QA launcher using approved disposable DB guard (Supabase `asthukrgcnbskbhhjiiu` or named loopback), Node TLS CA, small session pool. No public port binding.
3. Attach Knowledge actions and **distinct read-only ownership projection overlay** to existing Three.js world; do not overwrite M3 chunk authority. Visually distinguish the two test economies.
4. Test synthetic session rights, sanitized actor and financial state, replay no extra debit, projection ACK, browser reconnect, bounded load and wrong-target rejection.
5. Run full QA PostgreSQL + isometric browser E2E in owner's terminal holding secure DB URL and CA; capture only pass/fail and nonsecret error labels.
6. Merge to the game branch only after owner approves that gate; production mutation stays OFF. Live feature enablement requires separate rules, authoritative identity and world codec approval.

## Outstanding implementation

Integration developer adapter and game UI may be staged in a separate worktree; no declaration of M4-D4 PASS until this code is validated and owner E2E is complete.

## M4-D4 first integrated isometric QA slice: implementation complete, live gate pending

Integrated source: agent/m4d4-bridge-20261013, copied with file hashes checked. New script scripts/play-integrated-knowledge-qa.ts requires R2PL_DEV_PLAY=1, R2PL_M4D4_INTEGRATED_QA=1, and exact approved disposableDatabaseUrl. It binds a same-origin HTTP QA server at 127.0.0.1:4173 with original isometric Three.js game and private Knowledge QA routes, plus Colyseus websocket at 127.0.0.1:2567. Existing migrations 1–5 must already exist; none are applied by the launcher. Database pool remains bounded and production disabled.

Game client modifications: client/index.html, client/src/main.ts, client/src/style.css, client/src/worldView.ts, plus new client/src/knowledgePanel.ts. This provides a separately labeled synthetic Knowledge panel inside the isometric game with server-verified School 0 setup, School 1 contributions, same-UUID replay, Sync, wallet, case progression, deadlines and scores. WorldView paints no more than 48 independent read-only Knowledge QA markers, never alters M3 authoritative fog or chunk ownership. Distinct synthetic M3 world campaign, actor mapping and fixture-credit wallet remain separate from Knowledge QA's case campaign and Points wallet.

Tests/m4d4-integrated-knowledge.test.ts validates feature flags/QA database guard, fixed identity scope, case routes, markers and UI mount. Independent verification on QA integration worktree without database URL: TypeScript PASS, changed TS Biome PASS, build:client PASS, build:knowledge-qa PASS, npm test 231 discovered / 219 PASS / 0 FAIL / 12 SKIP. This is NOT the full live PostgreSQL or browser E2E gate. Existing Vite chunk-size advisory remains.

OWNER ACCEPTANCE: In the same PowerShell terminal that has the private approved R2PL_TEST_DATABASE_URL (Supabase project asthukrgcnbskbhhjiiu) and NODE_EXTRA_CA_CERTS from Supabase QA, enter the worktree C:\Users\AMTECH\Desktop\explore-journey\agent-worktrees\m4d4-main-integration. Set R2PL_DEV_PLAY to 1 and R2PL_M4D4_INTEGRATED_QA to 1; run npm run play:integrated-knowledge-qa. Open http://127.0.0.1:4173 on the same PC. Check original Three.js zoom/pan/explore, expand DEV Knowledge QA, use separate School 0 to initialize, School 1 to contribute, Sync and view projected tile markers/score, retry same UUID with no extra wallet debit; verify personal wallets are isolated. Stop with Ctrl+C. Then run npm test with the QA database URL present: expected all tests, zero FAIL and zero SKIP. Do not share secrets or enable public port binding.

M4-D4 is not ready to merge into codex/m4a-playable until owner verifies this live QA gate. Production mutation stays OFF. World chunk codec integration, real student identity, full authoritative 8-school knowledge, Shared upkeep payer/lapse policy, rollout/rollback and browser performance tests remain separate production release gates.
