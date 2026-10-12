# C-03 Rev2 — Shared Knowledge & Contest-specific Upkeep

> **C-03 NEW OWNER DECISIONS (2026-10-12):** [Incumbent, ~2h Decay, 48h Consolidation and Exact Contributor Refund Addendum](M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md) **OVERRIDES conflicting earlier wording.** The *current lawful holder at new Contest start* gets incumbent/free-retention privilege, NOT the first-ever discoverer. When an eligible contested cluster ENTERS DECAY at tDecayStart, **both 2h fade and 48h consolidation clocks start TOGETHER**: forgetting at tDecayStart+2h, settlement deadline at tDecayStart+48h (46h remain after forgetting). The non-incumbent successor's fee is **ceil(N/2) Points**, rounding UP for odd N, with eligible tile/component snapshot rules still pending. Failed consolidation makes eligible inherited Knowledge neutral and **refunds every accepted Point to its ORIGINAL individual contributor**, never the old holder. Store idempotent contributor escrow/refund ledger. 24h initial free shared-upkeep and connected-cluster maintenance rules still apply; global General Decay remains OFF. Earlier grace, contribution eligibility, mixed-holder cases and precise deadline inclusivity remain OPEN. Owner defers bespoke gameplay for exact simultaneous failure of both schools; fail-closed transaction correctness is still mandatory. **Docs only: no production code, no M4-D1/D2 authorization.**

**Date:** 2026-10-12. **Status:** OWNER DIRECTION PARTIALLY CONFIRMED (C: 24h FREE + RECURRING 24h UPKEEP); FEES/GRACE/EDGE CASES OPEN; NOT FROZEN; NOT PRODUCTION.
**Scope:** M4-D0 documentation ONLY; no code, timers, DB migrations, API integration, or production ruleVersion.

> **LATEST OWNER ECONOMY UPDATE — SECTION 12 SUPERSEDES OLDER PER-TILE UPKEEP EXAMPLES:** New tile 1 Point, joining another school Knowledge 2 Points per tile (owner illustrative baseline), connected shared cluster upkeep 1 Point per participating school per 24h paid cycle regardless of number of tiles. First 24h upkeep-free. Component topology and billing mechanics remain OPEN; NOT signed production.

## 1. Provenance and supersession

Owner's new direction: Knowledge can be shared. Both schools may keep the same contested Knowledge for as long as they both spend Points to maintain it, potentially forever. If one school fails to maintain and forgets, the other retains Knowledge. Renewal is independent for each school.

This **supersedes** the earlier mandatory one-shot 24h -> defended/transfer terminal logic documented in M4D0_C03_24H_CONTEST_SPEC_DRAFT.md. Defense or maintenance success should **not automatically evict the other maintaining school**.

Previously approved context: 24-hour Contest and General Decay OFF for initial release. Interpret carefully:
- **General Decay:** remains OFF for ordinary, uncontested Knowledge.
- **Contest-specific Upkeep / Forgetting:** applies to shared contested Knowledge and can make an individual school forget if it does not maintain.
- **OWNER CONFIRMED OPTION C:** The first 24 hours after sharing begins are upkeep-free; afterward, each participating school must pay Points once per successive 24-hour upkeep cycle. Only the duration/cadence is confirmed, NOT cost, payment mode, grace, cutoff, caps or what happens when both fail. No automatic debit or unconditional transfer is approved.

The phrase 'two tiles' is interpreted provisionally as TWO school Knowledge memberships on ONE logical world tile T. If owner means two distinct map coordinates, this requires clarification.

## 2. Proposed state and per-school obligations

For each logical tile T, Knowledge is recorded per school (immutable slot bits). A=school slot 0, B=slot 1:
- OWNED_A -> SHARED_A_B when eligible B enters.
- SHARED_A_B -> SHARED_A_B repeatedly if BOTH maintain. No automatic end after 24h.
- SHARED_A_B -> OWNED_A if B misses its valid obligation while A maintains.
- SHARED_A_B -> OWNED_B if A misses its valid obligation while B maintains.
- SHARED_A_B -> outcome UNDECIDED if BOTH fail. Do not assign arbitrary winner.
- The school that loses active Knowledge might retain prior discovered fog; C-08 must decide. School score changes require C-12.

Each school's upkeep is independent: per school/tile lastPaidAt, dueAt/paidThrough, optional graceUntil, status, ruleVersion and command outcome. These are conceptual fields, NOT an approved DB schema. Manual payment vs opt-in auto-pay and partial/advance payment remain OPEN. No automatic Point debit is authorized by this note.

