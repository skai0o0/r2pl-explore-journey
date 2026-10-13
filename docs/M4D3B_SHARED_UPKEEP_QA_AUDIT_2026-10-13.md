# R2PL V2 — M4-D3b Shared Knowledge Upkeep QA Audit (2026-10-13)

Status: QA FIRST SLICE IMPLEMENTED. POSTGRESQL SHARED BILLING TRANSACTION TEST IS NOT YET VERIFIED. Not a production release, not a legal school-lapse policy, and not a playable Knowledge build.

## Baseline and authorization

The owner reported the M4-D3a full suite PASS without requesting log inspection (expected 221/221, 0 fail/skip). M4-D3b builds on qa/m4d3-integration-20261013 commit 1452516dd99300e411661b35b6d46f7dac5452c8. Canonical owner policy: Knowledge rules v1 freeze candidate (2026-10-12), Round4 owner decisions; free 24h after authorized shared activation, fee 1 Point per school per frozen connected four-edge shared component every 24h, pair isolation, merge/split geometry changes next period, no 6h grace.

## Code delivered in QA-only branch

- database/migrations/005_m4d3b_shared_upkeep.sql: six private RLS tables for verified activation cohorts, immutable period snapshots, idempotent payer requests, unique per-school/component/cycle receipts, debit journal and private outbox. The schema is isolated from M3 tile chunks and production API roles. Migration SHA256: 774240ff29dc5e0ea5cfb7ebcd5e797876678072d657b14e5c382799cbdf6983.
- server/persistence/KnowledgeSharedUpkeepStoreV1.ts: QA-only service; trusted server topology and identity adapters; server-generated activation time; explicit boundary snapshots; opt-in verified payer school membership; transaction lock snapshot and authorized wallet; deterministic quote via knowledgeEconomyV1; debit, immutable receipts, journal, outbox and command result in one commit; replay returns result, altered payload rejects. Strict normalized QA DB URL, development-only construction. No automatic debits from other students.
- scripts/migrate-m4d3b.ts and npm run migrate:m4d3b: SHA256-verifying idempotent QA migration restricted to the exact approved Supabase QA (or named local disposable Postgres); verifies versions 1-4.
- tests/m4d3b-shared-upkeep.test.ts: 6 pure top-level tests; one gated QA PostgreSQL suite with nested tests for authorized membership, boundary, wallet atomicity, replay, concurrency, rollback and next-cycle merge/split.

## Independent verification

| Gate | Result |
|---|---|
| Supabase project asthukrgcnbskbhhjiiu | ACTIVE_HEALTHY, QA only |
| PostgreSQL migrations 1-5 | Applied, migration 005 SHA256 confirmed |
| QA r2pl_v2 tables | 28 tables, 28 RLS ON; anon/authenticated schema USAGE denied |
| Six new upkeep tables | Initially zero rows after migration |
| SQL trigger / key constraint smoke | PASS; transaction rolled back; no synthetic fixture remains |
| TypeScript strict typecheck | PASS |
| Biome new source/tests/migration CLI | PASS |
| Existing Vite client build | PASS (prior bundle-size warning remains) |
| MCP npm test WITHOUT database URL | 222 total, 211 PASS, 0 FAIL, 11 SKIP |
| New M4-D3b PostgreSQL transaction suite | NOT VERIFIED: skipped in MCP (no R2PL_TEST_DATABASE_URL) |

Previous owner reported M4-D3a 221/221 PASS on real Supabase QA; that does NOT prove new M4-D3b finance transactions. Do not claim M4-D3b all tests PASS until owner runs them successfully with private DB URL and NODE_EXTRA_CA_CERTS. The new six pure tests PASS and there are no non-DB regressions.

## Safety decisions and not-yet-implemented policy

- 1 Point per school/component is a SCHOOL maintenance obligation but the project has no explicitly authorized automatic school-treasury wallet or selected compulsory student payer. Thus NO scheduler auto-debits a random student.
- Only a server-verified, explicitly opted-in payer can pay a due fee from their own Points wallet, transactionally. No funding or no funds results in PENDING OPERATOR REVIEW, NOT an automatic legal departure. The owner must authorize who may fund, when maintenance is considered lapsed, and the immediate school departure transaction before automating it.
- A trusted authoritative world topology adapter and current legal ownership-to-component mapping are still missing from the full live game. If exact historical boundary geometry cannot be supplied, freeze refuses it; no retroactive recomputation.
- Cross-cohort tile handoff, live M3 chunk projection, continuous scheduler startup, private outbox-to-client delivery, student identity API, rewards and player-click UI are still separate tasks.
- Production mutation stays disabled. This branch and schema do not activate billing in production.

## Owner-only PostgreSQL gate in existing PowerShell terminal

Use the PowerShell session with R2PL_TEST_DATABASE_URL pointed to r2pl-m4d-qa, NODE_EXTRA_CA_CERTS pointing to the official project CA, and DO NOT paste connection details into chat:

1. cd C:\Users\AMTECH\Desktop\explore-journey\agent-worktrees\m4d3b-qa
2. npm run migrate:m4d3b
3. node --experimental-strip-types --test tests/m4d3b-shared-upkeep.test.ts
4. npm test

No Git pull needed on the same office PC; the QA worktree is updated in place. The current 222-test total reflects one nested PostgreSQL suite suppressed when DB URL is unavailable and may expand when run against DB. Stop and report failed test names if anything fails. Do not enable production or change the legacy land-rush-prototype database.

## Next QA slices

After actual PostgreSQL K03–K06 transactional PASS: select a legal school fee payer/funding policy and lapse authority, add durable component-cycle state & automatic boundary jobs without arbitrary student debits, implement ownership-to-Shared mapping, and integrate QA-only realtime commands and UX for manual playtesting. Profile hotspot contention before release.
