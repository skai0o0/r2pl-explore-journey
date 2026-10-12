# M4-D0 — Owner Decision Pack (R2PL Explore Journey)

> **ROUND-4 CURRENT RULES OVERRIDE — 2026-10-12:** See [Owner Alignment Round 4](M4D0_OWNER_ALIGNMENT_ROUND4_2026-10-12.md). The lawful incumbent at Contest start retains FREE when challenger leaves; only a surviving non-incumbent claimant consolidates after incumbent leaves. There is NO 6h grace, NO fixed nonresettable 2h Decay: valid >=1 Point paid before expiry RESETS the 2h rolling Decay (capped by a nonresettable 48h hard claim deadline). ceil(N/2) rounds UP; unsuccessful accepted contributions return to their actual individual payers. Four-edge, max-two-school clusters; each Shared tile scores +1 for each active school; C-08 own-school fog and private player-data projections. C-04/C-05 footprint HQ 30x30, UniStop 10x2, Chest 2x2, Landmark 40x40; world layout deferred. Landmark first 1000 Crystals and LINEAR +5% of base per takeover; weekly-verified synced running required for personal UniStop use; finite Key-protected, individually discovered Chest, simple admin editor later. The older 6h grace, 48h-from-forgetting, terminal transfer, linear-not-resetting-Decay, historic first-explorer priority and prior object footprints are SUPERSEDED. M4-D0 docs only; full production freeze and M4-D1/D2 remain blocked.

> **C-03 NEW OWNER DECISIONS (2026-10-12):** [Incumbent, ~2h Decay, 48h Consolidation and Exact Contributor Refund Addendum](M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md) **OVERRIDES conflicting earlier wording.** The *current lawful holder at new Contest start* gets incumbent/free-retention privilege, NOT the first-ever discoverer. When an eligible contested cluster ENTERS DECAY at tDecayStart, **both 2h fade and 48h consolidation clocks start TOGETHER**: forgetting at tDecayStart+2h, settlement deadline at tDecayStart+48h (46h remain after forgetting). The non-incumbent successor's fee is **ceil(N/2) Points**, rounding UP for odd N, with eligible tile/component snapshot rules still pending. Failed consolidation makes eligible inherited Knowledge neutral and **refunds every accepted Point to its ORIGINAL individual contributor**, never the old holder. Store idempotent contributor escrow/refund ledger. 24h initial free shared-upkeep and connected-cluster maintenance rules still apply; global General Decay remains OFF. Earlier grace, contribution eligibility, mixed-holder cases and precise deadline inclusivity remain OPEN. Owner defers bespoke gameplay for exact simultaneous failure of both schools; fail-closed transaction correctness is still mandatory. **Docs only: no production code, no M4-D1/D2 authorization.**

> **C-03 OWNER ECONOMY CLARIFICATION 2026-10-12 (LATEST, NOT PRODUCTION):** The owner directs a **higher one-time Shared Knowledge join fee (2 Points per newly joined already-known tile, compared with 1 Point to explore a fresh tile, as the working numerical example)**, but **upkeep is charged per connected shared Knowledge cluster, NOT per tile**: **1 Point per paid 24h cycle per participating school per connected shared cluster, irrespective of its tile count**. The first 24h after sharing starts remain upkeep-free (Option C). These example amounts are a working owner balance baseline, not a published ruleVersion. Cluster neighbor definition (4/8), same-school-pair vs cross-pair merging, merge/split timing, payer/treasury, grace and both-unpaid outcomes are OPEN. See [current C-03 Rev2 detailed spec + SC49–SC70](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md). The older per-tile daily-upkeep cost language is SUPERSEDED. No production mutation, scheduled debit, or M4-D1 activation.


> **C-03 REV2 OVERRIDE 2026-10-12 — latest owner direction:** [C-03 Rev2 Shared Knowledge & Contest-specific Upkeep](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md) **supersedes** earlier statements that 24h automatically ends in defender victory/transfer. Two schools may share Knowledge indefinitely while EACH pays Points for its own upkeep; when one misses approved upkeep, only that school forgets and the other keeps Knowledge. **General Decay across noncontested tiles stays OFF; contest-specific upkeep/forgetting is ON as a concept.** **OWNER SELECTED OPTION C:** the first 24h of sharing have no upkeep fee; thereafter each school must pay Points for every 24h upkeep period. Fee, collection mode, cutoff, grace, both-fail outcome, C-08 fog and C-12 scoring remain **PENDING**. This is M4-D0 specification only; **NO production authorization, code or timer activation**. Earlier sections are historical or partially superseded wherever they conflict.

## 2026-10-12 owner clarification - partial baseline, not full freeze