## 3. Required technical invariants

- PostgreSQL transaction atomically commits authorized Point debit, per-school Knowledge/upkeep state, revisions, idempotency result and filtered outbox; successful ACK only after commit.
- Each per-school renewal and expiration must serialize with concurrent operations on the same membership. Exactly one effective fee per obligation and at most one expiration transition.
- Durable UTC timestamps are server authoritative; frontend countdown, time zones and client clocks are not.
- Timers wake settlement but never own truth; restart/late worker must recover overdue per-school obligations without resetting due dates.
- No general decay sweep or automatic forgetting of uncontested Knowledge.
- Apply C-08 school-isolated visibility: no raw rival masks, personal wallet, opponent private due dates or hidden tile state in public frames/errors.
- Existing shared/gameplay/candidates.ts:43-221 resolves terminal defended/transfer phases and does NOT implement indefinite shared memberships. The separate general-decay candidate must NOT be enabled. Redesign is required after freeze, not merely a constant change.

## 4. Owner decisions remaining

| ID | Topic | Unselected alternatives / required specifics |
|---|---|---|
| R2-01 | **OWNER SELECTED: C** | First 24h from shared-start is FREE of upkeep; first paid cycle begins at +24h, then repeats every 24h while shared memberships continue. Anchor, due equality and grace are specified separately below as implementation proposals, not signed. |
| R2-02 | **Owner working baseline: 1 Point per school per connected shared Knowledge cluster per paid 24h cycle** | NOT per tile. Production fee freeze, payer and cluster semantics remain PENDING; see section 12. |
| R2-03 | Payment mechanism | Manual renewal, opt-in auto debit with spend limits, prepayment policy |
| R2-04 | Due/grace semantics | Separate dueAt per school vs synchronized due, exact equality boundary, optional grace/warnings |
| R2-05 | One school misses | Exact loss trigger and membership/fog/scoring output; possibility of reclaiming |
| R2-06 | Both schools miss | Both forget and neutral tile, dormant state, or specified fallback; no arbitrary winner |
| R2-07 | Admission & third school | 4/8 neighbor, consent, 2 schools maximum or N, HQ restrictions |
| R2-08 | Exit/reentry | Leave voluntarily, reenter costs, anti-spam cooldown, prior upkeep history |
| R2-09 | Fog and score | C-08 loss visibility and C-12 ranking while two schools share |
| R2-10 | Rule freeze | Effective campaign, signed ruleVersion, exact cases, migration/rollback, audit |

**Economy gate, updated:** 1 Point for fresh Knowledge exploration; **illustrative owner working baseline of 2 Points per school/tile new Shared Knowledge entry; 1 Point per participating school/CONNECTED shared cluster per paid 24h upkeep cycle**. These are design directions, not signed production prices. Payer, eligibility and no_change/refund remain open in C-01.

## 5. Acceptance scenarios

Use fixture T=(250,250), school A slot0, B slot1, C slot2; t0=2026-10-12T00:00:00.000Z. D=t0+24h=2026-10-13T00:00:00.000Z is the first upkeep-cycle boundary under owner-selected Option C. Under the proposed anchored schedule, D is where the first paid period starts; the exact enforcement cutoff/grace is not yet approved. The latest owner example supplies F=1 Point **per SCHOOL/CONNECTED CLUSTER**, NOT per tile; it remains a working baseline, not a published production ruleVersion.

