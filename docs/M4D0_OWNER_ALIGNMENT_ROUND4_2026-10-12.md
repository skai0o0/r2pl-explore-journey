# R2PL V2 — M4-D0 Owner Decisions Round 4

**Date:** 2026-10-12. **Status:** owner-directed implementation freeze candidate, NOT signed production ruleVersion. This document supersedes conflicting prior proposals; no production code, timer, debit, reward deployment or M4-D1/D2 authorization. **Source:** direct owner decisions and Gamenote V2 470-line attachment, plus C-03 Rev2 and consolidation addendum. Older Gamenote values do not override newer owner messages.

## 1. Knowledge Contest / C-01 C-03 — owner approved

**Incumbent:** The "original Knowledge owner" means the *lawful holder immediately before THIS Contest starts*, frozen per tile, not necessarily the historical first explorer. A discovered T, B legally inherited T, C starts new Contest: incumbent B has privilege.

**One side leaves:** If the GUEST/receiver B lapses, the valid incumbent A keeps Knowledge FREE automatically, no action/no consolidation payment/no 2h or 48h successor timer. If INCUMBENT A lapses and only guest B remains, B enters consolidation with fee exactly ceil(N/2) Points for N non-incumbent inherited tiles; ceiling for odd N. Once B legally consolidates, B becomes incumbent in later Contests. The departing incumbent's legacy history never grants a reclaim privilege. Sole Knowledge has no connected-shared upkeep. This resolves previous apparent contradiction about timers: timers affect the guest receiving inherited Knowledge, not an unchallenged incumbent.

**Two clocks after incumbent exits:** At committed instant t0 when only non-incumbent receiver B remains, start decayDeadline=t0+2h and immutable claimDeadline=t0+48h. No additional 6h grace. Each accepted contribution of at least 1 Point from an eligible B student made *strictly before* both deadlines resets only decayDeadline=min(commitAt+2h,claimDeadline); accepted contribution counts toward ceil(N/2). Further contributions may reset decay repeatedly, but NEVER extend 48h. Fee reached before deadlines => immediately SUCCESS, B becomes sole owner. Rolling 2h deadline expires without enough funds => FAILED and qualifying unowned inherited tiles NEUTRAL. Hard 48h deadline expires insufficiently funded => FAILED immediately regardless of recently reset 2h, loss of right to receive, NEUTRAL and exact donor refunds. No resurrection after terminal failure. Equality at deadline: deadline wins; server timestamps only. No 6h grace before these clocks.

**No two schools forgetting at once in v1 game model:** First committed departure leaves ONE receiving party (if receiver exits, incumbent remains; if incumbent exits, receiver claims), so no double-lapse gameplay branch. Server still serializes genuinely concurrent input and fails closed for unresolved ties, without arbitrary winners or duplicate charges.

**Money architecture — TECH LEAD DECISION:** Authenticated student funds only with OWN personal Points wallet. PostgreSQL atomic lock/transaction over case and payer wallet, idempotent command/outbox/ACK; charge at most fee remaining and return actual accepted amount on partial request. One durable ledger row per contribution transaction, not per Point. On failure create individually keyed original-wallet refund obligations, settle retry-safe in bounded batches, keep liability until credit posted. On success consume escrow and write tile ownership atomically; cannot both SUCCESS and REFUND. Audit and partition/archive old financial records later with retention policy. No implementation enabled.

**Upkeep and clusters:** First 24h free; subsequently 1 Point per school per connected A+B Knowledge cluster per 24h cycle (owner working price); four edge neighbors only; maximum 2 schools per Contest, different school-pair components remain separate. Joining another holder's Knowledge costs 2 Points/tile versus 1 Point freshly opened (working balance values). Merge/split changes next cycle's bill only; no retroactive debit/refund. General Decay for solo Knowledge remains OFF.

## 2. C-08 — field-level visibility matrix chosen by tech lead under approved fog intent

| Data | Public | Same-school authenticated | Opponent | Spectator | Audited admin |
|---|---|---|---|---|---|
| Map terrain, publicly placed HQ and named landmarks | Published geometry only | Published geometry | Published geometry | Published geometry | Full authorized |
| Raw school presence mask, school fog bits, discovery history | NEVER | Own-school ONLY | Never rival masks | Never raw | Scoped permission |
| Active Knowledge and remembered tiles | No raw masks; published aggregate only | Own active Knowledge and own remembered geometry; remembered != owned | Own visible contact zone only | Aggregate/delayed board | Scoped |
| Contest parties/stage | Public aggregate only | Own joined Contest, counterpart name/contact tile/status | Only Contests involving that school | Aggregate | Scoped |
| Upkeep, decay and hard deadline | Never private timers | Own applicable due/decay/claim deadlines | No rival private due/debt | Delayed aggregate only | Scoped |
| Consolidation required, raised, remaining; donor lists | Never individual data | Own claim totals; actor sees ONLY own contribution rows | Never rival ledger | None | Privileged finance role |
| Student wallet, km/weekly sync, Keys and refund | None | Actor's own only | Denied | Denied | Privileged and audited |
| UniStop open/cooldown | Published station geometry only | Own weekly eligible flag/cooldown | No others' eligibility | Aggregate only | Scoped |
| Hidden chest coordinates or Treasure Map | Hidden | Own private discovery/map projection only | No other's hidden chest | Hidden | Editor/admin audited |
| Landmark beacon | Published active school and threshold | Plus own school's contribution pot | Only published beacon, not private rival pot | Published only | Scoped |

