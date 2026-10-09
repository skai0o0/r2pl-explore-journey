# R2PL Game V2 game specification — M0 review draft 1.1

**Approval state:** Architecture principles and feature scope come from Master Implementation Plan v1.0. `OWNER_REQUIREMENTS.md` is the latest documented Product Owner **proposal**, copied verbatim from `Gamenote (1).txt`; it is not automatic production approval. Numeric gameplay, reward and competitive rules below are **pending owner approval** unless explicitly marked plan-fixed. V1 is evidence, not authority. An affected command remains blocked or uses a non-rewarding test fixture until its rule version is approved. Record decisions in `SPEC_CONFLICTS.md` and publish an immutable `ruleVersion` before enabling the feature.

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

The authoritative source order is: owner-approved rule decision and published version → this specification → V2 code/tests. The Master Plan fixes the architecture and feature categories. `OWNER_REQUIREMENTS.md` is the latest documented proposal and V1 `README.md`, `docs/architecture.md`, constants, code and tests are observations. The external campaign API contract and final approved map/reward catalog remain absent; do not invent them.

For each approved rule, record approver/date, exact parameters, effective campaign and version, example input/output cases, and whether it can change during a live campaign. A pending row cannot become a hidden default. M1's world representation may proceed after M0 approval because it does not decide these gameplay rules; M2's `EXPLORE_TILE` uses a test rule and cannot become production gameplay until G-03/G-04/G-05 are approved and M3 durability exists.
