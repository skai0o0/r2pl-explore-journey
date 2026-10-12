# R2PL Game V2 game specification — M0 review draft 1.1

> **C-03 NEW OWNER DECISIONS (2026-10-12):** [Incumbent, ~2h Decay, 48h Consolidation and Exact Contributor Refund Addendum](M4D0_C03_CONSOLIDATION_ESCROW_2026-10-12.md) **OVERRIDES conflicting earlier wording.** The *current lawful holder at new Contest start* gets incumbent/free-retention privilege, NOT the first-ever discoverer. When an eligible contested cluster ENTERS DECAY at tDecayStart, **both 2h fade and 48h consolidation clocks start TOGETHER**: forgetting at tDecayStart+2h, settlement deadline at tDecayStart+48h (46h remain after forgetting). The non-incumbent successor's fee is **ceil(N/2) Points**, rounding UP for odd N, with eligible tile/component snapshot rules still pending. Failed consolidation makes eligible inherited Knowledge neutral and **refunds every accepted Point to its ORIGINAL individual contributor**, never the old holder. Store idempotent contributor escrow/refund ledger. 24h initial free shared-upkeep and connected-cluster maintenance rules still apply; global General Decay remains OFF. Earlier grace, contribution eligibility, mixed-holder cases and precise deadline inclusivity remain OPEN. Owner defers bespoke gameplay for exact simultaneous failure of both schools; fail-closed transaction correctness is still mandatory. **Docs only: no production code, no M4-D1/D2 authorization.**

> **C-03 OWNER ECONOMY CLARIFICATION 2026-10-12 (LATEST, NOT PRODUCTION):** The owner directs a **higher one-time Shared Knowledge join fee (2 Points per newly joined already-known tile, compared with 1 Point to explore a fresh tile, as the working numerical example)**, but **upkeep is charged per connected shared Knowledge cluster, NOT per tile**: **1 Point per paid 24h cycle per participating school per connected shared cluster, irrespective of its tile count**. The first 24h after sharing starts remain upkeep-free (Option C). These example amounts are a working owner balance baseline, not a published ruleVersion. Cluster neighbor definition (4/8), same-school-pair vs cross-pair merging, merge/split timing, payer/treasury, grace and both-unpaid outcomes are OPEN. See [current C-03 Rev2 detailed spec + SC49–SC70](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md). The older per-tile daily-upkeep cost language is SUPERSEDED. No production mutation, scheduled debit, or M4-D1 activation.


> **C-03 REV2 OVERRIDE 2026-10-12 — latest owner direction:** [C-03 Rev2 Shared Knowledge & Contest-specific Upkeep](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md) **supersedes** earlier statements that 24h automatically ends in defender victory/transfer. Two schools may share Knowledge indefinitely while EACH pays Points for its own upkeep; when one misses approved upkeep, only that school forgets and the other keeps Knowledge. **General Decay across noncontested tiles stays OFF; contest-specific upkeep/forgetting is ON as a concept.** **OWNER SELECTED OPTION C:** the first 24h of sharing have no upkeep fee; thereafter each school must pay Points for every 24h upkeep period. Fee, collection mode, cutoff, grace, both-fail outcome, C-08 fog and C-12 scoring remain **PENDING**. This is M4-D0 specification only; **NO production authorization, code or timer activation**. Earlier sections are historical or partially superseded wherever they conflict.

## 2026-10-12 owner clarification - partial baseline, not full freeze

**M4-D0 in progress, partial clarifications, FULL FREEZE pending.** Owner authorized "Proceed M4D" for M4-D0 decision-freeze preparation only. See [M4-D0 owner alignment worksheet](M4D0_OWNER_ALIGNMENT_2026-10-12.md) for provenance, unselected options, acceptance examples and gates. This does not authorize M4-D1 or production gameplay.

`OWNER_REQUIREMENTS.md` remains the unchanged historical proposal. Owner declared the older chat `Gamenote.txt` outdated and supplied an updated working 470-line `R2PL_Gamenote_V2_Dong_bo_2026-10-12.txt`, SHA-256 `604dcb332b960e4b4667c9b776e4d946940759a89f74f5d0bf9c6f2dec103341`. These are owner-provided facts; the owner attachment was verified against its SHA-256 by the orchestration lead; the attachment is not tracked here. Import the owner's copy separately later. Historical comparisons below remain historical evidence, not the latest owner position.