| ID | Input | Required result and unresolved detail |
|---|---|---|
| SC01 | A has sole uncontested T, inactive 30 days | A does NOT lose Knowledge. General Decay OFF. |
| SC02 | B legally joins A on T | Both A and B may hold Knowledge. Entry fee and adjacency pending. |
| SC03 | A and B each pay valid upkeep for twelve consecutive cycles | Both retain T; unlimited sharing if continued. No forced 24h terminal transfer. |
| SC04 | A pays; B fails after selected grace | B alone forgets T, A retains. Timing/grace pending. |
| SC05 | B pays; A fails after selected grace | A alone forgets T, B retains. |
| SC06 | Both fail their upkeep | Outcome UNDECIDED; do not default to A or B victory. |
| SC07 | Payment at D-1ms, 23:59:59.999 after sharing | Initial sharing is still in free window; early prepayment if permitted is an OPEN choice, not an automatic fee. |
| SC08 | Payment exactly at D=t0+24h | **Confirmed:** first paid 24h cycle begins. **Open:** exact cutoff inclusion, authorized collection/prepayment and grace. |
| SC09 | Payment at D+1ms | First paid cycle is active; whether a late payment is within grace is OPEN; do not automatically forget or waive a charge. |
| SC10 | A has 0 Points; B has enough | B cannot subsidize A without an explicit donation rule; A cannot spend Crystals to substitute. |
| SC11 | A balance F-1 and attempts renewal costing F | Reject insufficient Points, no debit, no renewal record. |
| SC12 | A balance F, valid renewal costing F | Exactly F debit, update only A obligation, durable ACK and authorized outbox. |
| SC13 | Both school renewals commit concurrently | Both retained and charged once; no lost bits/wallet changes. |
| SC14 | Two players of A renew same obligation with different keys | At most one fee for same obligation. Extra action no-change/reject under signed policy. |
| SC15 | Replay a successful renewal with same idempotency key | Return same committed outcome; no second debit/revision/event. |
| SC16 | Reuse same key with different renewal payload | Conflict and no state mutation. |
| SC17 | Renewal races expiration exactly at D | Deterministic serialization, no both-paid-and-expired inconsistency. |
| SC18 | Server down across multiple upkeep deadlines | Durable catch-up; unchanged due origins; exact missed-cycle debt rules pending. |
| SC19 | Three workers settle same expired A membership | One expiration and one outbox transition at most. |
| SC20 | Client changes timezone/device clock | Absolute UTC payment and expiry unchanged. |
| SC21 | A disconnected until after expiration | Server returns authoritative current state, never reactivates without rule. |
| SC22 | A forgets; B retains; A reconnects | C-08 determines A fog persistence and what B details are visible. |
| SC23 | C tries joining shared A/B T | Two-school capacity vs multi-school behavior UNDECIDED. |
| SC24 | Expired A tries rejoining T with sufficient Points | Reentry fee/cooldown and contact eligibility UNDECIDED. |
| SC25 | T is inside a protected HQ footprint | Permission/protection C-05/C-03 pending; no unauthorized HQ mutation. |
| SC26 | T has upkeep; unrelated uncontested U is inactive | No General Decay side effect on U. |
| SC27 | Leaderboard recalculated while A and B both maintain | C-12 determines 1 score each, shared weighting, or other rule. |
| SC28 | Public visitor requests A's upkeep debt and B's balance | Never disclose private balances, due records or raw masks; C-08 projection. |
| SC29 | Approved auto-renew cap exhausted | No debit beyond consent/cap; handling of forgetting subject to R2-03/04. |
| SC30 | Existing one-shot 24h contest migrated to Rev2 | Explicit versioned migration required; no fabricated paidThrough values. |

## 6. Owner-selected Option C: explicit cycle semantics

**OWNER-CONFIRMED:** Each participating school pays **zero upkeep Points** for the first 24 hours of newly shared/contested Knowledge. Thereafter, **each school** must pay Points for each subsequent 24-hour period *while the Knowledge remains shared*. Sharing can continue indefinitely if both meet their upkeep obligations. This is NOT a free first exploration: separate C-01 charges for entering/revealing Knowledge, if approved, are unaffected.

**Clock example (illustrative arithmetic, not a signed expiry/grace policy):**
- t0 = 2026-10-12T00:00:00.000Z: A and B enter SHARED(T); free upkeep window [t0, t1).
- t1 = 2026-10-13T00:00:00.000Z: first *paid* 24h period starts, [t1, t2). Both A and B have independent obligations to pay their own fee F to retain shared Knowledge.
- t2 = 2026-10-14T00:00:00.000Z: second paid period starts, [t2, t3), only if T remains shared.
- t3 = 2026-10-15T00:00:00.000Z: third paid period starts. Continue for as long as multiple schools maintain it.
- Due-cycle index n >= 1: boundary(n) = t0 + n*86,400,000ms. Paid period n is [boundary(n), boundary(n+1)). **Proposed** anchoring is fixed to shared-start t0, not sliding 24h after the last payer action; no deadline drift after retries/reconnects.
- "Free first 24h" applies only to UPKEEP. Whether one-time shared entry/review fees exist is C-01 OPEN. Treat any new school added later, or a formerly expired school rejoining, as R2-07/R2-08 OPEN: fresh free window vs inherited schedule is not decided.

**Unresolved enforcement boundary:** A billing period starting at t1 does NOT by itself mean an unpaying school loses Knowledge instantly at t1. Define the due cutoff, allowed prepayment, warning/grace window and expiry semantics before implementing. Until those are signed, this section defines cadence, NOT exact time of forgetting.

