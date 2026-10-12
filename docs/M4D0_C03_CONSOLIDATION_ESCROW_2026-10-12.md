# M4-D0 C-03 — Incumbent, Decay, Consolidation & Contributor Refund

> **ROUND-4 CURRENT RULES OVERRIDE — 2026-10-12:** See [Owner Alignment Round 4](M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md). The lawful incumbent at Contest start retains FREE when challenger leaves; only a surviving non-incumbent claimant consolidates after incumbent leaves. There is NO 6h grace, NO fixed nonresettable 2h Decay: valid >=1 Point paid before expiry RESETS the 2h rolling Decay (capped by a nonresettable 48h hard claim deadline). ceil(N/2) rounds UP; unsuccessful accepted contributions return to their actual individual payers. Four-edge, max-two-school clusters; each Shared tile scores +1 for each active school; C-08 own-school fog and private player-data projections. C-04/C-05 footprint HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40; world layout deferred. Landmark first 1000 Crystals and LINEAR +5% of base per takeover; weekly-verified synced running required for personal UniStop use; finite Key-protected, individually discovered Chest, simple admin editor later. The older 6h grace, 48h-from-forgetting, terminal transfer, linear-not-resetting-Decay, historic first-explorer priority and prior object footprints are SUPERSEDED. M4-D0 docs only; full production freeze and M4-D1/D2 remain blocked.

**Date:** 2026-10-12. **Status:** OWNER-SELECTED PRINCIPLES; DETAILS PENDING; NOT FROZEN; NOT PRODUCTION. Supersedes earlier interpretations if inconsistent. See [C-03 Rev2](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md).

## 1. Owner-confirmed rules

**CURRENT HOLDER AS INCUMBENT.** Freeze the lawful Knowledge holder just before the new Contest is created (incumbentSchoolSlot), per tile. This school has the privileged free-retention position in THAT contest; historical original discoverer does not. Example: A first discovered T, B lawfully took T, then C initiates a new sharing Contest: B is incumbent, NOT A. Snapshot does not flip during Contest. Mixed-incumbent multi-tile cluster uses immutable per-tile holder snapshots; any aggregation policy needs explicit signoff.

**ONE-TIME SUCCESSION FEE, OWNER-SELECTED ROUNDING.** When the original/incumbent school of THIS Contest lawfully loses its shared Knowledge, the surviving school may consolidate it. Tiles on which the survivor was the current lawful incumbent when this Contest began require ZERO consolidation Points; all other eligible inherited tiles count toward N. The owner has now selected **ceil(N/2) Points, including rounding UP when N is odd**. Example: N=7 -> 4, N=20 -> 10, N=21 -> 11. Which exact component/tile membership snapshot defines eligible N (including mixed incumbents and merges) remains PENDING, but the mathematical rounding is now **CONFIRMED**. Historically discovering a tile first does not override the frozen incumbent.

**TWO CLOCKS START TOGETHER, OWNER-CONFIRMED.** Let tDecayStart be the durable server-authoritative instant the affected shared Knowledge cluster officially ENTERS contest-specific DECAY after missing its authorized upkeep deadline/cutoff. At that same instant, START BOTH: the **2-hour Decay countdown** ending tDecayStart+2h and the **48-hour Consolidation countdown** ending tDecayStart+48h. The latter is **NOT** 48h after complete forgetting, after a donation, or after a worker restart. With no delays, the school's full Knowledge forgetting at tDecayStart+2h leaves 46 hours in the originally started consolidation window. The exact preceding grace duration remains pending; do NOT silently tack another 48h after forgetting.

**EARLY DONATION / NEUTRALITY.** The previously given direction is that if an eligible student contributes during the first 2-hour Decay window, the contesting non-incumbent school can provisionally keep its claim alive for the already-running 48-hour Consolidation clock. If no valid contribution arrives during that 2-hour window, the unclaimed non-incumbent claim can become neutral when Decay completes, provided no other legitimate maintained school retains that Knowledge. Exactly which member must contribute, minimum initial deposit, whether that deposit counts in the final ceil(N/2) amount, acceptedAt equality at tDecayStart+2h, and protected incumbent-only subsets remain open before production. Do NOT erase incumbent-owned still-valid Knowledge because no one funded a rival claim.
**FAILED CASE RETURNS POINTS TO EACH REAL CONTRIBUTOR.** If the required succession Points have not been collected at 48h, the non-incumbent eligible Knowledge area becomes neutral and EACH contributor is refunded EXACTLY that contributor's actual accepted payment. There is NO reward/refund to former owner. If the survivor was incumbent for a tile, that tile remains free of the succession fee and is not arbitrarily neutralized merely because another tile failed. Signed mixed-tile settlement/fog/score rules are still required. When both schools miss upkeep, there may be no survivor: separately decide neutral/dormant outcome.