Remembered fog remains geography once explored, but does NOT grant active ownership, score, Chest entitlement or rival data. Never return raw rival-school bitsets in Colyseus/WebSocket deltas, HTTP errors, logs or reconnect. Role separation: editor cannot browse private money by default; finance can't edit maps without separate permission.

## 3. C-12 — tech lead Knowledge ranking decision

One ACTIVE Knowledge tile counts +1 to EACH legally sharing school. Total school Knowledge score may exceed total unique world cells. Valid solo owner +1. Former school after expiration 0. A receiver with provisional, unpaid consolidation claim scores 0 for inherited tiles UNTIL SUCCESS, because unverified/unfinished inherited knowledge is not established ownership. This is a logic-of-scientific-knowledge interpretation to prevent rank gaming by 1 Point rescue attempts. Neutral tiles score 0. Remembered but forgotten fog score 0. Leaderboard tie: earliest server timestamp reaching current active Knowledge count wins, then immutable schoolSlot ascending. Extra event bonuses, buffs and ranking weight await separate gameplay version.

## 4. C-04 C-05 — Gamenote V2 roster and new footprints

| School slot | Code | School |
|---|---|---|
| 0 | HCMUT | Trường Đại học Bách khoa – ĐHQG TP.HCM |
| 1 | HCMCOU | Trường Đại học Mở TP.HCM |
| 2 | DTU | Đại học Duy Tân |
| 3 | DHHP | Trường Đại học Hải Phòng |
| 4 | HSU | Trường Đại học Hoa Sen |
| 5 | HUCE | Đại học Xây dựng Hà Nội |
| 6 | NTU | Đại học Nha Trang |
| 7 | HCMIU | Đại học Quốc tế – ĐHQG TP.HCM |

These match Gamenote V2 slot candidates; now selected for roster preparation by owner. Immutable unused slots 8–15 reserved. Identity mapping verification remains external C-11 work. NEW owner object dimensions in logical tiles: HQ **30x30**; UniStop **10x2**; Chest **2x2**; Landmark/Scenic/structures **40x40**. Override historical 20x20/10x5/50x50. **World design, eight HQ coordinates, collision map, late-join protection and placement remain deferred as a separate ROADMAP gate; do not invent coordinates.**

## 5. C-02 C-09 — Landmark catalog and beacon

Gamenote V2 landmarks: Đỉnh Fansipan; Vịnh Hạ Long; Núi Ngũ Hành Sơn; Động Phong Nha; Núi Bà Đen; Hoàng thành Thăng Long; Cảng Hải Phòng; Kinh thành Huế; Tòa nhà Bitexco; Chợ nổi Cái Răng. Puzzle/quiz feature DEFERRED by owner (too off-theme); buffs TBD, not a blocker to model beacon.

Each school has its OWN persistent cumulative Crystal contributions to a Landmark. Competing schools may deposit concurrently; contributions remain in their OWN school pot after another team lights the beacon. First activation at **1000 Crystals**. Successive school-color switches need another +5% of BASE 1000 each time, rounded up: index k=0 =>1000, k=1=>1050, k=2=>1100, k=3=>1150. This is the tech lead's linear interpretation of "tăng dần đều"; do NOT switch to compounding 1103 without explicit owner direction. First successful server-serialized qualifying contribution/claim commits Beacon color; only a different school can takeover. Concurrent transitions lock same Landmark and select winner by commit order. Do not auto-reclaim based solely on a stored already-high rival pot when threshold increases: a new authorized contribution/claim command must trigger next attempt. Precise anti-pingpong semantics and eventual Crystal potency/buff effects still await their own milestone.

## 6. C-06 C-07 C-10 — UniStop, week, Chest

UniStop per-student per-station cooldown: **Aspire 12h; Nitro 24h; Predator 24h**. No stacked attempts and no device cooldown reset. A student can use UniStop ONLY if there is a verified POSITIVE weekly running result synced by campaign/webdev into game data for that student during the current run week. This is an explicit OWNER OVERRIDE of old Gamenote's ability to use UniStop without running points; CORE Knowledge exploration may still be played independent of UniStop access.

