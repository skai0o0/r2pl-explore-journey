# M4-D0 Owner Clarification & Decision-Freezing Worksheet

> **ROUND-4 CURRENT RULES OVERRIDE — 2026-10-12:** See [Owner Alignment Round 4](M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md). The lawful incumbent at Contest start retains FREE when challenger leaves; only a surviving non-incumbent claimant consolidates after incumbent leaves. There is NO 6h grace, NO fixed nonresettable 2h Decay: valid >=1 Point paid before expiry RESETS the 2h rolling Decay (capped by a nonresettable 48h hard claim deadline). ceil(N/2) rounds UP; unsuccessful accepted contributions return to their actual individual payers. Four-edge, max-two-school clusters; each Shared tile scores +1 for each active school; C-08 own-school fog and private player-data projections. C-04/C-05 footprint HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40; world layout deferred. Landmark first 1000 Crystals and LINEAR +5% of base per takeover; weekly-verified synced running required for personal UniStop use; finite Key-protected, individually discovered Chest, simple admin editor later. The older 6h grace, 48h-from-forgetting, terminal transfer, linear-not-resetting-Decay, historic first-explorer priority and prior object footprints are SUPERSEDED. M4-D0 docs only; full production freeze and M4-D1/D2 remain blocked.

> **C-03 NEW OWNER DECISIONS (2026-10-12):** [Incumbent, ~2h Decay, 48h Consolidation and Exact Contributor Refund Addendum](M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md) **OVERRIDES conflicting earlier wording.** The *current lawful holder at new Contest start* gets incumbent/free-retention privilege, NOT the first-ever discoverer. When an eligible contested cluster ENTERS DECAY at tDecayStart, **both 2h fade and 48h consolidation clocks start TOGETHER**: forgetting at tDecayStart+2h, settlement deadline at tDecayStart+48h (46h remain after forgetting). The non-incumbent successor's fee is **ceil(N/2) Points**, rounding UP for odd N, with eligible tile/component snapshot rules still pending. Failed consolidation makes eligible inherited Knowledge neutral and **refunds every accepted Point to its ORIGINAL individual contributor**, never the old holder. Store idempotent contributor escrow/refund ledger. 24h initial free shared-upkeep and connected-cluster maintenance rules still apply; global General Decay remains OFF. Earlier grace, contribution eligibility, mixed-holder cases and precise deadline inclusivity remain OPEN. Owner defers bespoke gameplay for exact simultaneous failure of both schools; fail-closed transaction correctness is still mandatory. **Docs only: no production code, no M4-D1/D2 authorization.**

> **C-03 OWNER ECONOMY CLARIFICATION 2026-10-12 (LATEST, NOT PRODUCTION):** The owner directs a **higher one-time Shared Knowledge join fee (2 Points per newly joined already-known tile, compared with 1 Point to explore a fresh tile, as the working numerical example)**, but **upkeep is charged per connected shared Knowledge cluster, NOT per tile**: **1 Point per paid 24h cycle per participating school per connected shared cluster, irrespective of its tile count**. The first 24h after sharing starts remain upkeep-free (Option C). These example amounts are a working owner balance baseline, not a published ruleVersion. Cluster neighbor definition (4/8), same-school-pair vs cross-pair merging, merge/split timing, payer/treasury, grace and both-unpaid outcomes are OPEN. See [current C-03 Rev2 detailed spec + SC49–SC70](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md). The older per-tile daily-upkeep cost language is SUPERSEDED. No production mutation, scheduled debit, or M4-D1 activation.


> **C-03 REV2 OVERRIDE 2026-10-12 — latest owner direction:** [C-03 Rev2 Shared Knowledge & Contest-specific Upkeep](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md) **supersedes** earlier statements that 24h automatically ends in defender victory/transfer. Two schools may share Knowledge indefinitely while EACH pays Points for its own upkeep; when one misses approved upkeep, only that school forgets and the other keeps Knowledge. **General Decay across noncontested tiles stays OFF; contest-specific upkeep/forgetting is ON as a concept.** **OWNER SELECTED OPTION C:** the first 24h of sharing have no upkeep fee; thereafter each school must pay Points for every 24h upkeep period. Fee, collection mode, cutoff, grace, both-fail outcome, C-08 fog and C-12 scoring remain **PENDING**. This is M4-D0 specification only; **NO production authorization, code or timer activation**. Earlier sections are historical or partially superseded wherever they conflict.

