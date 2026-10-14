# Tiến độ G-V1 — ruleVersion = 1 — 2026-10-14

**G-V1 local/dev đã hoàn tất: PV01–PV18 đạt 18/18 FULL.** Bản chạy gồm toàn bộ luồng người chơi và Admin, từ config/rules đến PostgreSQL transaction, Three.js/UI và nghiệm thu trình duyệt desktop/mobile. Bộ test gameplay tập trung đạt **24/24 PASS**; TypeScript strict, lint và build PASS.

[GAME_SPEC.md](GAME_SPEC.md) là đặc tả đã ký, **ruleVersion = 1**; các xung đột C-01..C-13 và gate PENDING/BLOCKED của tài liệu cũ đã được chốt và superseded theo Owner Directive. Tham số gameplay tập trung tại [gameConfig.ts](../shared/gameplay/gameConfig.ts). Binary transport vẫn dùng protocol v1; gameplay đang chạy ruleVersion 1, với Points/Crystal/Keys/Maps trong cùng account.

Chạy bản đầy đủ theo [README_PLAY.md](../README_PLAY.md), mở **http://127.0.0.1:4176/**. Running và Gift hiện dùng provider giả lập local/staging. Kết quả này xác nhận G-V1; tích hợp danh tính/portal chạy bộ và giao quà thật thuộc G-FULL trong [kế hoạch completion](V2_COMPLETION_PLAN_2026-10-13.md).

Nghiệm thu: [layout overview](../artifacts/g-v1/layout-overview.jpg), [stepping stone HQ](../artifacts/g-v1/stepping-stone-hq.jpg), [compass onboarding](../artifacts/g-v1/compass-onboarding.jpg), [staging world](../artifacts/g-v1/staging-world.jpg), [Beacon takeover](../artifacts/g-v1/beacon-takeover.jpg), [mobile guidance](../artifacts/g-v1/mobile-guidance.jpg), [mobile Landmark](../artifacts/g-v1/mobile-landmark.jpg). M1–M3.6 foundations đã được chấp nhận; không chạy thêm benchmark 1.000-client, CPU profiling hoặc outbox microbenchmark trong đợt G-V1 này.

## Current implementation baseline

| Boundary | Hiện đang chạy — ruleVersion 1 | Phạm vi / vận hành tiếp |
| --- | --- | --- |
| Roster/session | HCMUT, HCMCOU, DTU, DHHP, HSU, HUCE, NTU, HCMIU ở slots 0–7; 16 human aliases và 24 bot; campaign persistent | Slots 8–15 dự phòng; danh tính thật từ portal thuộc G-FULL |
| World/authority | 1000×1000, chunks 64×64; 8 HQ bảo vệ 20×20, 10 Landmark, 15 UniStop trung lập, 15 Chest trung lập; own-school Knowledge/fog 5×5 | Public world objects; wallets, discoveries và party views đúng phạm vi riêng tư; 0 overlap |
| Wallet/explore | Common account/ledger/idempotency: fresh 1 Point, rival join 2 Points, own/invalid 0; Running 1 km → 10 Points vào ví chơi | fixture-credit là tên lưu trữ nội bộ của Points dev; không phải gameplay ruleVersion 0 |
| UI | V1 modals/dock/minimap/tooltip/ranking/banner/editor đã port và mount; Three.js models/markers, masked puzzle images và Beacon beams | Desktop/mobile đã nghiệm thu; normal play tách Dev tools |
| Knowledge lifecycle | Max 2 trường, merge cluster 4-edge, free upkeep 24h, 1 Point/24h/cluster, consolidation 48h/rolling 2h, expiry/refund | Deadlines/escrow/ownership/score lưu trong PostgreSQL; solo decay OFF |
| Rewards/Running | 15 UniStop trung lập (8 Aspire, 5 Nitro, 2 Predator) & 15 Chest trung lập; chạm Knowledge để chiếm trạm (`ownerSchoolId`); cá nhân cooldown 12h/24h/24h; Treasure Map mở rương riêng; Gift eligibility/stock/fallback | Synthetic CampaignProvider hoạt động end-to-end; portal và fulfillment thật thuộc G-FULL |
| Outbox/recovery | Durable commands/receipts, own-school relay, leased batch tail fix; reload/restart và actor-scoped recovery đã kiểm tra | Giữ nền tảng được chấp nhận; kiểm tra thêm khi có lỗi cụ thể, scale benchmark tiếp tục đóng băng |