**KEEP PREVIOUS OWNER CHOICES:** first 24h Shared Knowledge upkeep-free, then 24h cycles; connected Shared Knowledge cluster costs a working example of 1 Point per SCHOOL per paid cycle, independent of tile count. New exploration 1 Point/tile and joining another school's Knowledge 2 Points/tile are owner working balance examples. No production ruleVersion or live billing is approved.

## 2. HISTORICAL timeline superseded where Decay could not reset — see Round 4

| Stage / instant | Meaning | Owner-confirmed vs unresolved |
|---|---|---|
| SHARED | Schools A and B coexist, with separate connected-cluster maintenance obligations | Owner confirmed initial 24h free + 24h paid cycles |
| UPKEEP_OVERDUE | One school has not made an authorized maintenance payment | Earlier grace length/cutoff still OPEN |
| **tDecayStart (authoritative DB timestamp)** | Enter contest-specific DECAY and CREATE BOTH deadlines immediately | **CONFIRMED:** fadeDeadline=tDecayStart+2h; consolidateDeadline=tDecayStart+48h |
| First 2 hours | DECAYING; eligible contributions can protect a potential successor's claim | Owner direction: an early contribution prevents premature neutralization; minimum payer, required amount and boundary OPEN |
| **tDecayStart+2h** | Faded school COMPLETELY forgets eligible membership | If eligible successor claim funded early, it remains PROVISIONAL; if no valid claim, affected unowned tiles may become NEUTRAL; incumbent-owned still-valid tiles must not vanish |
| Remaining approximately 46 hours | CONSOLIDATING claim; accepted contributors fund ceil(N/2) Points | First deposit and repeated donations NEVER change consolidateDeadline |
| Before settlement deadline, sufficient Points | SUCCESS; eligible inherited Knowledge becomes survivor's sole Knowledge | Server-authoritative, idempotent, no further shared fee until future Contest |
| **tDecayStart+48h** | If insufficient Points, FAILURE; eligible unsettled inherited Knowledge becomes neutral | Durable per-contributor refund obligations; contributor credited exactly once |
| REFUND_PENDING to REFUNDED | Wallet credits posted in retry-safe batches | Retain unpaid liabilities and audit trail; no false instant-success claim |

**UTC fixture:** tDecayStart=2026-10-13T06:00:00.000Z implies full forgetting at 2026-10-13T08:00:00.000Z and consolidation deadline at 2026-10-15T06:00:00.000Z — NOT at 2026-10-15T08:00:00.000Z. A first deposit at 2026-10-13T07:00:00.000Z may protect the non-incumbent claim, but cannot move either deadline. N=20 gives ceil(20/2)=10 Points; two insufficient donations from P1=3 and P2=2 must refund 3 and 2 respectively after failure. If no qualifying donation during Decay, exact resulting neutralization by subset is a separate acceptance gate.

**Rare simultaneous lapse of both schools:** owner explicitly defers bespoke game-design handling for this unlikely case in v1. **Do not interpret deferral as permission to double-debit, arbitrarily award Knowledge or corrupt the world.** For any synthetic unexpected tie, fail closed and retain a durable resolution-required state until deterministic policy is signed. No production activation while the relevant terminal case remains undefined.
## 3. Escrow transaction and ledger design proposal

**One row PER CONTRIBUTION transaction, never per Point.** Use a durable server-derived consolidation case ID, campaign/ruleVersion, incumbent-snapshot reference, affected tile-set/component identity, requiredPoints, totalReceived, tForget, expiresAt, settlement state and revision. Each contribution must record case ID, contributor actor ID, ORIGINAL payer wallet/account reference, integer amount, unique payment/idempotency key, ledger debit reference and audit timestamps. Do not leak individual wallet data to other schools (C-08).

