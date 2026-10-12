# C-03 — Knowledge Contest 24h: Detailed Specification (M4-D0)

> **ROUND-4 CURRENT RULES OVERRIDE — 2026-10-12:** See [Owner Alignment Round 4](M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md). The lawful incumbent at Contest start retains FREE when challenger leaves; only a surviving non-incumbent claimant consolidates after incumbent leaves. There is NO 6h grace, NO fixed nonresettable 2h Decay: valid >=1 Point paid before expiry RESETS the 2h rolling Decay (capped by a nonresettable 48h hard claim deadline). ceil(N/2) rounds UP; unsuccessful accepted contributions return to their actual individual payers. Four-edge, max-two-school clusters; each Shared tile scores +1 for each active school; C-08 own-school fog and private player-data projections. C-04/C-05 footprint HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40; world layout deferred. Landmark first 1000 Crystals and LINEAR +5% of base per takeover; weekly-verified synced running required for personal UniStop use; finite Key-protected, individually discovered Chest, simple admin editor later. The older 6h grace, 48h-from-forgetting, terminal transfer, linear-not-resetting-Decay, historic first-explorer priority and prior object footprints are SUPERSEDED. M4-D0 docs only; full production freeze and M4-D1/D2 remain blocked.

> **C-03 NEW OWNER DECISIONS (2026-10-12):** [Incumbent, ~2h Decay, 48h Consolidation and Exact Contributor Refund Addendum](M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md) **OVERRIDES conflicting earlier wording.** The *current lawful holder at new Contest start* gets incumbent/free-retention privilege, NOT the first-ever discoverer. When an eligible contested cluster ENTERS DECAY at tDecayStart, **both 2h fade and 48h consolidation clocks start TOGETHER**: forgetting at tDecayStart+2h, settlement deadline at tDecayStart+48h (46h remain after forgetting). The non-incumbent successor's fee is **ceil(N/2) Points**, rounding UP for odd N, with eligible tile/component snapshot rules still pending. Failed consolidation makes eligible inherited Knowledge neutral and **refunds every accepted Point to its ORIGINAL individual contributor**, never the old holder. Store idempotent contributor escrow/refund ledger. 24h initial free shared-upkeep and connected-cluster maintenance rules still apply; global General Decay remains OFF. Earlier grace, contribution eligibility, mixed-holder cases and precise deadline inclusivity remain OPEN. Owner defers bespoke gameplay for exact simultaneous failure of both schools; fail-closed transaction correctness is still mandatory. **Docs only: no production code, no M4-D1/D2 authorization.**

> **C-03 OWNER ECONOMY CLARIFICATION 2026-10-12 (LATEST, NOT PRODUCTION):** The owner directs a **higher one-time Shared Knowledge join fee (2 Points per newly joined already-known tile, compared with 1 Point to explore a fresh tile, as the working numerical example)**, but **upkeep is charged per connected shared Knowledge cluster, NOT per tile**: **1 Point per paid 24h cycle per participating school per connected shared cluster, irrespective of its tile count**. The first 24h after sharing starts remain upkeep-free (Option C). These example amounts are a working owner balance baseline, not a published ruleVersion. Cluster neighbor definition (4/8), same-school-pair vs cross-pair merging, merge/split timing, payer/treasury, grace and both-unpaid outcomes are OPEN. See [current C-03 Rev2 detailed spec + SC49–SC70](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md). The older per-tile daily-upkeep cost language is SUPERSEDED. No production mutation, scheduled debit, or M4-D1 activation.


> **SUPERSEDED FOR C-03 CONTEST SEMANTICS (2026-10-12):** See [C-03 Rev2 Shared Knowledge & Upkeep](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md). Owner now allows indefinite two-school Knowledge sharing while EACH school pays upkeep. A failed upkeep causes THAT school to forget. **Owner now selected Option C: first 24h upkeep-free, then each school pays Points every 24h.** The one-shot 24h defend-or-transfer flow and its 20 historical acceptance examples below are NOT the current planned mechanics. **C-03 REV2 OVERRIDE 2026-10-12.** This file is retained only for traceability, not implementation or production authorization.

**Date:** 2026-10-12. **Status:** OWNER DIRECTION CONFIRMED / MECHANICS DRAFT / NOT FROZEN / NOT PRODUCTION-APPROVED.
**Scope:** specification and acceptance examples only. No source implementation, DB writes, deployment, migrations or production ruleVersion.
**Source:** Owner confirmed "Contest 24 giờ, có bảo vệ và chuyển quyền; General Decay chưa bật ở phiên bản đầu" in chat 2026-10-12. See M4D0_OWNER_ALIGNMENT_2026-10-12.md, M4D_DECISION_PACK.md (C-03), GAME_SPEC.md (G-04/G-05), original historical OWNER_REQUIREMENTS.md:1-6,145-151. Current code shared/gameplay/candidates.ts:43-221 is a PURE candidate, not authoritative gameplay.