**Scope separation:** Every ordinary, uncontested Knowledge tile has no upkeep; General Decay remains OFF. When sharing ends and only one school holds T, the *proposed* simplest interpretation is that sole ownership stops future shared-upkeep billing. Decide whether a prepaid unused period is refunded/credited before implementation.

## 7. Cost, payment source and fairness: options for owner approval (NOT selected)

| Dimension | Option A | Option B | Engineering / UX consequence |
|---|---|---|---|
| Fee per school | **OWNER WORKING BASELINE F=1 Point per connected shared cluster per paid 24h cycle**, regardless of tile count | Final signed production price and cluster adjacency still OPEN | A 500-tile connected cluster costs 1 Point to maintain for each participating school/cycle; disconnected clusters each cost separately. |
| Who pays | Any authorized student of that school contributes the single shared obligation | An explicit pooled school treasury funded by student Points | One obligation per school/tile/cycle, never one charge per student. Identity/wallet authorization C-01/C-11 required. |
| Collection | Manual "Maintain Knowledge" action by eligible student | Explicit opt-in auto-renew with per-day cap and low-balance notice | **No silent automatic debits** without separately approved consent, fee and audit rules. |
| Prepayment | Only pay the currently actionable billing cycle | Prepay a bounded N-cycle credit | Must never charge twice for same membership+cycle. |
| Batch UI | Server-authoritative multi-tile maintenance preview and atomic per-item results | Individual one-tile action | Large quantities need usability and transactional throughput review, not client-computed fee totals. |
| Renewal after shared state collapses | Remaining sole school stops upkeep next cycle; no refund of already-spent fee (PROPOSAL) | Prorated or credited fee, fixed grace until resolution | Decide fairness with school wallets and contest scoring. |

**Updated recommendation (not a freeze):** simulate F=1 Point per participating school/CONNECTED contested cluster per paid 24h cycle, with 2 Points per newly joined already-known tile as a one-time sharing premium. Simulate compact and disconnected shapes, bridge merges, splits and authenticated payer selection. Numeric examples are owner-provided working direction, not a production ruleVersion; running conversion remains unknown.

## 8. Grace period and both-unpaid outcomes (NOT selected)

**Grace alternatives:** G0 = no grace, expiry at the approved due boundary; G6 = six hours after each cycle boundary; G12 = twelve hours after each boundary. A **six-hour** recovery window is a reasonable first playtest proposal to avoid punishing sleep/work schedules, but is not approved. In the G6 fixture, the grace deadline for t1 is 2026-10-13T06:00:00.000Z. Exact inclusive/exclusive cutoff must be signed (candidate: payment accepted if trusted timestamp < graceDeadline; expire at >= graceDeadline).

**Suggested state during grace (UNAPPROVED):** A and B retain membership while "upkeep_due" and are warned privately. Payments are for the ORIGINAL [t1,t2) period; paying later does not slide the next due to t1+6h+24h. Keep expiry atomic and idempotent. Do not display A's debt to B/public without C-08 approval.

**When ONE fails and the OTHER pays:** owner intent is clear: the delinquent school forgets T after the approved expiry/grace, maintaining school retains T. Proposed sole Knowledge state stops contested-upkeep going forward; if school A already paid while B forgot, no second payment by A for the same period.

**When BOTH fail (owner did NOT yet decide):**
- **Option N — recommended for a symmetrical game:** both active Knowledge memberships are removed after their approved grace expires; T becomes neutral/unclaimed Knowledge. No original-school fallback or arbitrary winner. Prior fog discovery is a separate C-08 policy.
- **Option H — dormant:** both memberships flagged temporarily dormant, with an explicit reinstatement window and no scoring. Requires timeouts and content rules.
- **Option O — historical owner fallback:** initial owner retains T despite also failing maintenance. This risks asymmetry; only implement if owner explicitly desires it.

If both miss but expire at different effective instants, a brief provisional single-school state may arise. Resolve by comparing each *school's* independently committed obligations, not by randomly assigning ownership; define whether both can lapse in the same settlement transaction. Subsequent sharing/re-entry rules are independent decisions.

**Operational choices still open:** warning at due-2h or due-6h; optional opt-in notifications; loss announcements; server outage compensation; pause windows during maintenance; protected weekends; refundable payment after administrative correction. These cannot be inferred from 24h cadence.

## 9. Option-C-specific acceptance cases, SC31–SC48

The outcomes marked **CONFIRMED** follow the owner's free-24h/recurring-24h selection. Other outcomes below are **PROPOSED FIXTURE** or **PENDING** and cannot be treated as production expectations. The owner's working example is F=1 Point **per school/connected cluster** per paid 24h; G=6h is only a proposed TEST FIXTURE, not owner-approved.

