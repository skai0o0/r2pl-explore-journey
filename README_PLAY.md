# Chạy R2PL G-V1 đầy đủ — ruleVersion = 1

Bản G-V1 local/dev đã nghiệm thu **PV01–PV18: 18/18 FULL**, với 8 trường HCMUT, HCMCOU, DTU, DHHP, HSU, HUCE, NTU, HCMIU. Gameplay gồm Shared Knowledge/upkeep/consolidation, Landmark/puzzle/Beacon, UniStop 3 cấp, Treasure Map/Chest/Key/carousel, Running/Gift staging, leaderboard, notifications và Admin Map Editor.

Commit mã nguồn nghiệm thu Phase 3: **`b05e456`**; sửa GLB/procedural Z-Up: **`b743257`**. Bộ test đầy đủ: **142/142 PASS, 0 fail, 0 skip** khi bật PostgreSQL fixtures; build PASS. Commit cập nhật tài liệu xem `git log -1 --oneline`.

## Chạy nhanh trên workspace hiện tại — PowerShell

PostgreSQL fixture đã dùng để nghiệm thu chạy ở `127.0.0.1:55439`. Từ thư mục repo, với dependencies đã cài:

```powershell
$env:R2PL_BOT_SIMULATION = '1'
$env:R2PL_BOT_DATABASE_URL = 'postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current'
npm run play:schools
```

Mở **http://127.0.0.1:4176/**; Colyseus WebSocket dùng cổng **2568**. Nếu bản này đã chạy, mở URL để chơi ngay. Dừng process đang giữ cổng/campaign trước khi chạy một instance khác; launcher chỉ cho phép một writer cho mỗi campaign.

`play:schools` build client, áp dụng migrations M3/M3.5, seed campaign một lần và khởi tạo signed gameplay schema/world objects (migrations 003/004). Không cần chạy migration thủ công. Có 16 tài khoản người chơi giả lập và 24 bot; bot khám phá tối đa 10 phút, server vẫn mở để chơi sau khi bot kết thúc. Dừng bằng `Ctrl+C`.

## Cài đặt lần đầu / database khác

Cần **Node.js 22.12+**, npm và **PostgreSQL 16** local. Tạo database dev với user có quyền tạo schema, rồi cài dependencies và đặt connection string:

```powershell
npm ci
$env:R2PL_BOT_SIMULATION = '1'
$env:R2PL_BOT_DATABASE_URL = 'postgresql://YOUR_LOCAL_USER:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/r2pl_prep_test_gv1'
npm run play:schools
```

Database phải nằm trên loopback và có tên `r2pl_prep_test_*` hoặc `r2pl_bot_test_*`, ví dụ `r2pl_prep_test_gv1`. Giữ database để giữ ví, Knowledge, cooldowns, Chest claims, Gift entitlements, Crystal pots, Beacons, layout và history khi restart. Campaign mặc định: `98000000-0000-4000-8000-000000000000` (`school-play-rule1-layout3-20261014`).

## Thao tác chơi nhanh

- Chọn explorer ở menu trường. Tài khoản mới có **1.000 Points, 1.000 Crystal và 1 Key mỗi tier**; HQ có 400 ô Knowledge khởi tạo. Account đã chơi giữ số dư hiện tại.
- Kéo để lia, cuộn để zoom; `H` về HQ, `L` đến địa danh, `O` xem toàn bản đồ, `I` đổi camera. Bấm minimap để dẫn đường. Menu **Địa danh · Tiếp tế · Running** có tọa độ X/Z, danh sách objects và **Hướng dẫn chơi**.
- Click ô kề 4 cạnh để khám phá: fresh **1 Point**, giao lưu ô một trường khác **2 Points**, own/invalid **0 Points**. Shared Knowledge tối đa 2 trường; upkeep miễn 24h đầu rồi 1 Point/24h/cluster. Menu hiển thị hạn upkeep/consolidation và nút đóng góp.
- Knowledge của trường cần chạm Landmark để giải đố/nạp Crystal. Giải đúng cộng 10% mốc vào pot một lần; sai chờ 10 phút. Thắp Beacon ở 1.000 Crystal; takeover tăng tuyến tính 1.050, 1.100… Buff metadata hiển thị ở HUD/ranking.
- UniStop Aspire/Nitro/Predator có cooldown riêng từng người/từng trạm 12h/24h/24h; staging đã unlock trạm. Treasure Map dẫn tới Chest riêng của người nhận; Chest cần **1 Key đúng tier** và chỉ có một người thắng. Carousel hiển thị kết quả do server quyết định.
- Bấm **Chạy giả lập 1 km · +10 Points** để sync Running vào ví đang chơi. Người chưa có km tuần vẫn quay/mở rương được; Gift slot khi chưa đủ eligibility hoặc hết stock fallback thành Crystal ×4 ở UniStop, ×10 ở Chest.
- Xem leaderboard 8 trường, inventory và **Lịch sử & thông báo**. **Dev tools** bật/tắt thông tin chẩn đoán; giao diện chơi mặc định ẩn phần này.