## 1. Confirmed owner direction (the only newly selected C-03 product decisions)

- Choose **time-bound Shared Knowledge Contest (24 hours)** rather than indefinite shared Knowledge as the base contest mode.
- Contest supports **Defense** by the defending school and **transfer of Knowledge** when the configured defense condition is not met.
- **General/ambient Knowledge Decay is OFF in the first gameplay release.** Do not import V1 grace/retention decay (12h/22h), background sweeps or automatic loss of uncontested Knowledge. The 24h contest deadline is a separate targeted timer, NOT General Decay.
- This confirmation does NOT decide defense cost, exact transition/membership semantics, deadline equality, multischool conflict, HQ protection, adjacency, post-resolution cooldown, score or fog visibility. Such matters are OPEN below.

## 2. Glossary and proposed domain model

- **Knowledge tile T:** world tile with per-school Knowledge membership. **School A (defender):** school with existing Knowledge. **School B (challenger):** school that opens a contest from an allowed border. **Discovered fog:** distinct persisted discovery state, governed by C-08.
- **Proposed representation (not a frozen schema):** contestId, campaignId, tileIndex, defenderSlot, challengerSlot, openedAtUtcMs, deadlineAtUtcMs, defendedAtUtcMs?, status, resolvedAtUtcMs?, ruleVersion, revision, idempotencyKey; with authoritative wallet/world/outbox relation. Names do not mandate DB columns.
- **24h exact duration proposal:** 86,400,000 milliseconds added to authoritative openedAtUtcMs (absolute instant, UTC; never local display timezone). Source timestamp and equality cutoff are open decisions. Display a countdown derived from authorized deadline; client timer is not authority.
- **Proposed logical phases:** OWNED(A) -> CONTESTED(A,B,deadline) -> DEFENDED or TRANSFERRED_TO_B. Reuse existing candidate phases shared, defended, transfer_to_attacker only as implementation references; they are NOT a full persistent state machine.

## 3. Transition contracts (separate confirmed direction from unapproved details)

| Operation / condition | Required invariant | Pending gameplay choice |
|---|---|---|
| Explore uncontested unknown tile | Standard exploration is 1 Point/new tile (partial C-01 confirmation); no general decay timer starts | Eligibility, adjacency/visibility C-01/C-08 |
| Open Contest B against A at T | Authenticate B, verify legal adjacency/eligibility and T state; atomically persist contest, any debit, private ACK and authorized deltas | Shared-entry cost, 4/8-neighbor, whether B immediately gains shared membership, exact visibility |
| Contest active before deadline | Preserve original defender ability to act and show eligible participants a deadline only per C-08; no background decay | What "shared" means for scoring/permissions |
| Defend by A | Apply only once under validated deadline and sufficient resources; protect from double-charge | Cost, whether success removes B membership, keeps temporary sharing, resets or ends contest |
| No valid defense by deadline | Commit a single durable terminal **transfer outcome to B**; prevent both "defended" and "transferred" outcomes | Exact membership bits A/B after transfer; when/how scoring and fog change |
| Already defended/resolved | Replay idempotent outcome; do not re-debit or re-emit event | Whether a fresh contest is allowed immediately, cooldown |
| All tiles without an active contest | Knowledge remains retained, barring another explicitly authorized gameplay action | Nothing under General Decay: it is OFF |

**Proposed transfer interpretation for owner review:** A loses active Knowledge membership for T and B retains it after unsuccessful defense. Prior A fog discovery may persist or not: C-08 must decide separately. This is a PROPOSAL, not an owner-approved bit change.

## 4. Time, persistence and race ordering (technical invariants, not gameplay selections)

1. Compute a durable absolute UTC deadline once when opening a contest. For the 24-hour duration: proposed D = t0 + 86,400,000 ms. Do not recompute it on reconnect, new device, worker restart, school activity or changing time zone.
2. A **single authoritative transaction ordering** decides a simultaneous Defense and timer resolution. The server must determine the effective action time according to a documented trusted clock and resolve expired contests before accepting actions that assume they are active. The event's reception time, DB time and commit order must not silently disagree. Choose exact cutoff semantics below before implementing.
3. A scheduled worker is only a wake-up mechanism, not the truth of a contest. Overdue contests must be recoverable after crashes or downtime and resolvable on relevant reads/actions even if the timer was missed.
4. At most one terminal outcome per contestId + ruleVersion. Repeat worker runs, duplicate timers and retry commands replay the persisted result without another debit, world revision or outbox event. Never acknowledge an applied action before wallet/world/idempotency/outbox are durably committed.
5. An atomic operation must validate actor affiliation and role, tile membership, adjacency, contest status, balance, owner-selected cooldown/protection policy and concurrency. School visibility is filtered server-side under future C-08; an error must not disclose undiscovered opponent metadata.
6. Do not start General Decay jobs or mutate retention for an uncontested tile. **Only the C-03 contest state can schedule a C-03 timeout.**