- **C-01 partial confirmation:** new Knowledge costs **1 Point**, not Crystal; Points and Crystals are separate. Repeat/no_change, contest/defense, transfer/refund, conversion, caps, rounding, concurrency examples and signed ruleVersion remain pending. `shared/gameplay/devRules.ts` still uses synthetic fixture-credit, version 0; it is not production currency.
- **C-10 partial confirmation:** the existing UniStop and Chest tables in `GAME_SPEC.md` are the correct owner-confirmed V2 baseline; outdated text-file percentages are wrong. Every column totals 100%; preserve all values without normalization. There is no production gacha/reward implementation. Eligibility, stock, distribution and signed ruleVersion remain open.
- **C-11 EXTERNAL BLOCKED (M5):** the campaign/running webdev team has not supplied API schema, endpoints or identity mapping. Do not invent verification, endpoints or km-to-Points conversion; V1 mock 1 km = 10 Points is not production. Prepare interfaces and the synthetic world first under a separately authorized implementation stage.

**Approval state:** Architecture principles and feature scope come from Master Implementation Plan v1.0. `OWNER_REQUIREMENTS.md` is the historical Product Owner **proposal**, copied verbatim from `Gamenote (1).txt`; it is not automatic production approval. Numeric gameplay, reward and competitive rules below are **pending owner approval** unless explicitly marked plan-fixed. V1 is evidence, not authority. An affected command remains blocked or uses a non-rewarding test fixture until its rule version is approved. Record decisions in `SPEC_CONFLICTS.md` and publish an immutable `ruleVersion` before enabling the feature.

**2026-10-12 C-03 latest owner direction — Option C:** two schools may share Knowledge indefinitely by paying upkeep independently; **first 24h of sharing free of upkeep**, then a Point upkeep obligation **every subsequent 24h per school**. General Decay on uncontested Knowledge is OFF. The historical G-04/G-05 text below is evidence, not the new terminal contest rule. See [C-03 Rev2 detailed current draft](M4D0_C03_SHARED_RETENTION_REV2_2026-10-12.md), now SC01–SC48. Exact fee/payer, grace, both-fail behavior, membership/fog/score, cutoff, and production ruleVersion remain PENDING. Pure candidates are not production gameplay.

## Scope and invariants

The game concept is **Hành trình Khám phá**: universities explore knowledge under Fog of War, may share/compete for Knowledge, interact with Vietnamese Landmarks and UniStops, and earn/redeem Points, Crystals, Keys, Chests and Gifts. It includes running kilometer integration, rankings, events, notifications, administration and onboarding. Initial format supports eight confirmed schools and 16 stable slots. Shared state and reward outcomes are server-authoritative. Production student identity comes from the campaign integration, never an email-domain guess or URL parameter.

