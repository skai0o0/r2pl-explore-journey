# Rà soát tiến độ V2 — 2026-10-14

Baseline code: bf67b66, branch codex/m4a-playable. Đối chiếu writing-block.md, docs/ROADMAP.md, kế hoạch G-V1/G-FULL, Gamenote V2 và source runtime/test hiện có. Đây là báo cáo kiểm tra triển khai; không thay đổi luật, nghiệm thu milestone hoặc bật production. Không sửa V1, Master Plan hay Gamenote của owner.

## Kết luận

Nền tảng world/realtime/durability đã có bằng chứng theo phạm vi nghiệm thu. Bản dev tám trường có vòng HQ → mở rộng bốn cạnh → trừ ví → cập nhật fog → retry/restart, cùng kho và phần thưởng Aspire/Chest synthetic. Tuy nhiên **chưa hoàn thành M4 đầy đủ của Master Plan, chưa đạt ngang V1 (G-V1), chưa sẵn sàng production (G-FULL)**.

M4-A accepted là nghiệm thu playable baseline hạn chế. writing-block.md phần M4 yêu cầu cả Shared/competition, tài nguyên, Landmark illumination và minimal leaderboard, với hành trình explore/compete/contribute/disconnect/return. Không dùng việc có8 trường hoặc124 test để thay thế những luồng chưa triển khai này.

Checklist hiện có **10/18 hành trình PARTIAL,8/18 chưa có luồng end-to-end,0/18 FULL theo tiêu chí tổng thể của kế hoạch**. Đây là số trạng thái của các hành trình composite, không là phần trăm công sức hoặc phủ nhận các phần nền tảng đã hoàn thành. Những phần dev đã hoàn thiện được ghi riêng dưới đây; FULL yêu cầu đủ các phần của từng hành trình và acceptance.

## So với Master Plan / milestone

| Mốc | Trạng thái đúng hiện tại | Giới hạn |
| --- | --- | --- |
| M0 | Architecture baseline accepted | Full production gameplay freeze/mapping còn mở |
| M1 | Million-cell foundation accepted |1 triệu ô,16-slot immutable registry, binary formats/chunk/sector có test; roster production chưa được xác nhận |
| M2 / M2.5 / M2.6 | Correctness có nghiệm thu có điều kiện; investigation/experiment được nghiệm thu theo đo đạc | Protocol v1 mặc định; capacity cao chưa đạt; experiment batching không rollout |
| M3 / M3.5 | Synthetic durable foundation/correctness accepted | Transaction/idempotency/outbox/restart; chưa tương đương production economy hoàn chỉnh |
| M3.6 | Reviewed; hotspot production gate OPEN | Kết quả đã ghi nhận ACK p95 khoảng4.71–5.40s, visible p95 khoảng24.82–25.08s; không có benchmark mới đủ để đóng gate |
| M4-A | Accepted playable baseline | Tám trường, kho và HQ/frontier là các increment dev được triển khai sau baseline; chưa tự coi là owner acceptance mới |
| M4 đầy đủ | PARTIAL | Shared/competition, Landmark contribution/illumination, leaderboard chưa live |
| M5 | Chưa bắt đầu milestone thật; preparation đã có | Provider contracts/reconciliation synthetic riêng; thiếu external contract và integration vào ví đang chơi |
| M6 | Chưa có full gameplay/LiveOps milestone | Một phần rewards đã có dev backend/UI; Gift/admin/editor/events/ranking chưa hoàn chỉnh |
| M7 | Chưa đạt launch readiness | Capacity, deploy/rollback/backup-restore, security/observability và device acceptance còn thiếu |

## So với Gamenote / vòng chơi thực tế

| Phần | Đã nối runtime | Chưa đạt / cần tiếp |
| --- | --- | --- |
| Trường/HQ/fog |8 synthetic aliases,16 human explorers; HQ20×20/trường đã seed400 own Knowledge + fog miễn phí; public models/markers đúng vị trí dev | Official IDs/slots/map, artwork riêng, full object layout/minimap/mobile acceptance |
| Khám phá | Server bắt buộc chung cạnh với CURRENT own-school Knowledge; chặn chéo, ô xa, opponent-only anchor và HQ đối thủ; debit1 fixture-credit trong transaction | Review/study semantics, tương tác lifecycle khi mất/chia sẻ Knowledge |
| Giao lưu | Các school bits có thể cùng tồn tại ngoài HQ; bot đi liền kề từ snapshot thật | Chưa là Shared/contest tối đa2 trường, phí tham gia, upkeep24h, decay/consolidation/refund/scoring/private parties |
| Ví/kho | Unified dev wallet cho explore + rewards; credits/Crystals/Maps/Keys tách tài nguyên; panel, receipt/cursor/pending theo campaign+actor | Running chưa cấp vào ví đang chơi; account/economy production, đầy đủ history/error journeys |
| Aspire/Chest | Private HTTP, durable sampled Aspire/fixed Chest, atomic Key spend, cooldown/claim/outbox/idempotency; normal inventory dialog đã mount | Targets mở sẵn qua starter grants: chưa world contact/discovery. Browser reward-spend acceptance vẫn chờ explicit approval sau auto-review rejection |
| Nitro/Predator/Gift | Reference tables giữ nguyên, UI hiển thị policy pending, fail closed | Không có Gift draw/stock/entitlement/fulfillment; không tự reroll/normalize |
| Treasure Map | Inventory/receipt resource có | Chưa clue/discovery/navigation tới Chest theo quyền |
| Landmark | V2 placeholder art và pure candidate tests | Không có durable puzzle/contribution/illumination/takeover/buff commands hoặc modal live |
| Running | Provider/binding validation + cumulative correction-aware preparation PostgreSQL | Không external endpoint thật, signed conversion, live account promotion hoặc production auth |
| Ranking / events / editor | Expedition log và private reward pull events dùng cho dev | Không product leaderboard/inbox/scheduler/admin/RBAC/draft/publish/audit/rollback |
| Bots |24 WebSocket bot,8 tốc độ/nhóm; planner tránh HQ đối thủ và học own-school projections | Chỉ explore/revisit/overlap, chưa bot chơi toàn bộ Gamenote; counters không là leaderboard hoặc capacity benchmark |