Week uses **Asia/Ho_Chi_Minh** local time; Monday 00:00 inclusive through next Monday 00:00 exclusive. The initial example is PARTIAL Wed **2026-10-07** through Sun **2026-10-11**; Monday **2026-10-12** begins the next normal Mon–Sun week. Prior-week positive sync does not grant new-week UniStop eligibility. API still absent, so synthetic test only.

Chest: BTC manually places a finite number via future editor per event; Key with matching tier is REQUIRED and consumed with successful open. World chest instance disappears after one successful open (no silent respawn). Hidden location/reveal is PER PLAYER via personal exploration or private Treasure Map from UniStop, not broadcast to everybody. Two simultaneous openers of same world Chest => exactly one winner, one key debit, one reward, one world removal; rejected actor keeps Key. Exact Key tier and Gift stock/conditional gacha remain C-07/C-10 production gates, but test code may use fixtures.

C-13 editor design: simple The Sims-like nontechnical admin UI with snap grid, place/move/delete, object prefab, tile footprint/collision check, event quotas, Chest visibility config, draft/preview, versioned publish/rollback and audit. Split content editor role from sensitive financial data. Build as later LiveOps workstream, not as implicit permission to alter live game.

## 7. C-11 and release gates

External webdev owns student identity, school affiliation, weekly running/km data and corrections. Prepare adapters and idempotent ingestion contracts ONLY; do not invent endpoint, mapping, km->Points conversion or launch auth. Map world layout postponed. M3.6 hotspot latency and M4-C browser/GPU QA still production launch blockers. M4-D1/M4-D2 still await explicit authorization and signed, immutable ruleVersion.

## 8. Round 4 acceptance scenarios

| ID | Input | Expected |
|---|---|---|
| R4-01 | A discovers T; B legally owns T; C challenges | Incumbent=B, NOT historical A |
| R4-02 | Guest leaves and lawful incumbent holds T | Incumbent retains for 0 Point, no 2h/48h claimant timer |
| R4-03 | Incumbent leaves; guest B remains at t0 | B rolling fade due t0+2h, hard claim due t0+48h, no 6h grace |
| R4-04 | B student pays valid 1 Point at t0+1h | Rolling fade deadline becomes t0+3h, hard deadline unchanged |
| R4-05 | 1 Point posted shortly before hard 48h deadline | Rolling fade capped to hard deadline, never extends 48h |
| R4-06 | No payment before active 2h deadline | Claim terminates, inherited non-owned Knowledge neutral; cannot resurrect |
| R4-07 | Pay ceil(N/2) before both deadlines | Immediate SUCCESS, B sole owner, no remaining upkeep |
| R4-08 | N=7 eligible non-incumbent tiles | Fee exactly ceil(7/2)=4 Points |
| R4-09 | Hard 48h expires even after multiple 1 Point resets | FAIL, Knowledge neutral, refunds scheduled |
| R4-10 | Student X contributes 3, Y contributes 2 in failed claim | X refunded 3, Y refunded 2 to original wallets once |
| R4-11 | Request 9 Points with only 2 required | Charge at most 2, ACK actual amount, no overfunding |
| R4-12 | One active Shared tile A+B | Each earns 1 Knowledge, sums may exceed unique world tile count |
| R4-13 | Provisional non-incumbent claim before success | No full ownership ranking credit yet |
| R4-14 | A student lost Knowledge but remembers geography | Remembers location, gets 0 active Knowledge score |
| R4-15 | 5 edge-connected A+B Shared tiles | One upkeep Point/school/paid cycle, not five |
| R4-16 | Bridge joins two components midcycle | New billing count starts next cycle only |
| R4-17 | Third school attempts to join active A+B Contest | No triple-school Contest on v1 |
| R4-18 | Landmark active school A at 1000, B reaches 1050 via committed transaction | B takes Beacon; A pot remains intact |
| R4-19 | Second rival takes Landmark | Threshold 1100, NOT compounding 1103 |
| R4-20 | Running positive sync only Oct 7–11; now week Mon Oct 12+ | UniStop unavailable this new week; exploration still playable |
| R4-21 | Eligible student opens Aspire | Own next cooldown 12h; another device cannot bypass |
| R4-22 | Two authorized players open same Key-protected finite Chest | Only one successful Key consume/reward and chest removal |
| R4-23 | Opponent asks for hidden Chest coordinate/map or donor ledger | Denied by per-student/team visibility filter |
| R4-24 | World designer hasn't chosen eight HQ coordinates | No invented layout or production map publish |