| ID | Given and when | Expected output / status |
|---|---|---|
| SC31 | T enters SHARED(A,B) at 2026-10-12T00:00:00Z; query upkeep at t0+23h59m59s | **CONFIRMED:** no upkeep debit or overdue flag for the FREE cycle; both remain active. Initial shared-entry fee (if any) is separate. |
| SC32 | At t0+24h = 2026-10-13T00:00:00Z | **CONFIRMED:** first paid 24h period begins; A and B each have an independent obligation F, not 2F deducted from one user. **PENDING:** due cutoff and grace. |
| SC33 | A and B paid for [t1,t2); now t2=2026-10-14T00:00:00Z | **CONFIRMED:** next paid 24h period begins. No sliding of scheduled boundary in proposed fixed-anchor model. |
| SC34 | A and B each renew for 100 cycles | **CONFIRMED:** both can hold the tile indefinitely; never auto-transfer merely because an absolute Contest clock passes. |
| SC35 | F=1 fixture, A has 5 Points, B has 9, both pay for cycle 1 | Proposed individual deltas A=4, B=8, membership A+B retained; **PENDING:** which authenticated individual or school wallet is actually debited. |
| SC36 | F=1 fixture, same school has 2 players concurrently renew one tile+cycle | One obligation settles and at most one F is charged for that school/tile/cycle. Retry/no_change semantics require C-01 signature. |
| SC37 | At t1 with G6 proposed grace, B has paid but A has not; current time t1+3h | Under G6 candidate, A is DUE but still in grace; do not immediately transfer. Payment permission, alert visibility and leaderboard treatment PENDING. |
| SC38 | At t1+6h under G6, A still unpaid, B paid | Under proposed exclusive cutoff, A loses membership exactly once, B remains; no next shared-upkeep cycle if T becomes sole B, unless alternate billing policy approved. |
| SC39 | A pays at t1+5h59m59s under G6 | Candidate payment is valid and covers original [t1,t2) period. Next boundary remains t2, not t1+29h59m59s. |
| SC40 | A pays at exactly t1+6h under G6 | **PENDING:** choose exclusive/inclusive grace cutoff; no UI timing race or simultaneous paid+forgotten result. |
| SC41 | G0 no-grace option: A unpaid at t1, B paid | Under G0 candidate, A immediately expires at selected deadline; B retains. This is an alternative, NOT current selected grace. |
| SC42 | Both A and B unpaid after their valid grace | **PENDING:** recommended neutral/unclaimed tile (neither active), alternate dormant or historical owner; never silently award the tile to A/B. |
| SC43 | A and B both pay after first 24h; next cycle A alone fails | A forgets only when its own obligation expires, B retains; prior successful A payment is not reversed by a different period's expiration. |
| SC44 | A pays early for paid cycle 2 while paid cycle 1 still active | **PENDING:** prepayment permitted/blocked, cap, double-charge prevention; do not silently extend arbitrary future deadlines. |
| SC45 | B joins an already sole A-owned T; C attempts to join after 36h | **PENDING:** two-school cap vs 3+ and C's own initial free period vs common shared anchor. A/B paidThrough must not be overwritten. |
| SC46 | Server restarts at 2026-10-13T08:00Z after t1 and G6 | Re-evaluate persisted per-school payment and grace, expire only genuinely unpaid memberships once; never reset t0 or repeat debit. |
| SC47 | School A has 500 shared tiles arranged in one connected shared cluster | **UPDATED OWNER WORKING BASELINE:** upkeep 1 Point for A for that paid 24h cycle (and 1 for B if B also participates), not 500. If those 500 tiles form multiple disconnected components, cost is 1 per qualifying component per school. |
| SC48 | B forgets and A becomes sole Knowledge holder; t2 arrives | **PENDING:** recommended no further shared upkeep for sole A and no automatic refund of first paid cycle; C-01 refunds and R2-05 must be signed. |

## 10. Approval decisions left after selecting C

The 24h FREE + recurring 24h cadence is now **SELECTED**. Prioritize the remaining decisions in this order, without inventing production defaults:

