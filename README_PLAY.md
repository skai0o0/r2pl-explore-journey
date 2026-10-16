# Chạy R2PL G-V1 đầy đủ — ruleVersion = 1

## Chơi local mặc định — vào thẳng game

```powershell
# Lần đầu, nếu chưa có .env: Copy-Item .env.example .env
npm run play:school
# play:schools là tên tương đương, vẫn dùng được.
```

Mở URL **Eight-school playable fixture** do lệnh in ra (mặc định **http://127.0.0.1:4176/**). Luồng này hiện màn hình tải rồi vào game bằng tài khoản local, không yêu cầu portal. `.env` dùng database test local; launcher không đọc `.env.portal` và không khởi động portal giả lập. Cổng `4186` của lần thử portal trước là server riêng.

Portal giả lập chỉ mở khi chủ động chạy `npm run build:portal` và `npm run demo:portal` cùng server tích hợp `npm run start:portal`, theo phần sandbox bên dưới. `npm run build` chỉ dựng game; `npm run build:all` dựng thêm giao diện portal giả lập.

## AMTECH Live Editor — local/staging

Chạy `npm run play:editor`, mở **http://127.0.0.1:4177/** và đăng nhập tài khoản local `acer@amtech.vn` với mật khẩu `Amtech-local-test-only`. Lệnh này build game/Portal, kiểm tra migration 1–8 và khởi chạy campaign thử nghiệm riêng cho thao tác editor. Migration chuẩn hóa mã trường áp dụng chung database, giữ nguyên tiến trình các campaign. Có thể cấu hình `EDITOR_PORT`, `EDITOR_WS_PORT`, `EDITOR_LOGIN_PORT`, `EDITOR_CAMPAIGN_ID`, `EDITOR_TEST_PASSWORD`. Mật khẩu chỉ được dùng lúc tạo tài khoản thử nghiệm lần đầu; chạy lại không reset mật khẩu cũ.

Danh sách 12 tài khoản AMTECH được seed vào Portal giả lập qua CLI, không qua đăng ký sinh viên. Người dùng chọn AMTECH hoặc nhập email công ty qua form đăng ký tự do sẽ không được cấp admin. Production nhận danh tính có chữ ký và email đã xác thực từ backend Portal theo `integration/openapi.json`; các vRace ID có trong ảnh được giữ làm dữ liệu đối chiếu trong `shared/integration/identity.ts`, không thay thế externalStudentId của Portal.

AMTECH chỉ có role `admin`, không có school slot/HQ, ví, thành tích chạy hoặc quyền chơi. Tám trường thi đấu có role `user`; schoolId thống nhất là `hcmut`, `ou`, `dtu`, `hpuni`, `hsu`, `huce`, `ntu`, `hcmiu`, giữ slots 0–7. Migration 008 chuyển mã cũ trong tài khoản, running binding, HQ, bản nháp và lịch sử editor, giữ nguyên ví/fog/tiến trình. API chỉ nhận mã mới; backend Portal phải cập nhật mapping cùng đợt triển khai. Editor có kéo thả 3D, bám lưới/kiểm tra chồng lấn, chỉnh thuộc tính, hoàn tác/làm lại, lưu và mở lại bản nháp, xuất bản có kiểm tra phiên bản, khôi phục lịch sử, thông báo và xác nhận phát quà. Kho quà thử nghiệm chỉ mở ở staging. Bản nháp không ảnh hưởng người chơi; sau xuất bản, bản đồ đang mở tự nhận thay đổi trong khoảng 3 giây.

## Hợp đồng Partner API v1

Game cung cấp sẵn cổng tích hợp. Web tổng đăng nhập sinh viên bằng email edu, xác minh trường và nhận các hoạt động **được chấp nhận** từ vRace. Web tổng gửi danh tính và snapshot tổng quãng đường hợp lệ **trong chiến dịch** vào game; không gửi mật khẩu, số điểm tùy ý hoặc role. Danh tính quản trị AMTECH cần thêm email đã xác thực và `emailVerified: true`; game tự xác định quyền theo danh sách/domain được duyệt. Không cần game gọi trực tiếp vRace. Bộ kết nối HTTP pull cũ vẫn phục vụ dev; luồng portal mới dùng API push bên dưới và không bật tài khoản giả lập.

**File gửi webdev:** `integration/openapi.json` (OpenAPI 3.1, import vào Postman/Swagger), `integration/partner-client.mjs` (SDK Node server độc lập, không cần dependencies), và phần hướng dẫn này. Khi server chạy, tải contract tại `/api/partner/v1/openapi.json`. Webdev dùng ngôn ngữ khác có thể triển khai theo JSON contract và thuật toán ký bên dưới.

```text
vRace -> backend web giải chạy -> API game -> PostgreSQL / ví / gameplay
                 |                   |
          email edu + BXH       đăng nhập game + Three.js
```

Trách nhiệm web tổng: xác thực email edu và quyền tham dự; map mã trường sang `hcmut`, `ou`, `dtu`, `hpuni`, `hsu`, `huce`, `ntu`, `hcmiu`; loại hoạt động gian lận/ngoài giải; duy trì stable `externalStudentId`; xếp hạng chạy. Game không đoán trường từ email và không tự công nhận số km do trình duyệt gửi. Portal phải chỉ provision sinh viên đủ điều kiện; `eduVerified: true` là lời xác nhận có chữ ký từ backend đối tác, không phải cơ chế tự kiểm chứng email của game.

Trách nhiệm game: tài khoản/phiên chơi, mapping trường bất biến, quy đổi ruleVersion 1 **1 km = 10 Points**, số dư có thể tiêu, ledger, thưởng, bản đồ và BXH Knowledge. Hai trường điểm được tách rõ:

- `earnedRunningPoints`: tổng Points từ quãng đường chạy được công nhận; dùng cho BXH chạy. Tiêu điểm trong game không làm giảm giá trị này. Thưởng trong game không làm tăng BXH chạy.
- `spendablePoints`: số dư thực tế dùng chơi game, sau đồng bộ chạy, thưởng và các khoản đã tiêu. Không ghi đè số dư bằng tổng điểm chạy.

Ví dụ: 1.500 m -> 15 Points; mở một ô tốn 1 -> BXH chạy vẫn 15, ví game còn 14. Snapshot 2.000 m ở revision mới chỉ cộng thêm 5 -> ví 19. Tổng quãng đường được giữ trước khi làm tròn nên nhiều lần chạy ngắn không mất phần lẻ.

### Các API đối tác triển khai

| API, đều POST JSON server-to-server | Nội dung |
| --- | --- |
| `/api/partner/v1/members` | `{externalStudentId, schoolId, displayName, eduVerified:true, active:true}`; lặp lại không reset ví. `active:false` thu hồi đăng nhập. Đổi trường yêu cầu xử lý riêng, không tự chuyển Knowledge. |
| `/api/partner/v1/running` | `{externalStudentId, revision, cumulativeMeters, weeklyMeters, observedAtMs, weekStartMs}`; các số quãng đường/revision là chuỗi decimal. |
| `/api/partner/v1/accounts` | `{externalStudentId}` -> tổng điểm chạy, ví còn lại, tổng mét và revision mới nhất, chỉ dành cho backend. |
| `/api/partner/v1/launches` | `{externalStudentId, codeChallenge}` -> link đăng nhập game một lần, hạn 60 giây. |

`revision` tăng theo từng sinh viên/chiến dịch, bắt đầu từ `"1"`. `cumulativeMeters` là tổng mét được công nhận trong giải, **không phải delta của một hoạt động, không phải tổng lifetime vRace**. `weeklyMeters` dùng tuần bắt đầu thứ Hai 00:00 Asia/Ho_Chi_Minh. `observedAtMs` là thời điểm portal tạo snapshot hiện tại, không phải thời điểm chạy gần nhất; lệch tối đa 5 phút so với server. Cập nhật tuần mới cũng tăng revision.

Lưu snapshot vào outbox/job queue bền vững trên web tổng trước khi gửi. Khi timeout/mạng lỗi, gửi lại **đúng nguyên snapshot**, gồm cả observedAtMs, với nonce/chữ ký HTTP mới. Cùng revision + payload giống hệt trả biên nhận cũ, không cộng lại. Cùng revision khác payload -> `409 REVISION_CONFLICT`; revision thấp chưa từng nhận -> `409 STALE_REVISION`. Biên nhận đã commit có thể replay kể cả sau khi hết freshness. Số dư trong biên nhận là tại thời điểm commit; dùng `accounts` để lấy số dư hiện tại.

Khi vRace sửa/hủy một hoạt động: gửi tổng hợp đã điều chỉnh ở revision cao hơn. Game trừ phần chênh lệch nếu ví đủ. Nếu khoản cần thu hồi đã được tiêu, trả `409 CORRECTION_REQUIRES_REVIEW`, không sửa checkpoint hay ví và không tự tạo số dư âm. BTC phải xử lý đối soát trước khi retry; không tự tăng revision để bỏ qua lỗi. Thay tỷ lệ quy đổi giữa giải cũng cần đối soát/rebase riêng.

### Chữ ký và ví dụ Node backend

Mỗi môi trường/chiến dịch được cấp origin, campaign UUID, key ID và secret riêng qua kênh kín. Secret chỉ ở backend hai bên. Có thể giữ đồng thời key cũ/mới trong `PORTAL_KEYS_JSON` khi rotate, sau khi web tổng chuyển xong thì gỡ key cũ và restart game. Không gửi secret/token qua email công khai hoặc log.

HTTP headers: `Content-Type: application/json`, `X-R2PL-Campaign`, `X-R2PL-Key-Id`, `X-R2PL-Timestamp` (Unix milliseconds dạng chuỗi 13 chữ số), `X-R2PL-Nonce` (random base64url 16–128 ký tự), `X-R2PL-Signature`.

Canonical message gồm **7 dòng UTF-8**, nối bằng LF, không có LF cuối:

```text
r2pl-v1
<campaign UUID>
POST
<exact path, ví dụ /api/partner/v1/running>
<timestamp milliseconds>
<nonce>
<lowercase hex SHA256 của nguyên byte JSON body>
```

Signature = lowercase hex HMAC-SHA256(canonical message, partner secret). Ký xong không serialize lại body. Đây là protocol HMAC riêng, không tự nhận tương thích OAuth hoặc HTTP Message Signatures. Campaign và request path được ký để chống dùng nhầm chữ ký sang chiến dịch/endpoint khác. Server giữ nonce trong PostgreSQL để chống replay qua restart/nhiều process. Hạn 300 request/phút/key/chiến dịch; JSON tối đa 16 KiB. Đồng bộ NTP hai bên. Retry 429/503/network với exponential backoff có giới hạn; 429 có `Retry-After: 60`. Các 4xx khác cần sửa dữ liệu/quyền trước. `requestId` trong lỗi dùng để đối chiếu; không log body xác thực, ticket hay Authorization.

```javascript
import { R2plPartnerClient } from './partner-client.mjs';
const game = new R2plPartnerClient({
  origin: process.env.R2PL_GAME_ORIGIN,
  campaignId: process.env.R2PL_CAMPAIGN_ID,
  keyId: process.env.R2PL_KEY_ID,
  secret: process.env.R2PL_PARTNER_SECRET,
});
await game.request('members', {
  externalStudentId: verifiedStudent.id, // lấy từ phiên server đã xác thực
  schoolId: approvedSchoolMapping[verifiedStudent.schoolId],
  displayName: verifiedStudent.displayName,
  eduVerified: true, active: true,
});
const receipt = await game.request('running', durableSnapshot);
// receipt.earnedRunningPoints -> BXH chạy; receipt.spendablePoints -> ví game
```

### Đăng nhập từ landing page sang game

1. Sinh viên đăng nhập trên portal giải chạy của web tổng, rồi bấm **Chơi game** mở `<PUBLIC_ORIGIN>/?entry=portal` trong cùng tab. Game hiện màn hình tải và bắt đầu handoff mới từ phiên portal hiện tại; không có bước bấm đăng nhập thêm trong game.
2. Game tự sinh verifier ngẫu nhiên trong sessionStorage và chuyển trình duyệt đến `PORTAL_LOGIN_URL` kèm `game_campaign`, `game_challenge` (base64url SHA256 verifier, không padding) và `game_return`. Portal dùng phiên sinh viên đã đăng nhập để cấp lượt chơi; chỉ yêu cầu đăng nhập trên web tổng khi phiên đó chưa có/hết hạn. Mở game trực tiếp khi chưa có phiên cũng tự bắt đầu handoff này.
3. Portal đăng nhập/kiểm tra phiên sinh viên; kiểm tra campaign và `game_return` khớp **chính xác URL game đã đăng ký**, không redirect tới URL tùy ý. Gọi `members` nếu cần, rồi gọi `launches` từ backend với sinh viên của phiên hiện tại và challenge nhận được. Không nhận ID sinh viên từ query làm danh tính.
4. Portal trả HTTP **303** tới `launchUrl` do game trả về, trên cùng tab. Không chuyển ticket qua query string, iframe hoặc postMessage.
5. Game xóa fragment khỏi thanh địa chỉ và POST ticket + verifier đến `/api/portal/session` từ đúng Origin. Ticket được tiêu một lần, lưu hash server-side. Session game hạn 1 giờ trong cookie HttpOnly, SameSite=Lax, Path=/; Production dùng Secure và tên `__Host-r2pl_game`. Response chỉ có thời hạn, không trả session token cho JavaScript. sessionStorage chỉ giữ verifier tạm trong lúc handoff.
6. Bootstrap trả `csrfToken`; mọi POST đã đăng nhập cần đúng Origin và header `X-CSRF-Token`. Trước mỗi lần join Colyseus, client POST `/api/portal/ws-ticket` để lấy vé một lần hạn 60 giây; session cookie không đi trong payload join. Đăng xuất thu hồi session và socket; hết hạn thì đăng nhập lại. Portal dùng `members active:false` để khóa sinh viên khỏi chiến dịch. Đây là luồng handoff riêng có proof key, không phải OAuth đầy đủ.

Màn hình tải phản ánh các mốc xác thực, hồ sơ/ví, cảnh 3D và snapshot bản đồ. Khi đủ profile, kết nối realtime và vùng bản đồ ban đầu, game mới mở tương tác; lỗi có nút thử lại. HUD hiển thị tên sinh viên/trường; bấm tên để xem điểm chạy tích lũy và điểm còn lại.

Sinh viên chỉ nhận bootstrap của chính mình; không có menu chọn tài khoản người khác hoặc tài khoản dev. Ví khởi tạo **0 Points, 0 Crystal, 0 Keys**. Chạy giả lập và bot bị tắt trong portal mode. Shared Knowledge/rewards/gameplay hiện tại dùng cùng ví được API nạp; tên nội bộ `fixture-credit` và bridge `r2pl_prep.running_bindings` được giữ để tương thích schema hiện có, không cấp tiền giả trong portal campaign.

### Chạy sandbox để webdev thử ngay

Trong PowerShell ở thư mục repo (Node 22.12+, PostgreSQL đang chạy):

```powershell
npm ci
Copy-Item .env.portal.example .env.portal
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Sửa `.env.portal`: đặt DATABASE_URL đúng database **test** của máy; tạo **hai secret độc lập** bằng lệnh trên cho `PORTAL_KEYS_JSON` và `ADMIN_KEY`. Các giá trị `REPLACE_...` bị server từ chối. Nếu game dev đang giữ cổng 4176/2568, dừng bằng Ctrl+C hoặc đổi PORT/WS_PORT cùng PUBLIC_ORIGIN/PUBLIC_WEBSOCKET_URL. File `.env.portal` được Git ignore; không commit secret.

```powershell
npm run migrate:portal
npm run build:all
npm run start:portal
```

Mở cửa sổ PowerShell thứ hai, cùng thư mục:

```powershell
npm run demo:portal
```

Mở portal theo origin của PORTAL_LOGIN_URL (mặc định http://127.0.0.1:4180/), chọn **Tạo tài khoản**, nhập tên, email kiểm thử, trường và mật khẩu riêng cho sandbox (tối thiểu 10 ký tự). Không dùng mật khẩu thật. Edu verification ở đây chỉ được mô phỏng. Sinh viên mới bắt đầu từ **0**, không tự nạp km/Points.

Trong dashboard, **Thêm hoạt động & đồng bộ**, ví dụ 1,5 km → 15 Điểm. Xem lịch sử, trạng thái đồng bộ, BXH chạy và số dư game rồi bấm **Chơi game**. Nếu game tạm tắt, hoạt động/job vẫn được lưu PostgreSQL và retry khi game trở lại; có nút thử lại. Reload/restart/đăng nhập lại giữ tài khoản và lịch sử, không cộng trùng. Đăng xuất portal để tạo sinh viên thứ hai; mỗi sinh viên có ví và hoạt động riêng. Đăng xuất game và portal là hai phiên riêng.

Trong game, **Tìm ô để mở** chọn một ô chưa sở hữu chung cạnh với Tri thức trường mình, ưu tiên hướng công trình tiếp theo; bấm **Khám Phá Ô Này** để xác nhận tiêu Điểm. Bấm HQ/ô đã sở hữu sẽ hiện **Đã mở · 0 Points** và không tiêu thêm. Game tự làm mới ví mỗi 5 giây khi đang xem, khi quay lại tab hoặc khi bấm **Cập nhật Điểm**. Cổng synthetic `4176` và campaign portal là hai thế giới/tài khoản riêng; số dư giả lập không chuyển vào tài khoản portal.

Dummy portal dùng schema `r2pl_dummy`, cookie HttpOnly, password hash scrypt có salt và hàng đợi có lease/retry; mọi đồng bộ game đi qua Partner API v1 có chữ ký, không ghi trực tiếp ví game. `npm run build:all` build cả game lẫn portal; `npm run build` chỉ build game. Demo từ chối chạy ở Production hoặc host ngoài loopback; không dùng thay hệ thống edu/vRace thật. `play:school`/`play:schools` chạy độc lập cho test gameplay. Nút **Về giải chạy** thu hồi phiên game và đưa về web tổng; không reload game để đăng nhập lại ngay.

Nghiệm thu portal/student entry: **172/172 test PASS, 0 fail, 0 skip** khi đặt cả hai biến PostgreSQL test ở phần kiểm thử; strict TypeScript và build game/portal PASS. Các test mới bao phủ tài khoản riêng, giữ dữ liệu qua restart, đồng bộ khi game offline, chống cộng trùng, PKCE, HttpOnly/CSRF, socket ticket một lần và ví sau khi tiêu Điểm. [Portal desktop](artifacts/portal/student-portal-desktop.jpg), [mobile](artifacts/portal/student-portal-mobile.jpg), [đăng nhập game](artifacts/portal/game-login.jpg).

### Triển khai Production và phần cần trao đổi với webdev

Chạy `migrate:portal` bằng tài khoản triển khai trên database dành riêng cho game; migration có checksum, chạy lại không reset dữ liệu. Dùng một campaign UUID riêng, không tái sử dụng campaign synthetic. Seed world theo layout đã duyệt; campaign được giữ qua restart. Startup hiện vẫn cần quyền DDL cho schema/world initialization của engine; chưa tách hoàn toàn deployment role khỏi runtime role.

Đặt `PORTAL_MODE=production`; HTTPS cho PUBLIC_ORIGIN/PORTAL_LOGIN_URL và WSS cho PUBLIC_WEBSOCKET_URL, ADMIN_KEY/partner key thật. Server chỉ bind loopback; reverse proxy TLS công khai HTTP và WebSocket/Colyseus, bao gồm HTTP matchmaking và WebSocket upgrades, tới đúng cổng. Không tắt TLS verification của PostgreSQL. Proxy phải giữ Cookie/Origin và các header HMAC/CSRF, đặt giới hạn body/timeouts và không log cookie/token/ticket. Áp dụng CSP phù hợp client, không nhúng script bên thứ ba trên origin game. `/health` kiểm tra được DB. Bảo đảm backup/restore PostgreSQL, theo dõi lỗi 409/503, ledger và backlog outbox trước khi mở chiến dịch. Launcher hiện giữ **một game writer cho mỗi campaign**; chạy nhiều game instance sẽ bị từ chối. Không xem kết quả sandbox là chứng nhận chịu tải hay production readiness.

Webdev chỉ cần chốt với mình: domain game/portal và endpoint đăng nhập; stable student/campaign IDs; mapping 8 trường; tiêu chí km hợp lệ và phạm vi thời gian giải; lịch push/retry; dữ liệu BXH tổng/trường; quy trình khóa sinh viên và sửa km sau đối soát. Không cần chờ tài liệu vRace để bắt đầu nối sandbox. Khi có tài liệu thật, giữ API v1 này và viết adapter ở backend web tổng. Các điều khoản campaign/anti-cheat, hệ thống edu thật, credential vRace và hosting/TLS chưa được xác minh bằng sandbox này.

Bản G-V1 local/dev đã nghiệm thu **PV01–PV18: 18/18 FULL**, với 8 trường HCMUT, OU, DTU, HPUNI, HSU, HUCE, NTU, HCMIU. Gameplay gồm Shared Knowledge/upkeep/consolidation, Landmark/puzzle/Beacon, UniStop 3 cấp, Treasure Map/Chest/Key/carousel, Running/Gift staging, leaderboard, notifications và Admin Map Editor.

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

1. Copy file vào đúng thư mục trong `client/public/models/` theo quy ước trên. School ID viết thường: hcmut, ou, dtu, hpuni, hsu, huce, ntu, hcmiu. Landmark ID lấy từ `shared/gameplay/gameConfig.ts`; thanglong dùng `hoangthanhthanglong.glb`, cairang dùng `chonoicairang.glb`.
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

Giữ hai biến `R2PL_BOT_SIMULATION`/`R2PL_BOT_DATABASE_URL` như trên. Script tạo campaign UUID mới, dùng port tự cấp và in JSON có `url` để mở; nó đã xây đường Knowledge thật bằng cùng transaction cho HCMUT/OU tới Fansipan và ô giao lưu **(350, 200)**.

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
