# M4-D1 Readiness Audit and Execution Backlog — Knowledge Rules v1

Audit date: 2026-10-12. Git base: 7a08738e83b3735d43d064340b7959b0a59f5b0c, branch codex/m4a-playable. Read-only code inspection and limited baseline validation; documentation changed separately. Target canonical spec: docs/M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md. This audit is NOT authorization for M4-D1 or production.

## 1. Verified code findings and evidence

| Severity | Location / observation | Consequence |
|---|---|---|
| BLOCK | shared/gameplay/candidates.ts:43-221 currently models per-tile attacker/defender contest with phase shared/defended/transfer_to_attacker and terminal time. | Directly CONFLICTS with owner ongoing Shared Knowledge, per-cluster upkeep, incumbent retention, rolling 2h and hard 48h. Do not enable or patch by changing magic time constants; implement replacement versioned domain rules. |
| BLOCK | shared/gameplay/candidates.ts:222+ defines age/grace/tick retention decay unrelated to specific 2h/48h claim. | General ambient Knowledge Decay OFF; this algorithm must remain inert for owner Knowledge v1. |
| BLOCK | server/realtime/DurableRealtimeCore.ts:242-244 expressly replies PRODUCTION_DISABLED to production mutation command. | Safe current guard. Release must leave it OFF until new auth, validation, money and state tests approved. |
| BLOCK | shared/gameplay/devRules.ts:0+ accepts only ruleVersion 0 and synthetic fixture-credit. | Cannot be used to debit real Points or grant production ownership. |
| BLOCK | tests/m4d-contest-smoke.test.ts initializes example costs sharedEntryCost=3, defenseCost=2, duration=1000ms, defenseAtDeadlineCounts=true. | 3 test passes demonstrate OLD PURE CANDIDATE, not new owner economy or phase-machine correctness. Keep legacy tests clearly tagged; add new owner cases K01-K24 to a distinct v1 test file. |
| PARTIAL | server/realtime/VisibilityProjection.ts projects caller's own school bit + fog; test-only fixture. | Safe foundation for C-08, but needs field-level derived public/own/party/actor/finance projections, hidden Chest per-player and reconnection checks. |
| PARTIAL | server/persistence/M35FixtureAuthority.ts + OutboxRelay.ts have durable fixture transaction and filtered outbox pipeline. | Reuse interface/locking/idempotency patterns; not a certified production Points wallet, escrow, contributor refund, or multi-component settlement. |
| PARTIAL | database/migrations/001_m3_foundation.sql and 002_m35_view_revisions.sql supply existing persistence foundations. | No owner approved consolidation case/ledger/payment/refund schema verified; migration planning is needed. |
| RISK | docs/M3.6_REPORT.md records 1,000-client/250 actions/s hotspot client ACK p95 about 4.71–5.40s, visible p95 about 24.82–25.08s, drain only afterward. | Remains launch blocker; new per-actor payments, timers and outbox create more workload. Do NOT claim readiness from functional tests alone. |
| RISK | docs/M4C_REPORT.md visual/browser/GPU E2E QA pending. | M4-C cannot count as visual launch signoff. |
| DEPENDENCY | C-11 actual runner/identity API remains external. | Define adapter/fixtures only, no fabricated identity proof or km conversion; production wallet and UniStop gated. |

## 2. Baseline verification performed (NOT owner-rule validation)

Node v24.19.0, npm v11.17.0 on home Windows checkout. npm run typecheck => PASS. node --experimental-strip-types --test tests/m4d-contest-smoke.test.ts => 3 PASS, 0 FAIL (legacy candidate values only). Git tree clean at inspection start, same SHA as remote GitHub at 7a08738. Full PostgreSQL concurrent scenario suite, functional rolling timer, reviewer-signoff and 1000-client benchmark NOT run here. No code/runtime/DB changes.

## 3. Strict precedence and contradiction register

1. docs/M4D0_KNOWLEDGE_RULES_V1_FREEZE_CANDIDATE_2026-10-12.md is canonical owner-rule freeze CANDIDATE; Round4 owner summary is the interpretive source; older docs are provenance, not alternatives to pick during coding.
2. docs/M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md includes historical grace 6h and 2h fixed assumptions; superseded where conflicting. SC tests must be filtered individually against K cases.
3. docs/M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md contains D01-D34 historic assumptions about no reset or 48h from tForget; superseded. K10-K14 replace deadline semantics.
4. docs/M4D0_C03_24H_CONTEST_SPEC_DRAFT.md retains historical terminal transfer/defense; do not wire to runtime.
5. docs/SPEC_CONFLICTS.md and docs/M4D_DECISION_PACK.md mix all-gates-open older narrative with top-of-document new override. Only current explicit owner decisions should be considered selected; signed production freeze still separate.
6. docs/VISIBILITY_POLICY_PROPOSAL.md's old deny-by-default M2 proposal must be refined with Round4 actor, party and admin roles; not an automatic authorization to send rival masks.
7. Historical Gamenote V2 cooldown says students without current-week running may use UniStop for ingame loot; owner has OVERRIDDEN that: NO UniStop access until positive verified current-week running sync. The running API isn't available; hold integration.
8. Owner World Design changes logical footprints to HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40; older 20x20/10x5/50x50 values are superseded. Final eight HQ coordinates NOT selected, ROADMAP deferred.
9. Landmark prior 100 Crystals/120 takeover is superseded; current owner direction first 1000 then linear additional 5% of base for EACH successive takeover, public Beacon color serialized. The meaning of a previously-funded rival pot after takeover needs test, not guessed rollback.
10. The existing M4B tests and synthetic M4D smoke are not authority to mark M4-D1 shipped. There is NO evidence of production Points, durable claim timers or refund records.

