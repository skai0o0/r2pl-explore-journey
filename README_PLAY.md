# Chạy R2PL G-V1 đầy đủ — ruleVersion = 1

Bản G-V1 local/dev đã nghiệm thu **PV01–PV18: 18/18 FULL**, với 8 trường HCMUT, HCMCOU, DTU, DHHP, HSU, HUCE, NTU, HCMIU. Gameplay gồm Shared Knowledge/upkeep/consolidation, Landmark/puzzle/Beacon, UniStop 3 cấp, Treasure Map/Chest/Key/carousel, Running/Gift staging, leaderboard, notifications và Admin Map Editor.

## Chạy nhanh trên workspace hiện tại — PowerShell

PostgreSQL fixture đã dùng để nghiệm thu chạy ở `127.0.0.1:55439`. Từ thư mục repo, với dependencies đã cài:

```powershell
$env:R2PL_BOT_SIMULATION = '1'
$env:R2PL_BOT_DATABASE_URL = 'postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current'
npm run play:schools
```

Mở **http://127.0.0.1:4176/**; Colyseus WebSocket dùng cổng **2568**. Nếu bản này đã chạy, mở URL để chơi ngay. Dừng process đang giữ cổng/campaign trước khi chạy một instance khác; launcher chỉ cho phép một writer cho mỗi campaign.

`play:schools` build client, áp dụng migrations M3/M3.5, seed campaign một lần và khởi tạo signed gameplay schema/world objects (migration 003). Không cần chạy migration thủ công. Có 16 tài khoản người chơi giả lập và 24 bot; bot khám phá tối đa 10 phút, server vẫn mở để chơi sau khi bot kết thúc. Dừng bằng `Ctrl+C`.

## Cài đặt lần đầu / database khác

Cần **Node.js 22.12+**, npm và **PostgreSQL 16** local. Tạo database dev với user có quyền tạo schema, rồi cài dependencies và đặt connection string:

```powershell
npm ci
$env:R2PL_BOT_SIMULATION = '1'
$env:R2PL_BOT_DATABASE_URL = 'postgresql://YOUR_LOCAL_USER:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/r2pl_prep_test_gv1'
npm run play:schools
```

Database phải nằm trên loopback và có tên `r2pl_prep_test_*` hoặc `r2pl_bot_test_*`, ví dụ `r2pl_prep_test_gv1`. Giữ database để giữ ví, Knowledge, cooldowns, Chest claims, Gift entitlements, Crystal pots, Beacons, layout và history khi restart. Campaign mặc định: `97000000-0000-4000-8000-000000000000` (`school-play-rule1-layout2-20261014`).

## Thao tác chơi nhanh

- Chọn explorer ở menu trường. Tài khoản mới có **1.000 Points, 1.000 Crystal và 1 Key mỗi tier**; HQ có 400 ô Knowledge khởi tạo. Account đã chơi giữ số dư hiện tại.
- Kéo để lia, cuộn để zoom; `H` về HQ, `L` đến địa danh, `O` xem toàn bản đồ, `I` đổi camera. Bấm minimap để dẫn đường. Menu **Địa danh · Tiếp tế · Running** có tọa độ X/Z, danh sách objects và **Hướng dẫn chơi**.
- Click ô kề 4 cạnh để khám phá: fresh **1 Point**, giao lưu ô một trường khác **2 Points**, own/invalid **0 Points**. Shared Knowledge tối đa 2 trường; upkeep miễn 24h đầu rồi 1 Point/24h/cluster. Menu hiển thị hạn upkeep/consolidation và nút đóng góp.
- Knowledge của trường cần chạm Landmark để giải đố/nạp Crystal. Giải đúng cộng 10% mốc vào pot một lần; sai chờ 10 phút. Thắp Beacon ở 1.000 Crystal; takeover tăng tuyến tính 1.050, 1.100… Buff metadata hiển thị ở HUD/ranking.
- UniStop Aspire/Nitro/Predator có cooldown riêng từng người/từng trạm 12h/24h/24h; staging đã unlock trạm. Treasure Map dẫn tới Chest riêng của người nhận; Chest cần **1 Key đúng tier** và chỉ có một người thắng. Carousel hiển thị kết quả do server quyết định.
- Bấm **Chạy giả lập 1 km · +10 Points** để sync Running vào ví đang chơi. Người chưa có km tuần vẫn quay/mở rương được; Gift slot khi chưa đủ eligibility hoặc hết stock fallback thành Crystal ×4 ở UniStop, ×10 ở Chest.
- Xem leaderboard 8 trường, inventory và **Lịch sử & thông báo**. **Dev tools** bật/tắt thông tin chẩn đoán; giao diện chơi mặc định ẩn phần này.

