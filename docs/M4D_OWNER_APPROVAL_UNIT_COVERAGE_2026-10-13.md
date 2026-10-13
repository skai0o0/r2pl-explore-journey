# R2PL V2 — Owner Approval Unit-Test Coverage (2026-10-13)

**Scope:** Owner-approved changes on 2026-10-12, with authority from M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md and M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md. **Base:** b3fdc7b42a98b0db809b6b7231335e2b71c77fcb. **QA branch:** qa/m4d1-owner-approval-20261013.

**VERDICT: PURE UNIT RULES TESTED; NOT YET FULL GAME / DB / UI ACCEPTANCE.** These modules are UNWIRED candidates. No production opcodes, actual account debits, paid refunds, reward issuance, DB migrations or editor deployments are enabled.

## 1. Independently verified commands and environment

On Windows office QA worktree, locked dependencies installed using npm ci --ignore-scripts --no-audit --no-fund --prefer-offline.

- npm run typecheck: PASS (full strict TypeScript project).
- npm test: 172 PASS, 0 FAIL, 8 SKIP (180 total).
- Biome check of all 16 NEW TS source/test files: PASS with no errors or warnings.
- npm run build:client: PASS, existing >500 kB chunk warning.
- npm run lint (whole repository): FAIL because EXISTING client/src/style.css has a pre-existing line-ending/formatting issue. No new file lint failure. CSS was not edited.
- Eight legacy M3/M3.5/M3.6 PostgreSQL network/durability tests SKIP because isolated R2PL_TEST_DATABASE_URL is not configured. Never point tests at production data.

## 2. New owner-rules unit suites (118 new tests, all PASS, none SKIPPED)

| Suite | Passed | What real pure code is tested |
|---|---:|---|
| m4d-knowledge-v1.test.ts | 17 | Incumbent current holder, free incumbent retention, ceil(N/2), rolling 2h reset, immutable 48h hard deadline, strict cutoff, pure refund obligation and serialized last-Point |
| m4d-knowledge-components-v1.test.ts | 21 | Four edges not diagonal, no row wrap, A+B distinct B+C, sparse clusters and merge/split |
| m4d-knowledge-visibility-v1.test.ts | 28 | C-08 school/actor/role fog projections, no rival donor/wallet/chest leaks, reconnect and C-12 scoring |
| m4d-knowledge-economy-v1.test.ts | 14 | Explore 1 Point, join 2 Points, max 2 schools, first 24h free, 1 Point per school per paid cluster, next-cycle merge/split |
| m4d-landmark-beacon-v1.test.ts | 9 | First 1000 Crystals, fixed-base increments 1050/1100/1150, rival pots retained, deterministic revision and retries |
| m4d-unistop-eligibility-v1.test.ts | 11 | Verified positive run in current Vietnamese Mon-Sun week only; Oct7-11 initial partial; Aspire 12h, Nitro/Predator 24h; student-specific cooldown |
| m4d-hidden-chest-v1.test.ts | 12 | Limited 2x2 event Chest, Key consumed only on valid open, one world open, privacy/map reveal per student, serialized race |
| m4d-owner-content-v1.test.ts | 6 | Eight Gamenote V2 schools, 10 landmarks, HQ30x30 UniStop10x2 Chest2x2 Landmark40x40 and placement bounds without guessing HQ locations |
| **Total new tests** | **118** | Pure development domain code, no actual financial persistence |

Existing regression tests: 54 PASS, 8 PostgreSQL SKIP. Total 172 PASS, 0 FAIL, 8 SKIP.

## 3. Canonical K01–K24 acceptance trace

| Cases | Pure unit evidence | Remaining system evidence |
|---|---|---|
| K01-K02 | PASS: real quote evaluator with no double debit | Real authenticated wallet DB |
| K03-K05 | PASS: 4-edge component + frozen billing snapshot | Server saved topology and cycles |
| K06 | PASS: 24h free, 1 Point due at boundary, no 6h grace | Durable upkeep scheduler |
| K07-K16 | PASS: owner/receiver, rolling 2h, hard 48h, ceil(N/2), cap, settlement | PG authoritative state and transactional debits |
| K17 | PASS: pure serialized last Point, no overfund or duplicate effect | Real parallel PostgreSQL last-Point race NOT tested |
| K18 | PASS: exact per-original-wallet REFUND OBLIGATIONS | Durable credited refund postings NOT implemented |
| K19 | **NOT VERIFIED**: worker crash and partial refund credits need real DB | PostgreSQL obligation table and retry-safe worker |
| K20 | PASS: pure idempotent replay after restored snapshot | ACK-loss and process-restart DB E2E outstanding |
| K21-K24 | PASS: freeze lawful incumbent, Shared +1 per school, remembered fog, block third Contest school | Real Colyseus/auth projection integration |

## 4. R4-01–R4-24 and other approvals: coverage vs gaps

| Owner group | Current unit test status | Missing or deliberately deferred |
|---|---|---|
| R4-01 to R4-17 — Knowledge, Fog, Scoring, Economy | Pure PASS; refund obligations only | Real wallet/upkeep jobs, DB settlements, WebSocket snapshots |
| R4-18 and R4-19 — Landmark | Pure PASS: thresholds, retained school Crystals, serialized revision | Real Crystal ledger and Beacon scene; buffs undecided |
| R4-20 and R4-21 — UniStop | Pure PASS: weekly synced positive result fixture; cooldown | Real webdev running API and correction handling |
| R4-22 and R4-23 — Chest | Pure PASS: personal hidden discovery/map, Key, single global open | BTC quantities, actual inventory/prizes/editor + real DB |
| R4-24 — World map deferred | Approved roster/footprint catalog PASS | Eight HQ coordinates, fairness, actual map placement NOT approved |
| C-08 role privacy | Pure PASS on event/snapshot projections | Security integration with real authenticated sessions |
| C-12 share Knowledge scoring | Pure PASS active A+B both count; pending claim does not | Durable leaderboard and tie-break integration |
| 10 Gamenote Landmark list, puzzles deferred | Catalog PASS; no puzzle implemented by design | Official placement and later buff decision |
| Nontechnical Admin Editor (The Sims-like) | No runnable editor unit implementation yet | UI editor/draft/publish/rollback separate milestone |
| C-11 identity/km sync | Verified fixture boundary tested only | External integration team controls identity, km, endpoints |
| Gift/Keys/physical rewards | Pure Key/Chest one-time rule PASS | Unapproved reward tiers/stock and fulfillment |
| M3.6 capacity and M4-C device QA | NOT part of unit-test verification | Separate production readiness gates |

## 5. Honest handoff and next steps

The owner-approved **pure logic** is suitable for independent review as QA source/tests. It is NOT ready for owner clicking through gameplay: these modules are NOT WIRED to a game loop, Colyseus commands, actual wallet/escrow, production database, editor or deployed frontend. Production mutation stays DISABLED.

Before manual feature testing: wire development-only command adapters and fixtures safely, add real PostgreSQL isolated test database, implement persistent contributor deposits/refund obligations + workers with K17-K20 restart and transaction tests; then enable QA-only interactive harness. Before production: real running identity, BTC reward stock, world design, M3.6 latency and M4-C visual QA remain independent launch gates. Do not replace missing tests with fabricated PASS claims.