## Work package status

| Package | Status | Evidence / next |
| --- | --- | --- |
| R0-01 parity checklist | COMPLETE — 18/18 FULL G-V1 local/dev | PV01–PV18 bên dưới; focused integration tests và desktop/mobile browser acceptance |
| R0-02/03 current spec reconciliation | COMPLETE — signed ruleVersion 1 | GAME_SPEC và gameConfig thống nhất; C-01..C-13 closed, không còn gate số liệu gameplay |
| R1-01 synthetic 8-school binding | COMPLETE — G-V1 local/dev | Official school IDs/slots/HQ; stable actor tokens; server validates campaign binding |
| R1-02 unified Points/Crystals/inventory | COMPLETE — G-V1 local/dev | Explore/rewards/Running cùng ví; Keys theo tier, Maps, private Gift entitlement; ledger/replay tests PASS |
| R1-03 persisted exploration command | COMPLETE — G-V1 local/dev | Same-key retry, protected HQ/frontier, cross-chunk/race và server reconstruction giữ account/world |
| R1-04 private account/inventory relay | COMPLETE — G-V1 local/dev | Private HTTP views/history, polling UI, actor/campaign-scoped recovery; không lẫn ví/discoveries khi đổi actor |
| R1-05 client transport bootstrap | COMPLETE — G-V1 local/dev | Dynamic roster, school/home và transport bootstrap; binary explore + signed gameplay/Admin HTTP routes mounted |
| R2-00 HQ/frontier | COMPLETE — G-V1 local/dev | 400 owned/fog tiles/HQ, server 4-edge validation, rival HQ protected; Shared Knowledge/upkeep/consolidation/refund tích hợp |
| R3-03 bot→player-view | COMPLETE — G-V1 local/dev | 24 bot và người chơi dùng cùng authority/campaign; own-school Knowledge hiển thị trong Three.js/minimap |
| R3-01/02/04/05 | COMPLETE — G-V1 local/dev | Full object layout, V1 UI ports, guidance, normal/dev separation và desktop/mobile QA; PV02/PV07–PV15/PV18 |
| R4-01 GLB Auto-Loader & Draco | COMPLETE — Phase 3 verified | Convention `/models/{hqs,landmarks,unistops,chests}/*.glb`, Draco decoder, manifest pre-flight (0 console 404), faction tinting, Chest_Lid rotation |
| R4-02 Gift Check-in Redemption | COMPLETE — Phase 3 verified | `giftCode` (R2PL-GIFT-XXXXXX), UI badge & copy button, Admin search & 1-time redemption verification idempotent |
| R4-03 500-Client Mixed Load Gate | COMPLETE — 17/10 Gate PASSED | 500 concurrent synthetic clients across 8 schools, 750 mixed ops (WS explore, UniStop spin, Landmark crystal, Shared Knowledge upkeep), 100% success rate (750/750), p50 2.67s, p95 4.47s, zero memory leak |
| R9-A leased batch tail | FIXED — regression retained | Tail leases được giải phóng khi publish/recovery lỗi; delivered/newer-owned leases giữ nguyên |
| R9-A original trigger / R9-C scale | PASS 500-CLIENT GATE / FROZEN 10K | 500 clients thực tế verified 100% success; benchmark 1.000+ và 10.000 CCU tiếp tục đóng băng cho G-FULL |

## V1 parity checklist

18/18 hành trình dưới đây đã đạt FULL cho G-V1 local/dev theo signed ruleVersion 1.