## Admin Map Editor và Gift staging

Mở **Admin Map Editor**, nhập key mặc định local **`dev-map-admin`**, bấm **Mở editor**. Có thể dùng key riêng bằng cách đặt `$env:ADMIN_KEY` trước khi chạy server.

Trong editor, chọn **Di dời**, click vị trí trên bản đồ, xem preview footprint rồi bấm **ÁP DỤNG NGAY LÊN SERVER**. Menu Admin có **Đặt object mới** cho UniStop/Chest và tier, **Khôi phục layout trước** để rollback, cùng form thông báo campaign. Server kiểm tra bounds, overlap, đủ roster và HQ ownership trước khi commit.

Để thử Gift: sync ít nhất 1 km Running của explorer trong tuần hiện tại; mở editor để xác thực Admin, đóng panel editor, chọn **Tier mới**, nhập **Gift stock staging**, bấm **Cập nhật Gift stock staging**. Stock ban đầu là 0. Running và stock chỉ tạo điều kiện nhận Gift; kết quả còn phụ thuộc RNG theo bảng xác suất đã ký. Gift hiện là entitlement giả lập trong inventory; portal Running và giao quà thật thuộc G-FULL.

## Campaign nghiệm thu nhanh có đường tới Landmark

Sau khi database đã được khởi tạo bằng launcher ở trên, có thể mở thêm một campaign biệt lập để thử Landmark/giao lưu mà không cần tự khám phá đường dài:

```powershell
npm run build:client
node --experimental-strip-types scripts/acceptance-gameplay.ts
```

Giữ hai biến `R2PL_BOT_SIMULATION`/`R2PL_BOT_DATABASE_URL` như trên. Script tạo campaign UUID mới, dùng port tự cấp và in JSON có `url` để mở; nó đã xây đường Knowledge thật bằng cùng transaction cho HCMUT/HCMCOU tới Fansipan và ô giao lưu **(350, 200)**.

Campaign này dùng RNG nghiệm thu do server giữ: draw đầu Aspire là Treasure Map, draw tiếp theo Predator là Gift slot (fallback nếu chưa đủ điều kiện), draw thứ ba là Gift slot. Có thể thử theo thứ tự Aspire UniStop → Predator UniStop khi chưa sync Running → sync 1 km, cấp stock Predator → mở Chest Predator. Launcher chơi chính `play:schools` dùng RNG bình thường.

## Kiểm tra gameplay tập trung

Dùng một database test local đã khởi tạo, đặt connection string giống database dev được chọn:

```powershell
$env:R2PL_PREPARATION_DATABASE_URL = $env:R2PL_BOT_DATABASE_URL
npm run typecheck
npm run lint
npm run build:client
node --experimental-strip-types --test --test-concurrency=1 tests/expansion.test.ts tests/signed-gameplay.test.ts tests/school-play-integration.test.ts tests/playable-rewards.test.ts tests/reward-session.test.ts
```

Bộ nghiệm thu hiện tại: **24/24 PASS**, không skip; có coverage identity/privacy, ledger/idempotency, finite Chest race, Gift eligibility/fallback, Landmark takeover/cooldown, Shared Knowledge deadlines/refund và Admin publish/rollback/restart. Không cần chạy benchmark hạ tầng để chơi hoặc nghiệm thu G-V1.

## Tài liệu và ảnh nghiệm thu

- [Tiến độ 18/18 FULL](docs/COMPLETION_PROGRESS.md)
- [Signed GAME_SPEC — ruleVersion 1](docs/GAME_SPEC.md)
- [Config gameplay trung tâm](shared/gameplay/gameConfig.ts)
- [Staging world](artifacts/g-v1/staging-world.jpg), [Beacon takeover](artifacts/g-v1/beacon-takeover.jpg)
- [Mobile guidance](artifacts/g-v1/mobile-guidance.jpg), [Mobile Landmark](artifacts/g-v1/mobile-landmark.jpg)

`npm run play:local` vẫn là launcher legacy M4/v0 ở 4173/2567 với roster Dawn/Dusk. Dùng **`npm run play:schools`** ở **4176/2568** để chạy G-V1 đầy đủ. Các launcher này dùng identities giả lập và listen loopback cho local/dev.