### Exact-deadline choice pending

- **Recommended option D-excl (UNAPPROVED):** valid Defense when authoritative acceptedAt is strictly earlier than D; at the exact D instant the contest is expired. This permits a clear half-open interval [t0, D). Existing pure candidate supports it with defenseAtDeadlineCounts=false.
- **Alternate D-incl (UNAPPROVED):** accept at exactly D; expiration after D. Existing pure candidate supports it with defenseAtDeadlineCounts=true.
- Persist the choice in the signed ruleVersion and test D-1ms / D / D+1ms. UI timer reaching zero is not sufficient to decide validity. Keep exact unit resolution and trusted timestamp policy explicit.

## 5. Owner choices remaining (recommendations are NOT approvals)

| ID | Decision | Recommended for simplest V1 slice (UNAPPROVED) | Alternative / issue |
|---|---|---|---|
| C03-A | Tile adjacency | Four orthogonal neighbors; B must already own a neighboring Knowledge tile | Eight incl. diagonals or a path-based condition |
| C03-B | Simultaneous school challengers | One active contest per tile; reject any second challenger without debit | Queued challengers or multi-way sharing needs new model |
| C03-C | Defense success effect | End current contest; A retains Knowledge, B loses temporary challenge membership | Continued shared status or deadline reset |
| C03-D | Deadline equality | D-excl: Defense valid only at time strictly before D | D-incl: Defense valid at D |
| C03-E | Transfer membership | After no Defense: B owns Knowledge, A loses it | Shared membership persists with ranking priority; changes area scoring |
| C03-F | HQ/protected tiles | HQ never contestable; protected tile sets must be defined | Special contestable HQ would need new rules |
| C03-G | Reopening after resolution | Define nonzero anti-spam cooldown per tile/pair, but value NOT selected | Immediate replay / cost cap / per-school quota |
| C03-H | Costs | Source historical text suggests 1 Point for contest entry and 1 Point for Defense; NOT frozen by present owner confirmation | Separate fees, review/failure costs; C-01 must approve |
| C03-I | Fog retention after transfer | Retain already discovered geometry but not current opponent private state (a candidate) | Re-fog tile; C-08 required |
| C03-J | School score of contested tile | Decide whether shared tile counts for both / neither / one, and when transfer applies | Requires C-12 scoring freeze |
| C03-K | Replay and failure | Authenticated failures cost 0 and produce no mutation/outbox; prior successful same-key command replays exactly | User-facing error code details require specification |
| C03-L | Contest visibility | Only authorized involved schools see the deadline; no raw mask to other schools (secure conservative candidate) | Public/shared contest alerts subject to C-08 |

**Scope note:** Owner has selected the 24h contest model and General Decay OFF. Every C03-A…L option above requires separate confirmation, especially eligibility, defense cost/effect and transferred bits. No proposed option becomes effective merely because it appears here.

## 6. Acceptance matrix and fixed test fixtures

Use UTC timestamps and integer Points. T=(250,250) is contestable test tile, T_HQ=(20,20) is a purported protected fixture, A=slot0 and B=slot1 with authenticated test identities, and D=t0+24h. Other details such as costs, cooldown and role visibility are **pending**, so expected values below distinguish invariants from parameter-dependent outcomes. These are specifications, NOT tests executed in this session.