- In one DB transaction validate eligible actor/wallet and open case, lock or compare-and-swap the case, ensure total cannot silently exceed approved cap, charge exact wallet amount, update accepted contribution/case total, persist idempotency ACK and authorized outbox. No duplicate debit on lost ACK.
- Terminal SUCCESS consumes approved escrow once, commits per-tile Knowledge settlement, and prohibits further deposits/refunds except expressly authorized surplus correction.
- Terminal FAILURE freezes eligible contributions, commits neutralization of applicable non-incumbent claims and creates durable EXACT refund obligations for all accepted contributions. A unique (caseId,contributionId,refundType) key prevents duplicate credit.
- Large fanout can be processed via bounded, retry-safe refund batches. "Refund owed" must not be reported as "already credited"; preserve pending liabilities through crashes. Each wallet credit + immutable refund ledger + idempotent obligation completion must commit together.
- Conservation rule for a failed case: total accepted Points = total successfully returned Points + total legitimate outstanding refund liability. No Points are paid to the relinquishing owner. Reconcile credits to original wallet references, including student school changes.
- Benchmark concurrent students, bulk donations, crashes between failure and refund, 1,000+ participants, hotspot outbox and growing ledger partitions before production. Archive settled transactions only after agreeing audit/retention; do not delete evidence merely to shrink database.

**Open security/economy details:** allow multiple authorized student contributors vs pooled school treasury; partial and advance deposits; cancel/refund before deadline; overfund rejection/surplus return; how to bill if incumbent differs across tiles; exact UTC cutoff; 2h fade/grace interaction; component topology/gathering; school affiliation switch; fraud prevention; C-08 fog; C-12 scoring. The proposed tables are conceptual, not migrations.

## 4. HISTORICAL acceptance cases D01–D22 (only applicable if consistent with Round 4)

| ID | Scenario | Required or pending outcome |
|---|---|---|
| D01 | A discovered T, B legally took T, C opens new Contest | INCUMBENT=B, not historical A. |
| D02 | Contest incumbent B remains paying; C forgets | B keeps incumbent-owned T for zero succession fee. |
| D03 | Contest incumbent B forgets; C is survivor over N=20 non-incumbent tiles | Proposed one-time consolidation requirement 10 Points. |
| D04 | Cluster has 7 non-incumbent tiles for surviving school | Proposed ceil(7/2)=4 Points, rounding approval pending. |
| D05 | 20-tile cluster has 12 frozen incumbent tiles for survivor, 8 others | Proposed fee ceil(8/2)=4 Points; not 10. |
| D06 | tDecayStart=2026-10-13T06:00Z | Both clocks start NOW: complete forgetting 2026-10-13T08:00Z; consolidation deadline 2026-10-15T06:00Z (46h after forgetting). |
| D07 | First qualified donation tDecayStart+1h | Protects eligible provisional claim during fade; neither 2h fade nor 48h deadline resets. Acceptance/minimum amount still OPEN. |
| D08 | Additional contributions at tDecayStart+47h59m | Must not reset original 48h deadline or create another claim window. |
| D09 | tDecayStart from authorized missed-upkeep transition | Set fadeDeadline=tDecayStart+2h AND consolidateDeadline=tDecayStart+48h in SAME durable transition; previous grace amount OPEN. |
| D10 | P1 contributes 3, P2 contributes 2 to fee=10; deadline ends | Case fails; P1 owes refund 3 and P2 owes refund 2, not to old holder. |
| D11 | P1 contributed 5 twice with distinct valid contribution IDs | Exact total 10 if eligible; no per-Point ledger rows; both payments auditable. |
| D12 | Retry same contribution idempotency key after ACK loss | Original ACK replayed, no duplicate debit or ledger row. |
| D13 | Same idempotency key with changed amount | Conflict; no additional debit or receipt. |
| D14 | Two students pay last required Point concurrently | Atomic case total/fee cap and exactly one terminal success, no accidental excess accepted. |
| D15 | Payment exactly at tDecayStart+48h | Inclusive/exclusive cutoff remains OPEN; no client-clock trust. |
| D16 | Expiry worker races last accepted contribution | Exactly one SUCCESS or FAILURE with deterministic server ordering. |
| D17 | Failed case with 1,000 donors and worker restart | Persist 1,000 refund obligations once; idempotent bounded wallet credits and reconciled liability. |
| D18 | Refund batch succeeds for P1 but fails before P2 | P1 is credited once; P2 remains pending and will be credited; no lost liability. |
| D19 | Student contributor switched schools after depositing | Refund still to original payer wallet/account, not new/old school treasury arbitrarily. |
| D20 | B already incumbent on T1, non-incumbent on T2 and cannot fund T2 | T1 remains free; T2 settlement as signed; no total-cluster blanket deletion. |
| D21 | Both A and B forget the component before consolidation starts | No surviving claimant; both-fail policy remains OPEN. |
| D22 | Payer asks third school for escrow list or refund details | C-08 deny-by-default; no actor ledger leakage. |

