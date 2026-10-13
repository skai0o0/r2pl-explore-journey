# R2PL V2 — M4-D3 Initial QA Slice and Gate Register (2026-10-13)

Status: IMPLEMENTED FIRST QA SLICE, NOT YET POSTGRESQL END-TO-END VERIFIED; NOT A PLAYABLE KNOWLEDGE RELEASE.

Authority: owner approved M4-D3 after providing full 214 PASS / 0 FAIL / 0 SKIP Supabase QA log for M4-D2. Canonical Knowledge v1 freeze candidate (2026-10-12) and Round 4 owner decisions still govern. Development-only features remain off in production. Source base bf615d764fecfc183e451dc8649b2aa8382098fa, QA branch qa/m4d3-integration-20261013.

## Done in this slice

- Supabase QA migration 004_m4d3_knowledge_projection.sql applied successfully to r2pl-m4d-qa (project asthukrgcnbskbhhjiiu). Verified 22 private r2pl_v2 tables, all RLS enabled, schema has no anon/authenticated USAGE. New tables: knowledge_ownership_tiles_v1, knowledge_school_scores_v1, knowledge_projection_acks_v1. Migration version 4 SHA256 = 52cf619273c5bcb2fe78eefa8af28f1597972cce0edb916b52dbe9fc624aa71c. Initial rows in all three new tables: 0.
- KnowledgeOwnershipProjectorV1.ts: development-only, consumes committed private financial outbox. Validates exact reducer effects against immutable case history, processes increasing revisions, serializes claim with SKIP LOCKED and per-case locks, applies tile knowledge mask and school score in one transaction with an ACK. ACK means PRIVATE projection committed, NOT network delivered.
- KnowledgeDeadlineSchedulerV1.ts: development-only, manual caller-invoked bounded tick. PostgreSQL clock identifies due payable claims via min(rolling 2h, hard 48h). Uses prior tested KnowledgeCaseStoreV1.expire and refundBatch; no long-lived transaction lock across store calls, repeated ticks can retry failed cases, refund obligations are durable in the M4-D2 store.
- QA migration CLI migrate-m4d3.ts plus package script npm run migrate:m4d3, which reuses strict QA-only URL allowlist and validates migrations 1-3 before verifying/applying 4. NEVER points to original land-rush-prototype.
- Added pure tests for exact ownership effect validation, false effect rejection, private projector basics and five scheduler boundary/retry scenarios; one new PostgreSQL ownership integration suite remains gated on R2PL_TEST_DATABASE_URL and must be run by the owner in the configured PowerShell terminal.

## Verification

- Previous owner M4-D2 database suite: 214 PASS / 0 FAIL / 0 SKIP on Supabase QA, before these additions.
- M4-D3 MCP run WITHOUT database secret: 215 total, 205 PASS, 0 FAIL, 10 SKIP (8 older M3-M3.6 suites + 1 M4-D2 DB suite + 1 new ownership DB suite). No claim that 215/215 passed yet.
- npm run typecheck: PASS. Biome new five TS files: PASS. npm run build:client: PASS; existing Vite chunk size advisory remains.
- Supabase SQL migration 004: PASS and verified row counts; 22/22 RLS. No production dataset touched and old prototype project remains unchanged.
- Antigravity scheduler agent stalled during inspection and was cancelled with zero authored files. The bounded scheduler was implemented and unit-tested independently on QA integration worktree (five tests PASS). MiMo was not placed on critical path.

## Known NOT DONE — blockers to calling M4-D3 complete

- Actual PostgreSQL test of projector ordered revisions, rollback/ACK loss and score invariants must PASS on Supabase QA. Since MCP does not inherit the owner's R2PL_TEST_DATABASE_URL, only owner terminal can run it.
- Shared Knowledge per-school/per-pair connected-component 24h upkeep is NOT persisted or billed. Need frozen cycle geometry, immutable component receipt keys, durable job queue, two-school departure, no 6h grace and real wallet transaction authorization. DO NOT schedule direct Point deductions from a live recomputation.
- M3 binary world_chunks/fog codec is NOT integrated with knowledge ownership projection. Projector explicitly refuses cross-case overlap and projects only its own imported tiles. Scores are not campaign-wide until authoritative world import and handoff.
- No production Colyseus gateway wiring or live verified student identity, UI clicks, score replay to client, browser/device QA, running API or prizes. No runtime timer/service was started. Test fixture wallet != campaign rewards.
- A private outbox projection ACK is NOT a network delivery ACK. Field-level C-08 visibility remains separate through KnowledgeWireAdapterV1.
- Capacity and latency benchmarks (large connected components, >=1000 contributors, contention) and real process kill/restart gate are pending. No final production ruleVersion has been signed.

## Required owner QA verification

Run in PowerShell terminal with existing private R2PL_TEST_DATABASE_URL pointing to exact r2pl-m4d-qa and trusted NODE_EXTRA_CA_CERTS already configured; never paste credentials into chat:

1. cd C:\Users\AMTECH\Desktop\explore-journey\agent-worktrees\m4d3-qa
2. npm run migrate:m4d3
3. node --experimental-strip-types --test tests/m4d3-knowledge-ownership.test.ts
4. npm test

STOP if any test fails. The first command verifies the already applied migration 004 checksum, not a production schema change. Existing Supabase Session pooler 5432 has a 15-session limit; npm test is already sequential. Owner should send only aggregate result and failure messages without any database URI.

## Next authorized engineering slices, not delivered here

M4-D3b: durable Shared Knowledge upkeep and legal school departure, atomic locked wallet/cycle scheduler with 24-hour free start. M4-D3c: map-codec bridge plus gated QA-only realtime command/WebSocket integration, server verified auth, browser UI click-through, privacy replay end to end. Production remains disabled unless independently approved after all gates.