1. **Fee F and payer:** owner-directed working baseline is **1 Point per school/connected shared cluster/cycle**, plus a **2-Point per tile one-time shared entry example**. Still confirm production cost, cluster geometry/school-pair grouping, individual student wallet vs pooled school balance and refund/no_change behavior.
2. **Grace G and cutoff:** None, 6h, 12h or another limit; whether on-time means strictly before due+G; notices and server-outage compensation.
3. **Both-unpaid branch:** Symmetric neutral/unclaimed (suggested), temporarily dormant or first-discoverer fallback.
4. **Billing edge semantics:** early payment/prepay, manual vs opt-in auto-renew, single-school billing cessation, any refund and late rejoin.
5. **Multi-school eligibility and social balance:** 2-player school cap, third school arrival, HQ exemption and 4/8 adjacency.
6. **C-08, C-12 and production gates:** Fog after forgetting, public/private due status, leaderboard counted bits; signed ruleVersion/effective campaign, deterministic acceptance results, rollback and M4-D1 authorization.

No choice in this section other than Option C is owner-approved.

## 11. Freeze & implementation gates

Before M4-D1/D2: R2-01 Option C is selected. Owner must resolve remaining detailed parameters R2-02…R2-10, complete expected membership/fog/wallet/ACK/outbox for SC01…SC30, sign C-01 fees, C-08 visibility, C-12 school score and versioned map/campaign constraints. Publish immutable ruleVersion and record rollback policy.

**STOP CONDITION:** This revision documents the owner's latest direction, not an instruction to enable production. No timer jobs, point debit, contest mutation or general decay may be activated from this document.
## 12. 2026-10-12 owner clarification — SHARE ENTRY PREMIUM + CONNECTED CLUSTER UPKEEP

**LATEST OWNER-DIRECTED ECONOMY (PARTIAL, NOT SIGNED PRODUCTION RULEVERSION):**

- A fresh/unknown Knowledge tile costs **1 Point** to explore. This remains the reference baseline from C-01.
- Gaining a school’s Knowledge membership on a tile **already known by another school** (joining Shared Knowledge, “ké tri thức”) has a **higher one-time entry cost: example baseline 2 Points per tile**. It is NOT 1 Point/tile. Owner introduced these values as an illustrative balanced economy (“VD”) but explicitly directed the 2-Point sharing premium; preserve the example as an owner-confirmed **working numeric baseline**, subject to final balance freeze, actor wallet and edge semantics.
- **Upkeep is NOT charged per tile.** A geographically CONTIGUOUS connected component (“cụm tri thức giao lưu liền kề nhau”) of Shared Knowledge costs **one Point to maintain for the entire cluster per upkeep period**, regardless of tile count. To preserve the previously confirmed reciprocal obligation, interpret this as **1 Point per participating school per shared cluster per paid 24-hour cycle**, not 1 Point for all participating schools combined. If that scope is not what owner intended, request correction before production freeze.
- Option C remains: **first 24h of sharing is upkeep-free; subsequent paid cycles are 24h**. This is separate from the one-time 2-Point join fee. Each school must satisfy its own obligation; both may maintain indefinitely; delinquent school alone forgets according to approved grace.
- “Cụm” is a set of logically shared Knowledge tiles connected by an agreed adjacency rule and sharing membership relation; it is **NOT** defined by an art object's footprint, render chunk or school HQ. Exact 4-neighbor versus 8-neighbor connectivity and whether different school pairs can belong to one upkeep component remain **OPEN**.
- **General Decay stays OFF** for unshared ordinary Knowledge. Upkeep/forgetting applies only to active Shared Knowledge clusters. The older per-tile daily fee and 500 tiles = 500 Points/day examples appearing earlier in this document are **SUPERSEDED** by this section.

### 12.1 Billing expression (working interpretation, not production code)

For a billing school S and cycle K, define G(S,K) as the set of eligible active, connected SHARED-KNOWLEDGE COMPONENTS for S at the billing snapshot. A **proposed** cost expression consistent with owner direction is:

- New unshared Knowledge reveals: 1 Point × number of eligible newly explored tiles.
- One-time entry into another school's previously known Knowledge: 2 Points × number of new school/tile memberships joined.
- Shared upkeep: **1 Point × number of eligible connected shared components that school S maintains for cycle K**. No multiplication by tiles inside a component.
- If both A and B participate in one shared cluster C, proposed total across independent school obligations is **2 Points per paid 24h cycle** (1 for A and 1 for B), not 1 total.
- The source of payment (student wallet or pooled school treasury), billing anchor for merger/split, eligibility and error/no_change cost are all OPEN under C-01/C-03.

This is a conceptual economic model, **not authorization for client-controlled pricing or production debit**. Atomic server-authoritative derivation is mandatory.

### 12.2 Topology model and technical hazards