**M4-D0 in progress, partial clarifications, FULL FREEZE pending.** Owner authorized "Proceed M4D" for M4-D0 decision-freeze preparation only. See [M4-D0 owner alignment worksheet](M4D0_OWNER_ALIGNMENT_2026-10-12.md) for provenance, unselected options, acceptance examples and gates. This does not authorize M4-D1 or production gameplay.

`OWNER_REQUIREMENTS.md` remains the unchanged historical proposal. Owner declared the older chat `Gamenote.txt` outdated and supplied an updated working 470-line `R2PL_Gamenote_V2_Dong_bo_2026-10-12.txt`, SHA-256 `604dcb332b960e4b4667c9b776e4d946940759a89f74f5d0bf9c6f2dec103341`. These are owner-provided facts; the owner attachment was verified against its SHA-256 by the orchestration lead; the attachment is not tracked here. Import the owner's copy separately later. Historical comparisons below remain historical evidence, not the latest owner position.

- **C-01 partial confirmation:** new Knowledge costs **1 Point**, not Crystal; Points and Crystals are separate. Repeat/no_change, contest/defense, transfer/refund, conversion, caps, rounding, concurrency examples and signed ruleVersion remain pending. `shared/gameplay/devRules.ts` still uses synthetic fixture-credit, version 0; it is not production currency.
- **C-10 partial confirmation:** the existing UniStop and Chest tables in `GAME_SPEC.md` are the correct owner-confirmed V2 baseline; outdated text-file percentages are wrong. Every column totals 100%; preserve all values without normalization. There is no production gacha/reward implementation. Eligibility, stock, distribution and signed ruleVersion remain open.
- **C-11 EXTERNAL BLOCKED (M5):** the campaign/running webdev team has not supplied API schema, endpoints or identity mapping. Do not invent verification, endpoints or km-to-Points conversion; V1 mock 1 km = 10 Points is not production. Prepare interfaces and the synthetic world first under a separately authorized implementation stage.

**Status: DRAFT / NOT APPROVED.** Prepared 2026-10-11 against HEAD 3d74506a736f5ab81dd42d544717809a8a68fffc. This file requests decisions. It DOES NOT approve production rules or authorize migration, deployment, code integration, or changes to the original Gamenote.

## Authority and current engineering baseline

- Owner gameplay concept is preserved verbatim in docs/OWNER_REQUIREMENTS.md. Master Plan writing-block.md governs architecture and feature boundaries. Explicit approved, published decisions outrank implementation; proposals are not silently upgraded. Evidence: docs/GAME_SPEC.md:3,52-56; docs/DECISIONS.md:3-21; docs/SPEC_CONFLICTS.md:3-25.
- M4-A/B/C use Dawn/Dusk synthetic school fixtures, fixture-credit and development rule version 0. Evidence: shared/gameplay/devRules.ts:1-57, scripts/play-local.ts:12-18,21-53, docs/M4B_REPORT.md:27-31.
- Contest/Defense/Decay/Landmark code in shared/gameplay/candidates.ts:1-5,43-... is explicitly a nonproduction pure candidate, tested only in tests/m4b-gameplay.test.ts:228-783. It is not connected to server persistence or transport. server/realtime/DurableRealtimeCore.ts:242-243 rejects the production mutation opcode.
- School isolation, atomic wallet/world/idempotency/outbox and committed ACK are non-negotiable baseline constraints, not optional gameplay knobs (docs/DECISIONS.md:8-12,17,21,43-47). M3.6 hotspot latency remains a launch blocker (docs/ROADMAP.md:14).

## Approval record template — complete per decision

| Field | Required owner entry |
|---|---|
| C-ID + effective campaign | PENDING |
| State | PENDING / APPROVED / REJECTED / SUPERSEDED |
| Approver / approval timestamp | PENDING |
| Explicit ruleset version | PENDING |
| Parameters, enums, units and precision | PENDING |
| Exact input to expected output examples | PENDING |
| Update policy during a live campaign | PENDING |
| Rollback/migration policy for prior state | PENDING |
| Acceptance test evidence and signoff | PENDING |

Decisions below contain options and test scenarios ONLY. No default is selected by this document.

## C-01 — Knowledge, Contest and Defense economics

Source: docs/OWNER_REQUIREMENTS.md:145-151 proposes 1 Point for opening Knowledge, 1 Point for turning adjacent rival Knowledge into shared Knowledge, and 1 Point for defense. Its opening text proposes spending Points on Landmark fuel but supplies no exact Point-to-Crystal conversion. V1 charged 3 Points for shared entry, conflicting with owner proposal (docs/SPEC_CONFLICTS.md:7). Existing development gameplay spends fixture-credit only (shared/gameplay/devRules.ts:29-57).

**Owner must decide:** exact charges and currencies for new Knowledge, repeat/no-change, contest entry, defense and Landmark conversion; whether a failure charges anything; adjacencies; max simultaneous memberships; actor eligibility; resource caps; version/rounding.