**2026-10-12 - M4-D0 in progress, partial clarifications, FULL FREEZE pending.** Owner authorized "Proceed M4D" after agreeing to decision-freeze preparation. Scope here is documentation only; no M4-D1, production integration or candidate activation is authorized.

## Provenance and authority

- Repository preflight: clean `codex/m4a-playable`, HEAD `4486ea9b03ba4db353d467e55fd235698a38483b`.
- Owner conversation on 2026-10-12 supplies the current clarifications below and describes an updated working 470-line attachment assembled from the current codebase: `R2PL_Gamenote_V2_Dong_bo_2026-10-12.txt`, SHA-256 `604dcb332b960e4b4667c9b776e4d946940759a89f74f5d0bf9c6f2dec103341`. The attachment is not a tracked repository source. The orchestration lead directly inspected and SHA-256 verified the uploaded file; a controlled import of that exact copy into the repository remains a separate step.
- Owner explicitly declared older chat `Gamenote.txt` outdated. [OWNER_REQUIREMENTS.md](OWNER_REQUIREMENTS.md) remains the unchanged older historical repository proposal; it must no longer be described as the latest owner proposal. Its historical comparisons remain traceable.
- Repository sources: [GAME_SPEC.md](GAME_SPEC.md), [SPEC_CONFLICTS.md](SPEC_CONFLICTS.md), [DECISIONS.md](DECISIONS.md), [M4D_DECISION_PACK.md](M4D_DECISION_PACK.md), [ROADMAP.md](ROADMAP.md). Master Plan `writing-block.md` fixes architecture; approved decisions/rules govern implementation. A working note assembled from code does not approve that code as production rules.

## Confirmed baseline and remaining decisions

**C-01:** opening a new Knowledge tile costs **1 Point, not Crystal**. Points and Crystals are distinct resources. This corrects stale Crystal-opening wording only. Full C-01 is not approved: repeat/no_change review charges, shared contest entry/defense costs, transfer/refund, Point-to-Crystal conversion, caps, rounding, idempotent concurrency examples and signed ruleVersion remain pending. Development `shared/gameplay/devRules.ts` continues to use fixture-credit, version 0; no production currency is inferred.