**Connectivity pending:** Four orthogonal tile-edge neighbors is the preferred predictable test fixture. Eight-neighbor (diagonal) adjacency gives different components. Owner has NOT specified 4 vs 8; do not freeze.

**Cluster school-pair scope pending:** Example T1 shared A+B and neighboring T2 shared B+C. Under pair-specific components, these are distinct chargeable sharing agreements for B. Under school-centric components, they could be one B cluster. Pick explicitly before implementing; do not collapse every adjacent school-mixed tile into one globally free component.

**Merge and split proposals (UNAPPROVED):**
- If cluster C1 and C2 become adjacent by opening a bridge tile midcycle, the NEXT cycle may bill the new single component. Already-paid current-cycle fees should not be silently double-refunded or prorated without owner decision.
- If one bridge tile loses a membership and cluster C splits into C-left and C-right, avoid charging another upkeep fee retroactively for an already settled period. Propose computing a deterministic component snapshot at the next cycle boundary.
- New tiles added during a paid cycle must NOT restart the 24h free window for the pre-existing paid cluster. Whether the newly added tiles get any independent free period is OPEN.
- A cycle settled for a component must retain a canonical identity/lineage or equivalent persistent paid obligation IDs through merge/split and crashes; do not base durable fees on ephemeral cluster traversal order.
- Huge clusters spanning sectors/chunks may cause DB write amplification and M3.6 outbox fanout; avoid repeatedly rewriting 1e6-tile global masks. Bounded incremental union for additions and bounded re-evaluation for removals are engineering candidates, not decided architecture. Always commit wallet/membership/outbox atomically.

### 12.3 Owner-confirmed economic examples

| Shape | One-time sharing entry cost to B | Recurring upkeep for one paid 24h cycle | Interpretation |
|---|---:|---:|---|
| 1 shared tile with A+B | 2 Points | A:1, B:1 | First 24h still free upkeep |
| 5 edge-adjacent A+B shared tiles | 10 Points to B | A:1, B:1 | Each school pays ONCE for its own connected cluster |
| 100 edge-adjacent A+B shared tiles | 200 Points to B | A:1, B:1 | Size does not increase daily cluster fee |
| Two disconnected A+B shared clusters | Depends on newly joined tile count | A:2, B:2 | Distinct components in the test fixture |
| Same two clusters connected by one bridge tile | +2 Points for B joining that bridge | NEXT cycle proposed A:1, B:1 | Merge billing timing still OPEN |
| Five total shared tiles arranged in one continuous chain | 10 Points to B | A:1, B:1 | Linear snake connected by shared-edge adjacency |
| Four tile corners touching diagonally only | 8 Points to B | 1 or 4 clusters depending on adjacency | Pending 4- vs 8-neighbor owner choice |

All fee values are owner’s illustrative working baseline, **not a frozen immutable production price**. UI calculations must originate from authorized server quotes under signed rules.

### 12.4 Pending design decisions specific to connected upkeep

| ID | Question | Status |
|---|---|---|
| R2-11 | Connectivity: 4 orthogonal neighbors vs 8 including diagonals | OPEN; 4-neighbor is proposed |
| R2-12 | Component identity: same school pair (A+B) vs school-centric shared components crossing pair membership | OPEN; do not assume |
| R2-13 | Merge/split: next-cycle billing snapshot, prepaid credits, cluster identity lineage, orphaned obligations | OPEN |
| R2-14 | Start of free 24h window: per shared cluster start, per participating school's entry, or per tile; rejoin/new bridge anti-reset rule | OPEN |
| R2-15 | Obligation payer: player who initiates sharing, any authorized school student or pooled school Points treasury | OPEN |
| R2-16 | Joining an already-known tile: charged exactly once per school/tile on committed new membership; no charge for repeat/no-change, retry, invalid adjacency | Owner-directed economic intent; exact failure/refund policy pending freeze |
| R2-17 | Expiry of a single school's cluster upkeep: loss scope all participating tiles, only overdue component, partial contributions, surviving school's unaffected membership | Direction: delinquent school forgets; exact component snapshot/membership effects OPEN |
### 12.5 Additional cluster acceptance scenarios SC49–SC70

Use the owner-directed **working balance illustration**: fresh tile exploration 1 Point; newly joining already-known Knowledge 2 Points per tile; **per-school connected Shared Knowledge upkeep 1 Point per paid 24h cycle** after first 24h free. All geometry examples assume FOUR orthogonal neighbors merely as a TEST FIXTURE. The final neighbor rule, school-pair grouping, fee currency source, grace and cluster merge billing must be signed before these become executable production acceptance tests.