Bằng chứng source: SchoolPlayServer nối ExploreBoundary qua durableBootstrap/M35FixtureAuthority/M3TestMutation; SchoolHeadquarters tạo initial mask/fog; RewardsPanel/RewardSession/DevRewardClient consume private APIs; PgRewardPreparation + DevRewardWallet dùng transaction chung. Contest/decay/landmark hiện nằm trong shared/gameplay/candidates.ts và test, không được nối thành mutation của playable server. WorldView landmark vẫn là visual placeholder.

## Các lệch tài liệu được sửa trong lần audit

- ROADMAP bảng ngày10/10 là lịch sử, có hàng M4-A ready và gameplay not authorized đã lỗi thời so với owner direction sau đó. Thêm bảng current scope ở đầu và giữ nguyên lịch sử để truy xuất.
- Completion plan vẫn có snapshot102 tests, rewards chưa có UI và roster Dawn/Dusk. Đánh nhãn snapshot lịch sử và cập nhật current implementation columns với baseline124 tests.
- Completion progress còn ghi inventory/API như chưa có panel, và đưa production identity/currency thành điều kiện chung với parity dev. Sửa để tách acceptance local khỏi G-FULL.
- R2-00 HQ/frontier là gate bổ sung sau owner correction, có acceptance thật; không còn coi bot adjacency là server enforcement.
- Các chữ CURRENT/LATEST trong note12/10 không là implementation status hiện tại. Gamenote direction13/10 và owner clarification14/10 phải được đọc cùng DECISIONS/GAME_SPEC; production rule conflicts chưa tự resolved.

## Kiểm tra tại baseline này

Strict TypeScript PASS. Biome PASS (110 files,2 pre-existing observer useTemplate infos). Vite client build PASS, JS824.65kB/gzip221.47kB; existing >500kB bundle warning còn mở. Full isolated PostgreSQL/network regression **124/124 PASS,0 skipped**, elapsed24.337s trên Windows local/Node strip-types/PostgreSQL16 loopback. [Test log](benchmarks/completion/progress-audit-tests-2026-10-14.log). [Check log](benchmarks/completion/progress-audit-checks-2026-10-14.log).

Dev health tại4176 trả200, fixtureOnly=true, schools=8, botStatus=finished. Lượt bot có giới hạn600s đã kết thúc; không báo bot đang chạy liên tục. Không có browser playtest mới hoặc performance benchmark mới trong lần audit này. [Browser HQ/frontier evidence trước đó](HQ_FRONTIER_INTEGRATION_2026-10-14.md); [inventory increment](COMPLETION_INCREMENT_03_2026-10-14.md).

## Ưu tiên tiếp theo

1. Chốt current Shared/Knowledge behavior replacement thành acceptance cases trước khi nối transaction/lifecycle/UI; không kích hoạt legacy candidate vì đã có test.
2. Nối world object contact/discovery cho rewards, hoàn tất browser reward-spend acceptance, bảo đảm reward→inventory→explore/reload đúng tài khoản.
3. Chuẩn bị/nối Landmark puzzle/contribution theo config dev rõ ràng và luật được duyệt; tiếp đó ranking/guidance, notifications/editor và QA G-V1.
4. Tiếp tục external adapter preparation khi chưa có contract; capacity/production rollout chỉ đóng bằng benchmark và launch checks phù hợp.

Không đánh một phần DONE chỉ vì có file/endpoint/test. R0 freeze và production gate còn mở được quản lý riêng với phần dev có thể hoàn thiện. Hai untracked artifacts có sẵn (SKILL.md và docs/benchmarks/bots/ui-f9b185da-2a8f-4071-b8d1-e2cfac287ae4/) được giữ nguyên, không đưa vào commit audit.