## 4. Ordered M4-D1 tasks — technical work packages (PROPOSED, not started)

| Ticket | Suggested owner | Dependencies | Deliverable + acceptance |
|---|---|---|---|
| D1-00 | Codex (Tech Lead review) | Signed C-01/C-03/C-08/C-12 Knowledge ruleVersion | State-transition and domain event protocol diagram, full input/output schemas, independent schema migration plan, backward compatibility and feature flag OFF. |
| D1-01 | Codex | D1-00 | New pure KnowledgeRulesV1 reducer: 4-edge clustering, pair-specific membership, incumbent snapshot, FREE incumbent, ceil(N/2), rolling fade reset capped 48h; tests K01-K16. Keep old candidates.ts historical and inert. |
| D1-02 | Codex | D1-00/01 | PostgreSQL durable case, per-user wallet ledger, deposits/caps/idempotency, obligation-based exact refunds; transactional transitions; tests K15-K20, crashes, retries and conservation. |
| D1-03 | Antigravity | D1-00/01 | Server-only own/party/actor/admin projections with C-08 exact field allowlists, reconnect, per-actor secret Chest; property/fuzz tests for forbidden fields. |
| D1-04 | Codex | D1-02/03 | Atomic scheduler/outbox: 24h school+component upkeep snapshots; departure and rolling 2h/hard 48h due, stale job dedupe and race handling; no 6h grace. |
| D1-05 | Antigravity | D1-01/03/04 | UX test prototype for school-owned/shared/claiming/neutral Knowledge and timers; no real wallet and no hidden rival data. Validate with browser/device and accessibility. |
| D1-06 | Codex + independent review | D1-01–05 | DB-backed end-to-end versioned commands, visibility, refund and restart invariants; benchmark 1000 donors, concurrent last-Point races and hot chunk update, record latency and WAL/outbox impact. |
| D1-07 | MiMo optional ONLY as independently sandboxed bounded task | D1-00 | Pure deterministic edge-case audit/test-vector generation; no broad access, no production data, no critical path dependence given earlier timeouts. |
| Gate | Owner/Tech Lead | all relevant acceptance, real identity and perf | Explicit reviewed stage authorization separate from docs; preserve PRODUCTION_DISABLED until release checklist signed. |

Tasks are **work packages, not dispatched executions**, because existing worktrees and production gating require an explicit implementation authorization. The user should not need to re-answer already confirmed product rules to prepare these tickets.

## 5. Dangerous edges engineers must test before code review

- Multiple valid contributions from different students race same last needed Point. No donation greater than remaining fee, no excess escrow, no multiple success.
- At exact rolling deadline/hard 48h, expiry wins; clock precision/clock skew/restart cannot reopen.
- School A guest fails while B incumbent remains: instant no-fee sole ownership, not dual loss or spurious consolidation case.
- Incumbent lapses, claimant pays while one school membership remains; handle snapshot and PAYER original identity even after the payer changes school.
- Mixed frozen incumbent across joined multi-tile cluster; correct N excludes claimant's incumbent tiles; only inherited unpaid portion neutralizes.
- Old snapshot from another ruleVersion cannot be replayed to change fee or start a new 48h clock.
- Pair clusters adjacent diagonally only must not merge; adjacent B+C must not alter A+B bookkeeping.
- Admin/spectator/public never receive raw fog/rival contributor identities; reconnect/outbox must re-authorize.
- School +1 score each on truly active Shared Knowledge; lost/neutral/provisional does not score; historic discovered geography remains private.
- Student current-week running eligibility ends at Asia/Ho_Chi_Minh Monday 00:00, not UTC Monday 00:00. Never trust browser-updated running Points.
- Key/chest transaction and map reveal must be per-player; global chest removed exactly once and other players' Keys not spent on losing race.
- Landmark contributions per school persist after another school activates, but takeover command must not cause spontaneous ping-pong without new valid claim.

## 6. Decision and authorization gates still truly open

**Technical decisions delegated to assistant:** locking order, escrow obligations, exact refund source, tie-break default, query/update projection allowlists, anti-race coding, timeout precision, workload benchmark approach. These can be implemented under future M4-D1 permission without repeatedly polling owner.

**Owner signoff still needed once in writing:** immutable Knowledge v1 ruleVersion and effective scope/date, optional 1/2/1 working economy becoming final production prices, any material deviation from selected rules, production authorization of M4-D1 separately. Must not present technical choices as owner-signed live settings.

**Other release gates:** real campaign identity/run API; world design placements; BTC Gift/stock/buffs, content/puzzle priorities; M3.6 throughput remedy; M4-C browser/GPU UX. These do not require prolonging Knowledge decision collection; they can be tracked by milestone.

## 7. Completion criteria for THIS audit

Read-only code inspection, canonical Knowledge rule candidate, explicit conflict precedences, fixed-time vs rolling-time correction, exact refund and visibility strategy, ordered work packages, 24 acceptance cases, ROADMAP next gate, Git versioned docs. Documentation may be committed/pushed; source code, migration, production enablement and M4-D1 execution remain untouched.