**C-10:** existing [GAME_SPEC.md probability tables](GAME_SPEC.md#owner-probability-values-verbatim-numerical-values-not-normalized) are the owner-confirmed correct baseline for Aspire/Nitro/Predator UniStops and Chests. Outdated text-file percentages are wrong. All six displayed columns total 100%; preserve exact values, without normalization or redistribution. The existing historical table transcription stays intact. V2 has **no production gacha/reward implementation**. Eligibility, stock, distribution and signed ruleVersion remain open; C-06/C-07 catalog and cooldown dependencies are not waived.

**C-11:** M5 is **EXTERNAL BLOCKED**. The external campaign/running webdev team has not provided API schema, endpoints or identity mapping. Do not fabricate endpoints, identity verification or kilometer conversion. V1 mock 1 km = 10 Points is not production. Interfaces and the synthetic world should precede integration, under separate implementation authorization.

## C-01 decision matrix - no pending option selected

| Topic | Confirmed fact or explicitly unselected OPTIONS | Required freeze entry |
|---|---|---|
| New Knowledge | Confirmed: 1 Point; separate Crystal balance | Eligibility, adjacency and resulting membership/fog; effective campaign/version |
| Repeat / no_change | OPTIONS: no charge; explicit review charge | Exact review effect, cost, currency, failures and repeated review behavior |
| Shared entry / defense | OPTIONS: fixed Point charges; another explicitly approved cost schedule | Separate entry/defense amounts, eligible actor, failure cost and maximum memberships |
| Transfer / refund | OPTIONS: retain spent resources; specified refund/transfer | Recipient, amount, trigger and atomic accounting; no implicit refund |
| Point-to-Crystal conversion | OPTIONS: disabled; explicit conversion | Rate, direction, precision, rounding, limits and audit |
| Caps / concurrency | OPTIONS: reject cap overflow; specified capped result | Integer/decimal units, cap values, ordered same-tile outcomes, signed examples |

## C-03 decision matrix - pure candidate only

Contest/Defense/Decay in `shared/gameplay/candidates.ts` remain **PURE CANDIDATE**, not server-approved. **LATEST OWNER DIRECTION:** two schools can share Knowledge indefinitely with independent Point upkeep; **Option C confirmed: first 24h free, then pay each 24h**, and General Decay OFF for noncontested Knowledge. Historical 24h terminal defense/transfer semantics below are superseded. See [C-03 Rev2 current draft](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md).

| Topic | Confirmed direction or unselected options | Required freeze entry |
|---|---|---|
| Sharing model | **CURRENT OWNER DIRECTION:** Shared Knowledge can persist indefinitely while BOTH schools pay. **Option C SELECTED:** first 24h upkeep-free, then each school pays once per 24h. Historical one-shot Defender/Transfer outcome SUPERSEDED. | Due cutoff, per-school upkeep fee, expiry/grace, both-fail handling and scoring remain PENDING; see C-03 Rev2. |
| Independent general decay | **SELECTED: NO for first gameplay release** | No V1 12h/22h retention curve or general Knowledge decay jobs. Contest timeout remains active independently. |
| Adjacency / eligibility | 4-neighbor; 8-neighbor; explicit alternative | Border, HQ exemption, simultaneous attackers, permitted actors |
| Contest boundary | Defense valid at deadline; defense expires at deadline | Authoritative clock, transaction ordering, restart and overdue timer outcome |
| Defense effect | Reset deadline; end contest; another specified effect | Repeat defense, refund and memberships; fixed timestamps |
| Decay if YES | Explicit schedule and exceptions only | Per-school retention, HQ, contest collision order, recovery, score and fog loss |

## C-08 per-role permission matrix - every cell UNSELECTED

School isolation remains a security invariant regardless of the owner-selected presentation policy. The matrix must be filled for **each** unknown, discovered, own Knowledge, opposing Knowledge, contested Knowledge, previously lost Knowledge, HQ, Landmark, UniStop and Chest state. Public geometry must not imply access to hidden school state.

| Role | Geometry / object identity | School identity / membership | State / progress | Timers | Hints / answers | Actions |
|---|---|---|---|---|---|---|
| Public visitor | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED |
| Same-school player | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED |
| Opponent | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED |
| Spectator | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED |
| Admin | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED | UNSELECTED |

For every cell choose deny, public fields only, own-school fields only, or explicitly authorized fields; enumerate fields and trusted role source. Admin status is not an automatic hidden-data grant. Separately select discovery persistence after Knowledge loss (retain/remove/specified policy), spectator resync scope, school-change invalidation and puzzle answer protection. Snapshots, deltas, errors and logs must use the same authorization policy; raw masks must not leak.

## Exact acceptance examples to sign before freeze

These are worksheet cases, not executable production tests or approvals. Architectural invariants below are fixed; outputs that depend on pending choices must be completed by the owner.

| Case and exact input | Required expected output / unresolved entry |
|---|---|
| New tile T=(10,10), eligible school A, Points=2, Crystals=7, absent A membership, key K1 | Baseline economic delta: Points=1, Crystals=7; A gains Knowledge after commit. Owner must specify eligibility/fog projection and signed version. |
| Same actor replays K1 with identical payload after commit | Original committed result; no second debit, world revision or gameplay outbox event. Lost ACK then retry gives the same outcome. |
| Same campaign/actor reuses K1 for T=(11,10) | Payload conflict; no debit/world mutation; error contains no hidden tile data. |
| Eligible actor Points=0, Crystals=7 opens a new tile | Insufficient Points; no Crystal substitution, debit or world effect. |
| Already-known T, Points=2, Crystals=7, new key K2 | Owner must fill exact no_change/review status, balance delta and world/revision effect under selected repeat policy. |
| Two new-tile requests, distinct keys, same wallet Points=1, different eligible tiles | At most one successful 1-Point debit; final Points=0; rejected action has no world effect. Owner signs ordering-independent result set. |
| Two same-school actors race for the same new T, each Points=1 | First committed gain follows new-tile baseline; second follows selected repeat policy. Specify both wallets, membership, revisions and events exactly. |
| A owns T; B enters shared Knowledge at 2026-10-12T00:00:00Z | **Current Option C:** [2026-10-12T00:00Z, 2026-10-13T00:00Z) is upkeep-free; first paid cycle begins 2026-10-13T00:00Z for EACH school; next cycle 2026-10-14T00:00Z. Fee, grace, payment cutoff, exact ownership/visibility remain PENDING. |
| A defends at 2026-10-12T23:59:59.999Z, 2026-10-13T00:00:00Z, 2026-10-13T00:00:00.001Z | Three separate cases: owner fills validity, debit/refund, A/B membership and reset/end/transfer result. Repeat and concurrent defense must have exact outcomes. |
| Server restarts at 2026-10-13T00:00:01Z after deadline; contest settlement is overdue | Recover persisted state/deadline; owner specifies deterministic transition order, final membership/score/fog and one-time event/debit behavior. **General Decay OFF.** Include HQ and two-attacker variants. |
| Opponent unseen T, school switch A to B, stale reconnect, spectator resync, lost Knowledge T | For each role/state matrix row, list exact allowed snapshot/delta fields and denied fields; no former-school or hidden mask/hint leakage. |

## Authority boundaries and other open scope

- Pure deterministic rules live in shared modules; client presents authorized state and pending actions. Server authenticates and commits; rooms manage transport/lifecycle and services implement rules. PostgreSQL is durable truth. Wallet/world/idempotency/outbox commit together; successful durable ACK follows commit. One writer per sector; protocol v1 stays unchanged.
- Explore, not conquest: independent 1000x1000 board and immutable 16-slot registry. Eight participating schools are confirmed at campaign level; proposed V1 slots 0-7 remain unapproved production mapping (C-04).
- 40x40 Landmark is a noted candidate, not a fixed production footprint (C-05). Late-join OPTIONS remain reserved school slots versus expanding the map; expansion conflicts with fixed-map ADR-003 and requires explicit architectural review. Neither strategy is selected.
- Landmark 100 Crystals initially, 120 takeover, 10 Crystals clue and 10-minute wrong-guess cooldown remain unapproved C-02/C-09. C-12 scoring must align with sharing, transfer and decay.
- M4-C needs actual desktop/mobile browser UX and GPU acceptance. M3.6 hotspot remains a production launch blocker, not a development blocker. This documentation pass supplies neither measurement nor acceptance.

## Updated priority and next gate checklist

1. Complete C-01/C-03/C-08 first: select options, fill per-role/per-state permissions and sign exact acceptance outputs. Do not mark whole C-01 or C-10 approved from partial confirmation.
2. Align C-04/C-05/C-12 roster, fixed map, footprint, late join and scoring; resolve C-02/C-09 before Landmark implementation.
3. For each frozen C-ID record approver, timestamp, effective campaign, signed immutable ruleVersion, parameters/units/precision, live-change policy, migration/rollback policy and acceptance evidence. Preserve source provenance; later import the owner attachment separately.
4. Owner reviews the complete freeze record and explicitly authorizes the next implementation stage. **FULL FREEZE pending; stop at M4-D0.** M4-D1 requires C-01/C-03/C-08; M4-D2 additionally needs finalized defense/optional decay; downstream gates are not waived.
5. Close M4-C browser/GPU acceptance and separately resolve M3.6 launch performance. Keep M5 external blocked and M6 reward operations separately gated; prepare no production integrations here.