## Admin Map Editor, Gift staging và Check-in Quà tặng

Mở **Admin Map Editor**, nhập key mặc định local **`dev-map-admin`**, bấm **Mở editor**. Có thể dùng key riêng bằng cách đặt `$env:ADMIN_KEY` trước khi chạy server.

Trong editor:
- **Map Editor:** chọn **Di dời**, click vị trí trên bản đồ, xem preview footprint rồi bấm **ÁP DỤNG NGAY LÊN SERVER**. Menu Admin có **Đặt object mới** cho UniStop/Chest và tier, **Khôi phục layout trước** để rollback, cùng form thông báo campaign.
- **Gift staging:** Để thử Gift, sync ít nhất 1 km Running của explorer trong tuần hiện tại; chọn **Tier mới**, nhập **Gift stock staging**, bấm **Cập nhật Gift stock staging**. Khi trúng Gift, hệ thống tự sinh mã duy nhất `giftCode` (định dạng `R2PL-GIFT-XXXXXX`) lưu vào entitlement và hiển thị trong Kho đồ cá nhân của sinh viên kèm nút Copy và huy hiệu trạng thái ("⏳ CHỜ CHECK-IN").
- **Tra cứu & Xác nhận Check-in Quà tặng (Phase 3):** Trong panel Admin, có mục tra cứu mã quà tặng `giftCode`. Admin nhập mã quà, xem thông tin sinh viên, trường, loại quà và ngày trúng, sau đó bấm **"Xác nhận đã phát quà"** (`redeemed_at` kiểu timestamptz và `redeemedAt` trong view được lưu cùng transaction PostgreSQL). Lookup dùng `GET /api/admin/gifts?code=...`, xác nhận dùng `POST /api/admin/gifts/redeem` với body chứa `giftCode`; cả hai cần header `X-Admin-Key`. Mã đã nhận hiện **ĐÃ PHÁT QUÀ**; lần xác nhận tiếp theo trả `alreadyRedeemed`, giữ nguyên timestamp. Test 8 request đồng thời chỉ 1 lần thành công. Unique index bảo đảm mã không trùng giữa các campaign; va chạm RNG được cấp lại mã trước commit.

## Cổng 3D GLB Auto-Loader & Draco Decoder (Phase 3)

Game hỗ trợ nạp tự động model 3D `.glb` theo quy ước đường dẫn:
- **8 HQ:** `/models/hqs/<schoolId>_hq.glb` (`hcmut_hq.glb`, `hcmiu_hq.glb`, v.v.)
- **10 Landmark:** `/models/landmarks/<landmarkId>.glb` (`fansipan.glb`, `halong.glb`, v.v.)
- **3 UniStop:** `/models/unistops/unistop_<tier>.glb` (`aspire`, `nitro`, `predator`)
- **3 Chest:** `/models/chests/chest_<tier>.glb` (`aspire`, `nitro`, `predator`)
- **Draco Decoder:** Nằm tại `/draco/` cho phép giải nén mesh nén tốc độ cao.
- **Manifest:** Client await `/models/manifest.json` trước khi dựng WorldView. Asset chưa có trong manifest dùng procedural fallback. Chỉ liệt kê file thực sự có trên đĩa; asset được liệt kê nhưng hỏng/mất vẫn giữ fallback khi loader thất bại.
- **Tự động nhuộm màu & Animation:** Khi load model, các material có tên chứa `Faction` hoặc `Accent` tự động được nhuộm theo `colorHex` của trường chiếm giữ; node `Chest_Lid` tự động xoay mở khi rương được mở.

### Nạp thêm GLB mới

