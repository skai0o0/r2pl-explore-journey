# R2PL V2 — M4-D2 Knowledge Durability QA Audit (2026-10-13)

**Owner authorization:** M4-D2 implementation approved following the owner-run 180/180 PASS log. **Authority:** Knowledge Rules v1 freeze candidate 2026-10-12, Round4 owner decisions, D1 owner approval unit coverage. **Base:** fb50b15302ee4351c9dd0e07ffc8e6ed66ecf5a4. **Branch:** qa/m4d2-integration-20261013. **Production main:** codex/m4a-playable is untouched; production mutation remains OFF.

## Implemented in isolated QA integration

- SQL 003_m4d2_knowledge_durable.sql creates 6 private r2pl_v2 tables: immutable cases, command receipts, accepted contributions, durable refund obligations, unique debit/refund journal and private effect outbox. All six RLS enabled; no API anonymous/authenticated grants; trigger search_path pinned. SHA256 migration checksum stored as version 3.
- Node script migrate-m4d2.ts verifies idempotent migration and fail-closed target guard: only explicitly named disposable loopback databases OR the exact owner-approved Supabase QA reference asthukrgcnbskbhhjiiu over SSL Session pooler/direct port 5432. Official Supabase QA URI missing sslmode is normalized to sslmode=require before any connection; explicit SSL disable, wrong project or transaction port 6543 is rejected. Legacy land-rush-prototype is forbidden. npm run migrate:m4d2 triggers it.
- KnowledgeCaseStoreV1.ts is development-only: serialized case and wallet locks, authorized payer, capped accepted fees, strict 2h/48h cutoff, one-time success, exact refund liabilities, bounded transactional refund worker, original account credit and idempotent replay/ACK results. Ownership effects remain private outbox obligations; no real map ownership writer yet.
- KnowledgeWireAdapterV1.ts filters server-owned snapshots/outbox deltas, verifies actor/school sessions, role-specific visibility, private chest/receipts, replay deduplication and resync. NOT connected to production Colyseus gateway.
- New tests: m4d2-knowledge-wire-adapter.test.ts (24 PASS), m4d2-qa-url-guard.test.ts (3 PASS), m4d2-knowledge-durable.test.ts (new PostgreSQL K15-K20 suite; unverified since MCP lacks database URL).

## Verified evidence

| Verification | Status |
|---|---|
| Supabase project r2pl-m4d-qa | ACTIVE_HEALTHY, PostgreSQL 17.11 |
| Migrations 1, 2, 3 | PASS, SHA256 digests recorded |
| QA r2pl_v2 schema | 19 tables, all RLS enabled |
| Six new financial tables | ZERO persisted fixture rows after smoke transaction |
| SQL smoke transaction, rolled back | PASS: frozen case, revision, duplicate journal and immutable receipt constraints |
| QA schema unauthenticated access | anon / authenticated have no USAGE |
| Full TS typecheck | PASS |
| Biome check all new TS files | PASS |
| Full MCP test run without DB URL | 208 total / 199 PASS / 0 FAIL / 9 SKIP |
| Previous owner-run PostgreSQL regression before M4-D2 | 180 PASS / 0 FAIL / 0 SKIP |
| New K17–K20 PostgreSQL transaction test | NOT YET VERIFIED (requires user terminal database URL) |
| Real gameplay/UI wiring, scheduled upkeep, world updates | NOT DONE, production disabled |

The QA database retains fixture rows from earlier M3 tests; this work neither deleted those rows nor reset existing projects. The six new M4-D2 tables remain empty after the rollback smoke test. RLS no-policy info notices are expected for private deny-by-default schema.

## Required local PostgreSQL validation

Use the SAME PowerShell terminal that already contains R2PL_TEST_DATABASE_URL, then switch directory:

1. cd C:\Users\AMTECH\Desktop\explore-journey\agent-worktrees\m4d2-integration
2. Check the variable targets QA project asthukrgcnbskbhhjiiu, never land-rush-prototype; DO NOT display the password.
3. Use port 5432 (Session pooler), never 6543. The guard automatically adds sslmode=require when an approved Supabase QA URI omits it; explicit disabled TLS remains prohibited.
4. npm run migrate:m4d2
5. node --experimental-strip-types --test tests/m4d2-knowledge-durable.test.ts
6. npm test

STOP on test failure; do not merge into main or enable production until Node K17-K20 integration truly passes. Do not share connection URI or password in chat, files, commits or logs. The new M4-D2 suite currently SKIPS in MCP because MCP server does not inherit user PowerShell R2PL_TEST_DATABASE_URL.

## Next engineering gate

After verified Node PG PASS: wire durable ownership + school score outbox ack, integrate reliable scheduler for 24h Shared upkeep, rolling 2h / 48h hard expiry and crash/restart, connect verified server sessions behind a default-OFF QA flag, run M3.6 hotspot capacity tests and owner QA UI walkthrough. Signed production ruleVersion, external running identity API, real map/editor placement, BTC gift stock and device/browser QA remain separate gates.