| ID / setup and action | Required result / signed expected details |
|---|---|
| AC01: A owns T; no contest, now t0+7 days | **CONFIRMED DIRECTION:** A retains T; no General Decay, retention timer, unsolicited debit or expiration event. |
| AC02: A owns T, B neighbor, B opens challenge at t0=2026-10-12T00:00:00.000Z | **CONFIRMED DIRECTION:** start a 24h contest, deadline 2026-10-13T00:00:00.000Z, eligible participants can potentially defend/transfer. **PENDING:** cost, geometry/membership, ACK/projections. |
| AC03: B attempts open without an eligible adjacent Knowledge tile | Reject without mutation/debit if adjacency is required by C03-A; exact adjacency predicate and nondisclosing error pending. |
| AC04: B and C open simultaneously on same T | Server produces a serialized, deterministic state with no lost writes/double debit. **PENDING C03-B:** reject second / queue / multilateral outcome. |
| AC05: A Defends at 2026-10-12T23:59:59.999Z | Valid under either deadline interpretation if actor/balance eligible; exactly one configured Defense debit and one terminal or renewed state. **PENDING C03-C/H:** cost and resulting A/B bits. |
| AC06: A Defends at exactly 2026-10-13T00:00:00.000Z | **PENDING C03-D:** D-excl -> expired and reject without debit; D-incl -> Defense may succeed. Must sign one. |
| AC07: A Defends at 2026-10-13T00:00:00.001Z | Deadline expired for both interpretations; cannot charge or successfully defend an expired contest. |
| AC08: No Defense by expiry; deadline worker resolves T | **CONFIRMED DIRECTION:** durable transfer outcome in B's favor exactly once. **PENDING C03-E/I/J:** A/B membership, fog, score and delivery fields. |
| AC09: Defense request races with timer settlement at D | Only one of Defended or Transferred commits for the same contest; retries return committed outcome; exactly one authorized view revision/event sequence. |
| AC10: Two A-school players Defend same contest with distinct keys | At most one effective Defense charge and one terminal outcome; other action handled as no_change/reject under a signed policy (not a second charge). |
| AC11: Same key K replays open/Defense after ACK loss | Persisted ACK outcome replayed with no additional charge, contest, world revision or published outbox effect. Different payload using K rejects as conflict. |
| AC12: Wrong-school actor C or unauthenticated visitor attempts Defend | No unauthorized mutation or debit; no leaking tile ownership/hidden contest facts in errors. |
| AC13: A Points < required Defense fee; B Points < entry fee | No debit, contested state unchanged; fee amounts pending C-01. |
| AC14: Server stops at D-2s and restarts at D+30m | Deadline unchanged. Worker/recovery settles the same final state once; no extension due to downtime and no arbitrary loss of unrelated A tiles. |
| AC15: Worker resolves same expired contest three times | First settled outcome remains; next two are idempotent no-ops; wallet/world/outbox unchanged. |
| AC16: A loses T, reconnects; B reconnects; spectator requests T | Own/mutual/private state per signed C-08; no raw opponent mask or unauthorized timers; **PENDING:** A prior discovered fog persistence. |
| AC17: B attempts re-challenge immediately after successful A Defense | **PENDING C03-G:** cooldown/reopening rule, exact zero-charge rejection or new challenge if allowed. |
| AC18: Attempt contest against T_HQ or an object footprint | **PENDING C03-F/C-05:** explicit protected geometry; protected action has no state/debit side effect. |
| AC19: No contest on T for 30 days despite no running activity | **CONFIRMED DIRECTION:** no passive general knowledge loss. Running API absence does not affect contest timer correctness. |
| AC20: Combat/contest changes T but an unrelated school D never discovered it | D cannot see raw ownership/mask/contest metadata solely from a cross-school event; authorized public information awaits C-08. |

## 7. Fit against existing code and acceptance gates

**Current pure candidate compatibility:** shared/gameplay/candidates.ts:45-56 already exposes sharedEntryCost, defenseCost, contestDurationMs and defenseAtDeadlineCounts; 75-113 exposes a ContestRecord and three phases; 131-220 covers evaluation of open/defend and timer-phase inference. Existing tests/m4b-gameplay.test.ts:228-385 demonstrate development fixtures and both deadline equality policies, NOT owner decisions or durable E2E tests. General decay candidate is separate at candidates.ts:222 onward: its existence is not authorization and it stays disconnected for first-release C-03.

**Gaps before any M4-D1 code:** state machine must map phases into authoritative persisted Knowledge membership; confirm the one-active-contest invariant or extend representation; implement role/adjacency/HQ predicates; record deadline under trusted clock, durable recovery/settlement and idempotent outbox; enforce C-08 projections and C-12 scoring. Do not patch candidate parameters to a production default while those gates are open.

**Freeze checklist:** owner selects C03-A…L; C-01 approves fees and no_change; C-08 approves visibility including post-transfer fog; C-12 approves scoring (before any official leaderboard); every exact expected membership, charge, outcome and authorized event in AC01–AC20 is signed; immutable ruleVersion, effective campaign, change policy, rollback and acceptance evidence recorded; then Technical Lead requests separate owner authorization for M4-D1 implementation.

**Explicit stop:** This document records only the 24-hour Contest direction and first-release General Decay OFF as owner decisions. Nothing here starts a timer, enqueues a job, alters a wallet, enables a production mutation opcode or signs off an M4-D milestone.