1. Copy file vào đúng thư mục trong `client/public/models/` theo quy ước trên. School ID viết thường: hcmut, hcmcou, dtu, dhhp, hsu, huce, ntu, hcmiu. Landmark ID lấy từ `shared/gameplay/gameConfig.ts`; thanglong dùng `hoangthanhthanglong.glb`, cairang dùng `chonoicairang.glb`.
2. Thêm URL public vào mảng `models` trong `client/public/models/manifest.json`, ví dụ `/models/hqs/dtu_hq.glb`.
3. Chạy `npm run build:client` rồi reload trình duyệt; launcher đang chạy phục vụ `dist/client`.

GLB chuẩn glTF Y-Up được xoay X=π/2, auto-fit Box3 theo span hiện tại (HQ 20, Landmark 36, UniStop 10, Chest 2,5), căn tâm X-Y và đáy minZ=0,12. Footprint gameplay vẫn HQ 20×20, Landmark 40×40, UniStop theo layout, Chest 2×2. Procedural fallback dựng native Z-Up theo footprint, scale=1. HCMUT GLB, Aspire #1, Nitro #1, Núi Bà Đen, Đỉnh Fansipan và đủ 8 HQ đã được kiểm tra trên browser sau commit `b743257`.

## CampaignProvider và biến môi trường

`.env.example` có `DATABASE_URL`, `PORT`, `ADMIN_KEY`, `CAMPAIGN_API_URL`, `CAMPAIGN_SHARED_SECRET` cùng biến local/test. Secret chỉ đặt ở server. Để nạp env trên local/staging:

```powershell
Copy-Item .env.example .env
# Sửa .env: database dev, ADMIN_KEY riêng và endpoint/secret nếu dùng API.
npm.cmd run build:client
node --env-file=.env --experimental-strip-types scripts/play-schools.ts
```

`play:schools` đọc DATABASE_URL (ưu tiên hơn R2PL_BOT_DATABASE_URL), PORT và WS_PORT; vẫn là launcher synthetic trên loopback, chỉ chấp nhận database test theo guard hiện có. Production deployment dùng connection/secret thật và mapping danh tính portal đã phê duyệt; launcher synthetic không chứng nhận production authentication.

Để trống cả CAMPAIGN_API_URL và CAMPAIGN_SHARED_SECRET dùng SyntheticCampaignProvider và nút chạy giả lập. Đặt cả hai rồi restart server sẽ chọn HttpCampaignProvider; nút đổi thành **Đồng bộ Running từ chiến dịch**. Thiếu một biến làm server từ chối cấu hình. API dùng HTTPS (HTTP chỉ cho loopback test), timeout 5 giây, không follow redirect. Contract Webdev cung cấp dưới base URL:

| Request | Response / ràng buộc |
| --- | --- |
| POST `sessions/verify`, body `{credential: string}` | `{provider: "http-campaign", externalStudentId: string, externalSchoolId: string, sessionExpiresAtMs: number}`; session chưa hết hạn; IDs khớp binding server trong `r2pl_prep.running_bindings` |
| GET `running/<externalStudentId>` | `{provider: "http-campaign", externalStudentId: string, revision: string, cumulativeMeters: string, weeklyMeters: string, observedAtMs: number, weekStartMs: number}` |

Cả hai request dùng `Authorization: Bearer <CAMPAIGN_SHARED_SECRET>`. Revision/meters là chuỗi decimal không dấu; revision bắt đầu từ 1. Timestamps là epoch milliseconds; tuần bắt đầu thứ Hai 00:00 Asia/Ho_Chi_Minh. Snapshot phải đúng identity, không quá 5 phút cũ; revision/meters lưu PostgreSQL. Đồng bộ lại cùng dữ liệu không cộng Points lần hai; số mét client gửi không tạo distance ở chế độ HTTP. Cùng snapshot tuần dùng cho Gift eligibility.

## Kiểm thử chịu tải 500 Clients hỗn hợp (Gate 17/10/2026)

Chạy kịch bản tải thực tế 500 clients đồng thời trên 8 trường kết hợp mở ô WebSocket, giao lưu 2 trường, quay UniStop và nạp Crystal Landmark:

```powershell
$env:R2PL_LOADTEST_DATABASE_URL = $env:R2PL_BOT_DATABASE_URL
npm run test:load500
```