## 5. Owner-signoff gate

Confirmed: simultaneous 2h fade and 48h consolidation clocks at tDecayStart, with mathematical succession fee ceil(N/2) for odd N; all contributors get exact refunds on FAILED case. Still required: exact earlier grace/cutoff, how much valid early deposit is required and whether it counts toward the threshold, equality at each deadline, inherited tile snapshot, partial failure, both-fail case (deferred for v1 gameplay but requires safe fail-closed handling), case grouping across merge/split, contributor wallet/caps/overfund, C-08/C-12 and signed immutable ruleVersion. **This addendum does NOT approve M4-D1/D2 or production activation.**
## 6. HISTORICAL fixed-2h acceptance D23–D34 (superseded by rolling 2h in Round 4)

Fixtures: relevant shared cluster enters decay at t0=2026-10-13T06:00:00.000Z. tFadeEnd=2026-10-13T08:00:00.000Z; tConsolidateEnd=2026-10-15T06:00:00.000Z. These are the same two clocks started atomically at t0, NOT sequential 2h+48h. Numbers N use per-tile frozen incumbent snapshot.

| ID | Scenario | Expected invariant / unresolved choice |
|---|---|---|
| D23 | Enter DECAY at t0 | Persist TWO deadlines in same transaction: t0+2h and t0+48h. Never schedule t0+50h. |
| D24 | N=1 tile requiring succession | Fee ceil(1/2)=1 Point, CONFIRMED rounding. |
| D25 | N=3 eligible non-incumbent tiles | Fee ceil(3/2)=2 Points, CONFIRMED rounding. |
| D26 | N=21 eligible non-incumbent tiles | Fee ceil(21/2)=11 Points, CONFIRMED rounding. |
| D27 | N=0, surviving school is incumbent for all tiles | No succession fee; retains eligible incumbent-owned Knowledge under signed eligibility/fog rules. |
| D28 | Qualifying contribution arrives t0+1h | Provisional claim can avoid neutrality at t0+2h; 48h settlement STILL at t0+48h. Minimum qualifying deposit and its allocation OPEN. |
| D29 | No qualifying contribution before t0+2h | Eligibility of formerly shared non-incumbent area for early neutralization must follow signed 2h rule; never remove still-valid incumbent-owned tiles; no server-ordered arbitrary winner. |
| D30 | tFadeEnd=t0+2h, qualifying claim held | Losing school fully forgets; survivor has remaining 46h to finish paying; deadline does NOT reset. |
| D31 | First valid contribution after t0+2h but before t0+48h | Whether a NEW claim can be opened after early neutralization is PENDING; cannot silently revive finalized neutral state. |
| D32 | t0+48h reached with 7/11 Points contributed | FAILURE; neutralize eligible unowned inherited subset; refund every donor their own accepted share; preserve liabilities if batches fail. |
| D33 | Server crash before t0+2h and resumes after t0+48h | Recover BOTH ORIGINAL persisted deadlines, deterministic settle once, no +48h from restart, no duplicate credits/debits. |
| D34 | Two schools' upkeep expires with same exact authoritative instant | Owner defers dedicated v1 gameplay rule; persist fail-closed resolution-required state (no arbitrary award or double charge). Must be production-safe despite rarity. |

**No push or production authorization implied by these documentation requirements.**