| Rule ID | Owner proposal and V1 behavior | Classification and proposed interpretation | Status and testable acceptance |
|---|---|---|---|
| G-01 Schools | Owner proposal names five schools; Master Plan and V1 SQL seed eight in slots 0–7. | **Genuine source conflict.** Propose immutable V1 0–7 mapping in `DECISIONS.md`, pending owner confirmation; 8–15 reserved. HQ positions remain an M4 input. | **Pending C-04.** Existing bits unchanged when adding a school; no duplicate slot. |
| G-02 Fog | Owner proposal: map hidden except Headquarters and Landmarks. V1 stores separate school fog and reveals a 5×5 kernel around learned cells. | **Compatible concept; detail absent.** Keep separate school bitsets; public geometry and hidden Knowledge visibility need a matrix. | **Pending C-08.** Two schools receive only authorized discovery and metadata. |
| G-03 Exploration | Owner proposal and V1 both say 1 Point per newly explored tile. V1 also allows review spending. | **Agreement on base cost; review cost and conditions incomplete.** Configure rule after approval. | **Pending C-01.** One committed debit per new tile; failures and retries have no extra debit. |
| G-04 Shared Knowledge | Owner proposal: 1 Point to make a neighbor school's tile shared; defender has one day to spend 1 Point or loses that tile. V1: 3 Points to add independent school knowledge, no transfer deadline. | **Genuine contradiction.** Preserve source alternatives until competition rule chosen. | **Pending C-01/C-03.** Test same-tile races, deadline boundary, defense and ownership projection. |
| G-05 Decay | Owner proposal describes one-day contest defense but no general Knowledge decay curve. V1: 12h grace, then −10 retention hourly, zero at 22h; HQ seed persistent. | **Contest contradiction plus missing general decay rule.** Version timing and exception rules; avoid full-map scans. | **Pending C-03.** Threshold/restart tests per school. |
| G-06 Landmarks | Owner proposal: 100 Crystals first light, rival reaches 120 (20 more), correct puzzle grants 10 Crystals/10% and wrong answer cools 10 min; 50×50 object. V1: 1000 first, +5% overtake, `ceil(target/10)` puzzle, 40×40. | **Genuine threshold, overtake, reward and footprint contradictions.** None are selected for production. | **Pending C-02/C-05/C-09.** Test exact threshold and simultaneous contribution cases. |
| G-07 UniStops | Both sources use Aspire/Nitro/Predator and 12h/24h/24h cooldowns. Owner proposal adds no accumulated spins and weekly running eligibility for physical Gifts; V1 has school capture and per-student cooldown behavior. | **Agreement on durations; ownership/eligibility detail incomplete.** | **Pending C-06.** Test cooldown boundary, school contact, reconnect and one reward per spin. |
| G-08 Chests/Keys | Owner terminology says Silver/Gold/Platinum, while its later map/probability sections say Aspire/Nitro/Predator; V1 uses Aspire/Nitro/Predator with legacy aliases. | **Internal owner terminology conflict.** Keep catalog unresolved; V1 globally consumes chest. | **Pending C-07.** Concurrent opening consumes one key and records one outcome. |
| G-09 Loot/Gifts | Owner proposal contains exact station/chest percentage columns below, plus item-list/table mismatches. V1 coded tables use different values, all totaling 1000; V1 filters ineligible gifts then reweights. | **Genuine configuration conflict and internal item mismatch.** Preserve owner values exactly; do not apply its “missing percentages” instruction when the shown columns already total 100. | **Pending C-06/C-10.** Approved signed table, eligibility, stock and repeat-draw tests. |
| G-10 Running/Points | Owner proposal allows players without weekly running Points to earn nonphysical items; it suggests physical Gift eligibility requires running Points that week. V1 mock uses 1 km→10 Points and dev fallback. | **Eligibility concept supplied; conversion/API/corrections absent.** | **Pending C-11.** Duplicate and correction feeds yield one audited conversion. |
| G-11 Leaderboards | Owner proposes exploration area and small school-event bonuses; V1 ranks school Knowledge count. | **Broad agreement; exact metric/ties/cadence absent.** | **Pending C-12.** Deterministic ties and late correction examples. |
| G-12 LiveOps/admin | Owner proposes Sims-like map editor, notifications and optional future events. V1 has dev editor and toast/event scaffolding. | **Scope supplied; production roles/publishing/consent absent.** Point wagering is explicitly outside current scope. | **Pending C-13.** Role, publish and audit tests. |

## Owner probability values (verbatim numerical values; not normalized)

The copied `OWNER_REQUIREMENTS.md` retains the original Vietnamese wording. These tables transcribe its numeric cells without changing them; each displayed column sums to **100%** by arithmetic. The note's instruction to add missing percentage to Crystal x1 has no numerical remainder in these displayed columns and is not executed. Reward names and eligibility remain unresolved.

| UniStop outcome | Aspire | Nitro | Predator |
|---|---:|---:|---:|
| Points x1 | 32.5% | 29.5% | 25% |
| Points x2 | 10% | 11% | 12.5% |
| Points x3 | 5% | 7% | 10% |
| Crystal x1 | 32.5% | 29.5% | 25% |
| Crystal x2 | 10% | 11% | 12.5% |
| Crystal x4 | 5% | 7% | 10% |
| Treasure Map | 3% | 3% | 3% |
| Key | Aspire 2% | Nitro 1.9% | Predator 1.5% |
| Gift | 0% | 0.1% | 0.5% |
| **Displayed sum** | **100%** | **100%** | **100%** |

| Chest outcome | Aspire | Nitro | Predator |
|---|---:|---:|---:|
| Points x1 | 30% | 25% | 20% |
| Points x2 | 13.5% | 15% | 16.5% |
| Points x5 | 5% | 7.5% | 10% |
| Crystal x1 | 30% | 25% | 20% |
| Crystal x5 | 13.5% | 15% | 16.5% |
| Crystal x10 | 5% | 7.5% | 10% |
| Gift | 3% | 5% | 7% |
| **Displayed sum** | **100%** | **100%** | **100%** |

## Source and freeze procedure

The authoritative source order is: owner-approved rule decision and published version → this specification → V2 code/tests. The Master Plan fixes the architecture and feature categories. `OWNER_REQUIREMENTS.md` is the historical documented proposal (superseded as the current working source by the dated clarification above) and V1 `README.md`, `docs/architecture.md`, constants, code and tests are observations. The external campaign API contract and final approved map/reward catalog remain absent; do not invent them.

For each approved rule, record approver/date, exact parameters, effective campaign and version, example input/output cases, and whether it can change during a live campaign. A pending row cannot become a hidden default. M1's world representation may proceed after M0 approval because it does not decide these gameplay rules; M2's `EXPLORE_TILE` uses a test rule and cannot become production gameplay until G-03/G-04/G-05 are approved and M3 durability exists.