Gate mục tiêu **17/10/2026**, nghiệm thu thực tế **14/10/2026 20:29 (UTC+7)** trên PostgreSQL disposable. Script giữ **500 WebSocket** tới hết tải; server cũng xác nhận 500 sessions. Phân bổ 63 người ở 4 trường và 62 người ở 4 trường còn lại.

| Chỉ số | Thực đo |
| --- | --- |
| Mutation thành công | **1.008/1.008 — 100%, 0 fail** |
| Hành động | 500 fresh Explore, 128 Shared joins, 8 capture UniStop, 128 spins, 124 góp Crystal Landmark, 120 upkeep |
| Latency overall p50 / p95 | **2.298,89 / 12.629,61 ms** |
| Thời gian mutation / thông lượng | 15,27s / 66,01 ops/s |
| RSS initial / peak / final | 88,10 / **312,07** / 291,25 MiB |
| Heap used | 45,30 MiB |
| Hội tụ sau mutation | **7,62s**, 0 mask/fog/revision mismatch, 0 pending outbox, 0 ledger mismatch, 0 transport error |

[Bằng chứng JSON đầy đủ và latency từng cohort](artifacts/phase3/500-client-gate.json). Gate chỉ nhận ACK thực sự áp dụng mutation; no-change/rejection đều làm FAIL. Kiểm tra toàn bộ projection đã subscribe của 500 client với PostgreSQL, gồm fog 5×5 qua chunk boundary. RAM là tổng server và 500 test client cùng process; lượt ngắn này chưa chứng minh không rò bộ nhớ hoặc đạt SLO Production. Các số cũ 750 ops / p95 4,47s được thay bằng kết quả gate 500 kết nối thật này.


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
$env:R2PL_TEST_DATABASE_URL = $env:R2PL_PREPARATION_DATABASE_URL
npm.cmd test
npm.cmd run build
```

Bộ test đầy đủ hiện tại: **142/142 PASS, 0 fail, 0 skip** với cả hai biến PostgreSQL ở trên; có coverage identity/privacy, ledger/idempotency, finite Chest race, Gift eligibility/fallback, Landmark takeover/cooldown, Shared Knowledge deadlines/refund và Admin publish/rollback/restart. Test files chạy tuần tự để tránh DDL của các fixture dùng chung schema tranh lock; các race/idempotency test vẫn gửi request đồng thời. Khi không đặt biến database, các test PostgreSQL sẽ skip.

## Tài liệu và ảnh nghiệm thu

- [Tiến độ 18/18 FULL](docs/COMPLETION_PROGRESS.md)
- [Signed GAME_SPEC — ruleVersion 1](docs/GAME_SPEC.md)
- [Config gameplay trung tâm](shared/gameplay/gameConfig.ts)
- [Staging world](artifacts/g-v1/staging-world.jpg), [Beacon takeover](artifacts/g-v1/beacon-takeover.jpg)
- [Mobile guidance](artifacts/g-v1/mobile-guidance.jpg), [Mobile Landmark](artifacts/g-v1/mobile-landmark.jpg)

`npm run play:local` vẫn là launcher legacy M4/v0 ở 4173/2567 với roster Dawn/Dusk. Dùng **`npm run play:schools`** ở **4176/2568** để chạy G-V1 đầy đủ. Các launcher này dùng identities giả lập và listen loopback cho local/dev.

### Player UI Polish

- Giao diện mặc định dùng một HUD: Điểm Tri Thức, Tinh Thể, Hành trang và xếp hạng. Bấm Hành trang để xem chìa khóa, bản đồ kho báu, mã quà và lịch sử.
- Dock hỗ trợ Tự Động hoặc Thủ Công. Thủ Công: chọn Khám Phá/Giao Lưu, chạm ô rồi xác nhận trong thẻ thông tin; máy chủ kiểm tra đúng loại thao tác trước khi trừ Điểm.
- Nhãn công trình nằm cạnh chân đế, tự thu gọn khi xem toàn bản đồ và tránh chồng lấp. Trạm tiếp tế chỉ hiện sau khi mở sương mù; tên địa danh bí ẩn được mở sau khi giải đố.
- Công cụ thử nghiệm: `?mode=dev` hoặc Ctrl+Alt+D. Công cụ quản trị: `?admin=1` hoặc Ctrl+Alt+A. Bỏ query để trở lại giao diện người chơi; API quản trị vẫn yêu cầu `ADMIN_KEY`.
