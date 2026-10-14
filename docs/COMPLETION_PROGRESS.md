# Tiến độ kế hoạch hoàn thiện — checkpoint 2026-10-14

Code baseline: bf67b66. [Audit hiện tại](PROGRESS_AUDIT_2026-10-14.md):124/124 test PASS, strict/lint/build PASS. M4-A accepted không đồng nghĩa full M4 hoặc G-V1 đã hoàn thành.18 hành trình:10 PARTIAL,8 chưa có end-to-end,0 FULL theo composite acceptance; không quy đổi thành % công sức.

Kế hoạch: [V2 completion / G-V1 và G-FULL](V2_COMPLETION_PLAN_2026-10-13.md). Hiện gồm increment03 và HQ/frontier correction; inventory/reward UI đã tích hợp trực tiếp bởi Codex theo owner reassignment. Browser reward mutation acceptance còn chờ explicit approval do auto-review. Đây là trạng thái triển khai, không là signed production ruleVersion. Build này giữ protocol v1 và fixture-credit v0.

## Current implementation baseline

| Boundary | Hiện đang chạy | Quyết định còn chờ / implementation tiếp |
| --- | --- | --- |
| Roster/session | 8 generic fixture-school slots0–7, 16 human aliases và24 bot, validated bootstrap; campaign synthetic persistent | Real school IDs/mapping/HQ và auth từ campaign |
| World/authority | 1000×1000,64×64 chunks, own-school mask/fog;400 HQ tiles/trường, frontier4 cạnh enforced server; bot và browser dùng cùng campaign mới | Object layout/protected footprints/visibility party/admin, full gameplay |
| Wallet/explore | M3 wallet_accounts/ledger_entries/idempotency/outbox; resource fixture-credit, ruleVersion0, cost1; profile/receipt riêng actor | Common dev rewards/inventory đã có; còn promotion running vào ví đang chơi, production account và approved numeric rules |
| UI | Existing Three.js renderer/HUD/selection; dynamic roster/ws port/home anchor; own bot Knowledge visible | 8 HQ artwork riêng (markers đã có), map editor, landmark/shared modals và reward mutation browser acceptance, branding/device QA |
| Knowledge lifecycle | HQ seed + orthogonal expansion/no-change/retry; opponent HQ protected | Shared fees/upkeep/consolidation/decay/refund và private party views; legacy candidates stay inactive |
| Rewards/Running | Aspire/fixed Chest dùng chung dev wallet qua private HTTP; running preparation vẫn riêng | Live feature adapters/account integration; no Gift-bearing draw or external endpoint enabled |
| Outbox failure | On any batch processing failure, release all remaining own-token leases, keep delivered/newer-owned leases intact | Reproduce original triggering relay error if it returns, large hotspot capacity; DB outage still uses lease expiry |

Source reconciliation for R0: Gamenote remains latest product idea direction; DECISIONS/GAME_SPEC approved decisions govern runtime, and SPEC_CONFLICTS tracks unresolved precedence. Knowledge entry/upkeep/timer/scoring, Landmark threshold/carry-over, footprint and UniStop non-running access contradictions remain explicit. This checkpoint selects no pending production number. In particular8-school-bit overlap in a fixture is not implementation of a max-two-school contest rule.

## Work package status

| Package | Status | Evidence / next |
| --- | --- | --- |
| R0-01 parity checklist | Established18 criteria below | Add browser journey/receipt evidence as each feature ships |
| R0-02/03 current spec reconciliation | Baseline documented; full rule freeze pending | Resolve four conflict groups with owner examples; production cases stay blocked |
| R1-01 synthetic8-school binding | Delivered dev scope | Stable actor IDs/tokens, generic registry, profile and same authority |
| R1-02 unified Points/Crystals/inventory | PARTIAL dev backend delivered | Rewards/explore dùng chung wallet và inventory; running/production currency chưa tích hợp, UI panel có; browser reward mutation acceptance còn chờ |
| R1-03 persisted exploration command | Existing path retained and verified | No new migration; same-key retry and server reconstruction keep account/world |
| R1-04 private account/inventory relay | PARTIAL | Private HTTP inventory/catalog/receipt/events delivered; normal UI panel đã mount, actor-private cursor/recovery đã test; binary push chưa có |
| R1-05 client transport bootstrap | Delivered dev scope | Minimal main.ts adapter, no frontend redesign or new opcode |
| R2-00 HQ/frontier | Delivered dev scope; owner review gate retained |400 owned/fog tiles/trường, server4-edge check, protected HQ, cross-chunk/race/restart tests + UI refusal; full Knowledge lifecycle riêng |
| R3-03 bot→player-view | Delivered own-school view |24 bots share playable server; approved combined3D observer pending |
| R3-01/02/04/05 | PARTIAL/NOT DONE | Real world objects/UX/art/onboarding/mobile QA still required |
| R9-A leased batch tail | FIXED with regression | Injected publish/recovery failures release3/3 pending events immediately; fenced cleanup test |
| R9-A original trigger / R9-C scale | OPEN | New reconnect run has no relay errors; not a1000/10000-CCU benchmark |