| ID | Input | Expected behavior or pending branch |
|---|---|---|
| SC49 | B learns one A-known tile T | One-time example entry debit **2 Points** to authorized B-side payer; A's already-known T is not charged another entry fee; membership A+B if eligible. |
| SC50 | B explores an unclaimed tile T | Existing baseline debit **1 Point**, not the 2-Point sharing premium. |
| SC51 | B learns five eligible edge-connected A-known tiles in five distinct entry actions | B's total example entry spend = **10 Points**; once shared cluster connected, only **1 upkeep Point per school per paid cycle**, not 5. |
| SC52 | One A+B shared cluster has 1,000 orthogonally connected tiles | Regardless of size, upkeep example = A:1 Point and B:1 Point per paid cycle. No per-tile multipliers. |
| SC53 | A+B share two disconnected components at cycle boundary | Each school maintains two components separately: A:2 Points, B:2 Points in owner example. |
| SC54 | Two A+B components connect with one new A-known bridge learned by B | One-time B entry example +2 Points for bridge. A single connected component next cycle may cost 1 upkeep Point for A and B; **merger billing transition** pending. |
| SC55 | Remove A membership on the bridge, splitting A's components in two while B retains the bridge | Recompute per-school component membership at a defined snapshot; no accidental B loss; how and when the split increases A's fee is PENDING. |
| SC56 | Diagonally touching shared T1=(10,10), T2=(11,11) | Under 4-neighbor they are disconnected (2 cluster fees/school); under 8-neighbor connected (1). Owner must choose. |
| SC57 | A+B shared T1 touches B+C shared T2 | Is B billed for 1 combined component or 2 pair-specific components? **PENDING R2-12**, never silently merge across school-pair agreements. |
| SC58 | A and B have paid cluster upkeep; school C legally joins one tile during cycle | Existing paid obligations must not disappear/duplicate; C's eligibility, own initial free window and whether this creates a new component are PENDING. |
| SC59 | B expands a paid 5-tile cluster by 6 tiles halfway through a day | B pays 6×2=12 Points working example entry premium; cluster upkeep already settled once for current cycle; **no forced restart of original cluster's free timer**. New tile fee attribution pending. |
| SC60 | Two actors from school B both join same A-known tile concurrently | At most one new B membership and one effective 2-Point entry debit; repeat/no_change has no accidental premium. |
| SC61 | B Points=1, T already known by A, B requests join | Insufficient for 2-Point example premium; no B membership and no charge. |
| SC62 | B Points=2, one valid A-known tile, approved join | Example B Points becomes 0; exactly one successful membership change and one committed event/ACK after transaction. |
| SC63 | A and B each have 4 Points, cluster C of 500 tiles (already joined) and paid cycle starts | With working cluster fee, each school spends exactly 1 Point (balances 3 each), NOT 500. |
| SC64 | A and B both pay cluster C, but C splits into two midcycle | **PENDING:** freeze component snapshot/lineage policy; recommend no retroactive extra debit or refund; apply changed component count next cycle. |
| SC65 | Bridge joins two A+B paid clusters after each paid 1 Point earlier this cycle | **PENDING:** refund/carry-forward vs no retroactive adjustment; never return client-derived negative debit without signed policy. |
| SC66 | Only B forgets a shared 100-tile component after approved grace | Remove only B's active shared memberships in the eligible expired component, preserve A's Knowledge; A's next shared-upkeep count may shrink; precise snapshot membership C-08/C-12 pending. |
| SC67 | Both A and B fail to pay for one connected shared component | Both-forget-neutral vs dormant vs historical-owner fallback **PENDING**; do not pick a winner. |
| SC68 | B pays upkeep for one cluster but not a separate disconnected cluster | B's paid cluster remains; only unpaid cluster membership becomes liable to forget; no school-wide blanket deletion. |
| SC69 | Client intentionally toggles a bridge membership to join/split clusters around the deadline | Component state and cost computed server-side from durably ordered events at signed snapshot instant; no retroactive timer reset, double charge or client-supplied cluster price. |
| SC70 | School has 1,000,000-tile map with sparse clusters spanning multiple 64×64 chunks | Derive component billing without naive full-map scans per user action; correctness, recovery and hotspot fanout must be benchmarked before launch. |

**M4-D0 stop:** Owner's price premium and connected-cluster upkeep concept are recorded; production fee schedule, topology, payer, component grouping, merge/split timing, grace, C-08 fog and C-12 scoring are not fully frozen. No production reward, Point debit or periodic job is enabled.