| ID | Status ruleVersion 1 | Evidence G-V1 local/dev |
| --- | --- | --- |
| PV01 profile/HUD | FULL (G-V1 local/dev · ruleVersion 1) | HUD/ví/private history; đổi actor và reload không lẫn inventory; test signed routes + browser |
| PV02 world/HQ/fog/navigation | FULL (G-V1 local/dev · ruleVersion 1) | 8 HQ vòng tròn đồng tâm (R~220), 10 Landmark, 15 UniStop trung lập & 15 Chest trung lập bước đệm (0 overlap); fog riêng 5×5, minimap, Compass Card dẫn đường; desktop/mobile verified |
| PV03 explore/review | FULL (G-V1 local/dev · ruleVersion 1) | 4-edge server authority: fresh 1 Point, own 0; protected HQ/cross-chunk/race/restart PASS; browser revisit 0 |
| PV04 shared/giao lưu | FULL (G-V1 local/dev · ruleVersion 1) | Browser giao lưu 2 Points; cluster ghép 4-edge; max 2 trường và private party view được integration test |
| PV05 upkeep/lifecycle | FULL (G-V1 local/dev · ruleVersion 1) | Browser upkeep 1 Point, consolidation 0/2 → 1/2 → expiry/refund; successful consolidation; guest/both lapse tests PASS |
| PV06 resources/conversion | FULL (G-V1 local/dev · ruleVersion 1) | Points/Crystal/Keys/Maps chung account; Running +10 Points vào ví chơi; ledger conservation/retry PASS |
| PV07 Landmark puzzle | FULL (G-V1 local/dev · ruleVersion 1) | V1 modal/hints, ảnh che mở sau giải; bonus 10% once; browser sai đáp án cooldown 10 phút; mobile image verified |
| PV08 Landmark contribution/beacon | FULL (G-V1 local/dev · ruleVersion 1) | Browser HCMUT thắp 1000 → HCMCOU takeover 1050 → target 1100; persistent school pots; Beacon beam và buff HUD/ranking |
| PV09 UniStop | FULL (G-V1 local/dev · ruleVersion 1) | 15 trạm trung lập (8 Aspire, 5 Nitro, 2 Predator); mở Knowledge chạm footprint trạm để chiếm cho cả trường (`ownerSchoolId`); đổi màu trạm 3D & minimap; quay thưởng cooldown 12h/24h/24h cá nhân |
| PV10 Treasure Map | FULL (G-V1 local/dev · ruleVersion 1) | Browser Aspire nhận Treasure Map; private Chest tọa độ/navigation; actor isolation verified |
| PV11 Chest/Key/carousel | FULL (G-V1 local/dev · ruleVersion 1) | Browser matching Key → finite Chest → CS:GO carousel; one-winner race/retry tests; claimed Chest biến khỏi inventory |
| PV12 Gift | FULL (G-V1 local/dev · ruleVersion 1) | FULL synthetic staging: weekly Running + Gift stock → private Gift entitlement; zero eligibility/stock → Crystal fallback; real fulfillment thuộc G-FULL |
| PV13 ranking/guidance | FULL (G-V1 local/dev · ruleVersion 1) | Leaderboard đủ 8 trường, Knowledge Score/timestamp tie rules; buff metadata; hướng dẫn chơi có trên desktop/mobile |
| PV14 notifications/events | FULL (G-V1 local/dev · ruleVersion 1) | Durable own/public event history; toast dedup/bounded; browser admin notification, Beacon/lapse/refund events |
| PV15 editor/admin | FULL (G-V1 local/dev · ruleVersion 1) | 3 mẫu UniStop và 3 mẫu Chest trung lập; thêm/xóa/di dời trực quan trên 3D map; validate/publish/rollback transactional |
| PV16 reconnect/recovery | FULL (G-V1 local/dev · ruleVersion 1) | PG durable command-key replay; reload/server reconstruction giữ ví, Key, Chest claim, Gift, pots, Beacon, deadlines/history; actor recovery scoped |
| PV17 provider/campaign | FULL (G-V1 local/dev · ruleVersion 1) | CampaignProvider interface + working synthetic Running provider; official school binding; conversion cùng ví; real portal contract thuộc G-FULL |
| PV18 visual/normal-dev separation | FULL (G-V1 local/dev · ruleVersion 1) | Normal play/Dev tools tách riêng; V1 modules mounted; desktop/mobile guidance, minimap, modal/carousel QA; ảnh trong artifacts/g-v1 |

## Historical checkpoints

Các [audit baseline](PROGRESS_AUDIT_2026-10-14.md), [increment03](COMPLETION_INCREMENT_03_2026-10-14.md) và [HQ/frontier correction](HQ_FRONTIER_INTEGRATION_2026-10-14.md) ghi lại trạng thái trước ruleVersion 1. Các dòng PARTIAL, approval pending, roster generic, campaign 94000000 và gameplay v0 trong những checkpoint đó không mô tả bản hiện tại. Campaign mặc định hiện tại là `98000000-0000-4000-8000-000000000000`, code `school-play-rule1-layout3-20261014` (Hotfix UniStop & Chest trung lập + School Capture); restart giữ tiến độ trong cùng database.