## V1 parity checklist

PARTIAL does not satisfy G-V1. All remaining player/operator journeys are still required.

| ID | Status after this build | Remaining acceptance |
| --- | --- | --- |
| PV01 profile/HUD | PARTIAL | Complete local inventory/history/error journeys; production identity/economy thuộc G-FULL |
| PV02 world/HQ/fog/navigation | PARTIAL |8 HQ dùng model placeholder đúng tọa độ; full layout/minimap/mobile còn thiếu |
| PV03 explore/review | PARTIAL; HQ/frontier dev integrated | Server/HQ/cross-chunk/restart acceptance đã test; review semantics còn thiếu |
| PV04 shared/giao lưu | PARTIAL fixture overlap | Actual shared commands/private party UI |
| PV05 upkeep/lifecycle | NOT DONE | Durable deadlines/claims/refunds |
| PV06 resources/conversion | PARTIAL common dev inventory API + panel | Running account, approved conversion và browser reward mutation acceptance |
| PV07 Landmark puzzle | NOT DONE live | Server command + modal + cooldown/hints |
| PV08 Landmark contribution/beacon | NOT DONE live | Atomic Crystal pots/takeover/buffs |
| PV09 UniStop | PARTIAL Aspire private dev API + panel | Browser Aspire mutation acceptance, world access policy, Gift-bearing tiers |
| PV10 Treasure Map | NOT DONE journey | Discovery/clue/navigation/privacy |
| PV11 Chest/Key/carousel | PARTIAL fixed Chest/common Key wallet API + panel | World contact/carousel, complete catalog và browser Chest mutation acceptance |
| PV12 Gift | NOT DONE live | Signed policy, synthetic E2E then real fulfillment |
| PV13 ranking/guidance | NOT DONE product | Metrics/ties/corrections/onboarding |
| PV14 notifications/events | NOT DONE product | Durable triggers/inbox/dedup |
| PV15 editor/admin | NOT DONE | RBAC/draft/validate/publish/audit/rollback |
| PV16 reconnect/recovery | PARTIAL | Exploration account verified; all feature state still required |
| PV17 provider/campaign | PARTIAL synthetic | Local provider→playable account integration còn thiếu; real contract/identity thuộc G-FULL |
| PV18 visual/normal-dev separation | PARTIAL | Existing visual assets only;8-school polish/device QA |

Inventory/reward panel đã triển khai theo owner reassignment; xem [Increment03 report](COMPLETION_INCREMENT_03_2026-10-14.md). Bước browser mutation acceptance bị auto-review chặn việc tiêu synthetic Key/credit; cần owner cho phép test này. Các phần độc lập tiếp theo: hoàn thiện world objects/8 HQ và hướng dẫn synthetic play, chuẩn bị Landmark/Knowledge commands trong phạm vi dev đã duyệt. R0 decisions và production gates vẫn riêng.

HQ/frontier correction: [report](HQ_FRONTIER_INTEGRATION_2026-10-14.md),124/124 passing tests. Original plan missed this core acceptance condition; R2-00 now precedes dependent gameplay. Default campaign94000000 replaces the active dev session while preserving93000000 data. User clarification governs this core invariant; official production map and other pending rules remain gated.

Audit update: dev server health200/schools8; bounded bot run đã finished. Không có benchmark scale mới hoặc browser reward-spend acceptance mới. [Full audit và next priorities](PROGRESS_AUDIT_2026-10-14.md).