**Owner-reviewed acceptance examples needed:** newly explored tile with adequate balance; same tile already known; insufficient balance; same command-key replay with identical payload (no second debit); same key changed payload (conflict); opposing school entry at boundary; two concurrent spenders; retry after committed ACK interruption. Each must specify knowledge mask, balance delta, command result and authorized school delta.

**Dependent scope:** M4-D1/M4-D2 and future M5 point feed. Pure candidates/tests do not authorize production costs (tests/m4b-gameplay.test.ts:94-227; tests/m4b-rule-adapter.test.ts:20-134).

## C-03 — Shared Knowledge, Contest, Defense and general Decay

**2026-10-12 C-03 owner decision UPDATED (partial freeze only):** owner confirmed perpetual multi-school Knowledge sharing if each pays upkeep, plus **OPTION C**: first 24h upkeep-free, afterward a Point obligation per school every 24h. General Decay outside shared Knowledge remains OFF. Read [current C-03 Rev2 detailed draft](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md) (SC01–SC48). The one-shot defended/transfer text and earlier AC tests below are HISTORICAL and SUPERSEDED wherever conflicting. C-03 is **PARTIAL / NOT FROZEN**: C-01 fee and payer, grace, both-fail outcome, C-08 visibility, C-12 scoring and precise settlement still require signoff. No M4-D1 coding or production activation.

Source: docs/OWNER_REQUIREMENTS.md:6,148-151 describes shared exchange at school borders and transfer after one day unless defender contributes 1 Point. V1 has independent school membership, grace of 12 hours and retention decay to zero around 22 hours, not the same transfer mechanism (docs/SPEC_CONFLICTS.md:9). Current rules are pure candidates in shared/gameplay/candidates.ts:43-221 and decay:222-...; tests/m4b-gameplay.test.ts:228-519.

**Owner must decide:** 4-neighbor or 8-neighbor adjacency, contest start/owner, simultaneous attackers, exact 24-hour boundary inclusivity, defender response/refund/reset, what transfers and what remains shared, HQ exemption, school scoring, timer clock/restart semantics. Crucially choose whether a separate general Knowledge decay mechanic exists at all. Do not import V1's 22-hour curve by analogy.

**Acceptance examples to sign:** defense just before / exactly at / after deadline; concurrent open actions; repeating defense; two attackers; timer firing after restart; contest and decay firing simultaneously; HQ tile; lost Knowledge visibility; no double debit/revision on retry. Define exact membership, fog projection, persisted deadline, ACK and outbox outcome for each.

**Dependent scope:** M4-D1 Contest, M4-D2 Defense/Decay. Block implementation of authoritative production commands until C-01/C-03/C-08 owner rules are signed.

## C-08 — Fog and authorization visibility matrix

Owner proposal: fog covers everything except headquarters and landmarks (docs/OWNER_REQUIREMENTS.md:1-4,131-138). The production visibility policy is still pending (docs/SPEC_CONFLICTS.md:14, docs/VISIBILITY_POLICY_PROPOSAL.md). Existing per-school synthetic projections are a correctness fixture, not final owner approval (docs/DECISIONS.md:21).

**Owner must fill a matrix:** For each unknown, discovered, own Knowledge, opposing Knowledge, contested Knowledge, previously lost Knowledge, HQ, Landmark, UniStop and Chest, specify authorized geometry, school identity, state, progress, timer and hints as seen by public visitor / same-school player / opponent / spectator / admin. Specify whether discovered fog persists after losing Knowledge, whether spectators may see hidden tiles, and how errors/logs avoid leaks.

**Acceptance examples:** unseen opponent tile, contested border, reconnect with stale revision, change of school identity, losing a previously discovered tile, spectator resync, hidden puzzle hint and cross-school delta. Review tests/m2-room.test.ts:48, tests/m35-realtime.test.ts:75-420 and tests/m36-delivery.test.ts:24-140 only as synthetic baseline. No raw mask leak.

## C-02 — Landmark contribution, first light and takeover

Owner proposal: 100 Crystals first light, overtake at 120 versus owner 100, correct puzzle +10 Crystals/10%, wrong answer cooldown ten minutes (docs/OWNER_REQUIREMENTS.md:152-156). V1 used initial 1000 and +5% overtaking (docs/SPEC_CONFLICTS.md:8). Neither is automatically an approved production setting.

**Owner must choose:** initial/overtake thresholds, absolute vs relative lead, inclusivity/rounding, persistent contribution accounting, whether old contributions carry forward or reset, simultaneous commit resolution, allowed Crystal spend, refunds and reconnect. Examples at target-1, target, two simultaneous schools, current owner's contribution increase, ownership change while pending and committed retry; each should specify exact authoritative output.

**Dependent scope:** M4-D3. Pure tests at tests/m4b-gameplay.test.ts:532-655,754-783.

## C-09 — Landmark clues, content and buffs

Owner source docs/OWNER_REQUIREMENTS.md:86-100,152-158 lists five Scenic Spots and five symbolic Landmarks; proposes 90% hidden landmark, hints, correct-answer progress and 10-minute incorrect-answer cooldown. Early owner prose speaks of fuel/coal, later numerical section Crystals; do not silently normalize terms. Buff ends when another school lights the Landmark; effects, duration, stacking, accessible quiz flow and map publication are unapproved (docs/SPEC_CONFLICTS.md:15).

**Owner must choose:** catalog ID/name/answers, diacritic/case handling, hint exposure, who may guess, abuse protection, exact puzzle-to-resource impact, buff type/percentage/duration/stacking, takeover revocation, audit and gift interaction. Acceptance examples for right/wrong guess, cooldown boundary, simultaneous answer, school change, buff revocation at owner switch, retry/reconnect and accessibility.

**Dependent scope:** M4-D3 and M4-D4. Pure tests at tests/m4b-gameplay.test.ts:656-753.

## C-04/C-05 — Official eight-school registry and map layout

Eight universities have been confirmed at the campaign level, but docs/OWNER_REQUIREMENTS.md:52-80 lists the five in its earlier draft. docs/DECISIONS.md:15,23-39 approves a generic immutable 16-slot registry but marks the V1-derived proposed 0-7 university mapping **pending**. Names proposed: HCMUT, HCMCOU, DTU, DHHP, HSU, HUCE, NTU, HCMIU. Reserved slots 8-15 are not campaign schools until assigned.

**Owner must confirm:** official 8-school IDs and slot numbers; HQ locations and nonoverlap; exact collision vs visual footprints; map revision/rollback/onboarding policy and verified student affiliation. Original owner map dimensions: 1000x1000 tiles, HQ 20x20, landmarks 50x50, UniStop 10x5, Chest 2x2 (docs/OWNER_REQUIREMENTS.md:131-138); V1 disagrees on HQ and Landmark footprints (docs/SPEC_CONFLICTS.md:10-11).

**Examples:** stable school bit identity after adding a school, overlapping HQ/landmark rejection, map edge object, updating visuals without modifying knowledge collision geometry, old fog restoration.

## C-12 — Ranking and scoring

Owner emphasizes explored Knowledge area and small fun school-event bonuses; detailed score and ties are missing (docs/OWNER_REQUIREMENTS.md:12-16,31-33; docs/SPEC_CONFLICTS.md:18).

**Owner must choose:** unique discoveries vs currently retained tiles, how contested shared and transferred Knowledge count, personal/school rankings, tie-breakers, decay score loss, event bonus cap/cadence, running-game Point distinction, corrections and snapshots. Examples: shared tile, one-day takeover, decay, tied schools, retroactive run-data correction, school rejoin.

## Future scope deliberately excluded from M4-D0 approval

- C-06/C-07/C-10 (M6): UniStops, chest/key tiers, reward tables and physical Gifts. Owner loot tables display 100% per column and contain item-list conflicts (docs/SPEC_CONFLICTS.md:12-16). Preserve exact original values; no hidden normalization.
- C-11 (M5): external running API, identity verifier, km-to-Points conversion, duplicate/corrected feeds, weekly physical Gift eligibility. No endpoint or mapping is authorized (docs/SPEC_CONFLICTS.md:17).
- C-13 (M6): editor/admin publishing, notification permission, live events; wagering excluded until approved (docs/SPEC_CONFLICTS.md:19).

## Delivery stages and stop conditions

| Stage | Definition of done | Gate |
|---|---|---|
| M4-C closure | Typecheck/lint/asset tests/build plus actual browser E2E and UX evidence | Do not claim browser acceptance without running it |
| M4-D0 | Signed per-C-ID record with version, owner, exact parameters and examples | Partial baseline clarified on 2026-10-12; full signed freeze PENDING |
| M4-D1 | Authoritative Knowledge/Contest state, debit and projection | C-01/C-03/C-08 |
| M4-D2 | Durable Defense, deadlines, recovery and optional Decay | C-03/C-08 |
| M4-D3 | Landmark contribution, puzzle, buffs and takeover | C-02/C-09 (+ C-05 placement) |
| M4-D4 | Connected multi-school game UX, manual + automated E2E | Relevant rules finalized |
| Parallel M3.6 | Fix sustained hotspot visible/ACK latency without lost commits | Production launch blocker independent of M4 |
| M5/M6/M7 | Running integration / rewards & operations / scaling launch | Separate owner release gates |

**Next owner action:** Review and fill the C-01/C-03/C-08 decisions first; then C-02/C-09 for Landmark. Documentation does not activate candidate rules.