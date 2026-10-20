# R2PL Game — Partner API v1.3

> Cập nhật 20/10/2026 · Portal = website giải chạy · Game = R2PL.

[OpenAPI](openapi.json) · [Client Node.js](partner-client.mjs) · [TypeScript types](partner-client.d.mts)

## 1. Kết nối

| Thông số | Demo (Sandbox) | Game (Production) |
| --- | --- | --- |
| `GAME_ORIGIN` | `https://play.skai0o0.id.vn` | `https://skai0o0.id.vn` |
| `CAMPAIGN_ID` | `99000000-0000-4000-8000-000000000001` | `2e00774c-4a8f-4c58-bff6-ed9092901d8f` |
| `KEY_ID` | `partner-main` | `partner-production-20261017` |
| `SECRET` | Cấp riêng | Cấp riêng |

- Secret chỉ lưu ở backend; mỗi môi trường dùng bộ thông số riêng.
- Game chính: `https://skai0o0.id.vn/` — chờ kết nối API với Portal đối tác.
- Demo: `https://play.skai0o0.id.vn/` — môi trường Sandbox để thử tích hợp.
- Portal demo: `https://portal.skai0o0.id.vn/` — xác minh edu và chạy bộ giả lập, chỉ nối Demo.
- `GET /health`: không ký; `mode = staging` ở Sandbox, `production` ở Production.
- `GET /api/partner/v1/openapi.json`: không ký; schema API trực tuyến.

| Portal phụ trách | Game phụ trách |
| --- | --- |
| Xác minh edu, trường, quyền tham gia và nhân sự admin | Hồ sơ game, ví và quyền truy cập |
| Nhận vRace, lọc mét hợp lệ trong giải, gửi tổng tích lũy | Quy đổi `floor(cumulativeMeters × 10 / 1000)` |
| Hiển thị BXH chạy | Trả `earnedRunningPoints` để đối soát |
| Đăng nhập, chuyển người dùng sang game | Phiên game, Live Editor và gameplay |

> BXH đông người: Portal giữ dữ liệu chạy để xếp hạng; `accounts` là truy vấn từng người, không có API lấy toàn bộ BXH.

## 2. Danh tính và dữ liệu

| `schoolId` | Trường |
| --- | --- |
| `hcmut` | Đại học Bách khoa TP.HCM |
| `ou` | Đại học Mở TP.HCM |
| `dtu` | Đại học Duy Tân |
| `hpuni` | Đại học Hải Phòng |
| `hsu` | Đại học Hoa Sen |
| `huce` | Đại học Xây dựng Hà Nội |
| `ntu` | Đại học Nha Trang |
| `hcmiu` | Đại học Quốc tế |

| Quy ước | Yêu cầu |
| --- | --- |
| `externalStudentId` | ID Portal ổn định; không dùng email; regex `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$` |
| Sinh viên | `eduVerified: true`, một `schoolId` trong bảng; trả `role: user`, `playable: true` |
| Admin AMTECH | Email đã xác minh thuộc `amtech.vn`, `amtech-vn.com`, `acer.com`, `dava.vn` hoặc danh sách được duyệt; luôn trả `role: admin`, `playable: false` theo hợp đồng nhân sự v1; quyền chơi hồ sơ test chỉ xác định trong phiên Game |
| `revision`, mét, điểm | Chuỗi số nguyên; `delta` có thể âm |
| Trường thời gian `*Ms` | Unix milliseconds dạng number |
| `earnedRunningPoints` | Điểm chạy cho BXH; tiêu/thưởng game không thay đổi, điều chỉnh vRace có thể thay đổi |
| `spendablePoints` | Số dư tiêu trong game; ví mới bắt đầu từ 0 |

- Portal xác minh và ánh xạ trường; chọn `schoolId: amtech` đơn thuần không cấp admin.
- `role: admin` là nhánh danh tính nhân sự, không chứng minh quyền quản trị. AMTECH mới mặc định đủ quyền, Acer/Dava mặc định chỉ xem BXH; quyền đã chỉnh trên Game được giữ nguyên khi Portal đồng bộ. Không yêu cầu ít nhất một quyền quản trị để cấp launch ticket.
- `playable` trong phản hồi partner `members` mô tả tư cách người chơi thi đấu; nhân sự luôn là `false`, kể cả được Game cấp hồ sơ test. Không suy ra quyền quản trị hay quyền chơi test từ trường này. `playable` trong bootstrap nội bộ Game được xác định riêng theo quyền chơi test.
- Game có nhóm **Chỉ chơi 8 hồ sơ test**: cho phép đăng nhập, `testProfiles: true`, quyền quản trị rỗng. Mọi tài khoản được cấp 8 hồ sơ test vào thẳng game theo luồng đăng nhập thông thường, kể cả có thêm quyền xem dashboard; chuyển hồ sơ giữ danh tính và hành trang riêng; Points test dùng chung 8 ví theo trường cho mọi tài khoản được cấp chế độ này. Tạo tài khoản, đăng nhập hoặc chuyển trường không cấp lại Points. Dashboard chỉ mở khi chủ động vào `/admin` (hoặc `/admin/editor` theo quyền); tài khoản quyền rỗng không xem được dữ liệu quản trị. Nhóm **Đối tác thử nghiệm · Chỉ xem** cấp thêm các quyền xem đã chọn.
- Quản trị Game có thể đặt mật khẩu riêng cho nhân sự AMTECH thuộc nhóm chỉ chơi (không có quyền quản trị); đăng nhập trực tiếp tại `/admin`, độc lập mật khẩu Portal. SSO vẫn hoạt động với cùng danh tính/hồ sơ. Không gửi mật khẩu hoặc gọi `running`/`accounts` cho danh tính nhân sự.
- Bỏ “Cho phép đăng nhập và sử dụng tài khoản” khóa cả SSO lẫn đăng nhập Game; muốn bỏ quản trị nhưng vẫn chơi thì giữ mục này bật và bỏ quyền quản trị.
- Tài khoản quản trị riêng của Game dùng `/admin`, không cần tạo bên Portal; không thay đổi luồng SSO/API sinh viên.
- Đổi trường hoặc đổi ID của danh tính đã liên kết cần đối soát với đội Game.

### Chẩn đoán chuyển tiếp đăng nhập

- Nút Game trên Portal mở `<GAME_ORIGIN>/?entry=portal` trong cùng tab, kể cả email AMTECH; không chọn điểm đến theo `role` hoặc quyền quản trị. Game tạo PKCE mới rồi chuyển về Portal.
- Giữ nguyên `game_campaign`, `game_challenge`, `game_return` qua các bước đăng nhập; sau `members` → `launches`, trả 303 đến nguyên `launchUrl`, bao gồm fragment `#launch`. Không tái sử dụng ticket (60 giây, một lần), không tự dựng URL đích.
- Nếu Portal báo phiên chuyển tiếp hết hạn, đối chiếu bước lỗi, HTTP status, mã lỗi API và `requestId`; không ghi secret, ticket hoặc verifier. Quyền quản trị rỗng không làm SSO thất bại. Đăng nhập Game bằng mật khẩu riêng là đường dự phòng khi luồng Portal lỗi; Game không thể sửa phiên nội bộ của Portal.

## 3. Gọi API

> Backend → backend · POST JSON · Không query string, không chuyển tiếp header `Origin` của trình duyệt · Body tối đa 16.384 bytes · 300 request/phút/key/campaign.

### Client Node.js

> Node.js ≥18; client mẫu ký request, không tự retry; lỗi HTTP trả exception có `status` và `requestId`.

```js
import { R2plPartnerClient } from "./partner-client.mjs";

const game = new R2plPartnerClient({
  origin: process.env.R2PL_GAME_ORIGIN,
  campaignId: process.env.R2PL_CAMPAIGN_ID,
  keyId: process.env.R2PL_KEY_ID,
  secret: process.env.R2PL_PARTNER_SECRET,
});

await game.request("members", {
  externalStudentId: "stu_9001", schoolId: "ou",
  displayName: "Nguyen Van A", eduVerified: true, active: true,
});
const account = await game.request("accounts", { externalStudentId: "stu_9001" });
```

### HMAC-SHA256 — dành cho backend tự triển khai

| Header | Giá trị |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-R2PL-Campaign` | Campaign ID |
| `X-R2PL-Key-Id` | Key ID |
| `X-R2PL-Timestamp` | Chuỗi Unix ms 13 chữ số; lệch tối đa ±300 giây |
| `X-R2PL-Nonce` | Ngẫu nhiên, mới mỗi request; 16–128 ký tự `[A-Za-z0-9_-]` |
| `X-R2PL-Signature` | `hex_lowercase(HMAC_SHA256(SECRET, canonical))` |

> Canonical: 7 dòng UTF-8, nối bằng LF (`\n`), không LF cuối; ký đúng bytes JSON sẽ gửi.

```text
r2pl-v1
<CAMPAIGN_ID>
POST
<exact path, ví dụ /api/partner/v1/running>
<X-R2PL-Timestamp>
<X-R2PL-Nonce>
<sha256_hex_lowercase(raw JSON body bytes)>
```

### `POST /api/partner/v1/members`

> Tạo/cập nhật hồ sơ đã xác minh; gọi lại không reset ví; `active: false` khóa, `true` mở lại.

Sinh viên:

```json
{"externalStudentId":"stu_9001","schoolId":"ou","displayName":"Nguyen Van A","eduVerified":true,"active":true}
```

Response `200`:

```json
{"externalStudentId":"stu_9001","schoolId":"ou","active":true,"role":"user","playable":true}
```

Admin — thay email mẫu bằng email đã xác minh, được duyệt:

```json
{"externalStudentId":"staff_101","schoolId":"amtech","displayName":"Nhan su van hanh","email":"nhansu@amtech.vn","emailVerified":true,"active":true}
```

Response `200`:

```json
{"externalStudentId":"staff_101","schoolId":null,"organizationId":"amtech","role":"admin","playable":false,"active":true}
```

### `POST /api/partner/v1/running`

> Gửi tổng mét hợp lệ trong giải; không gửi delta từng buổi hoặc thành tích vRace ngoài giải.

```json
{"externalStudentId":"stu_9001","revision":"1","cumulativeMeters":"1500","weeklyMeters":"1500","observedAtMs":1792026000000,"weekStartMs":1791738000000}
```

> Timestamp trong ví dụ là minh họa; thay bằng thời gian snapshot thực tế.

| Trường | Quy tắc |
| --- | --- |
| `revision` | Tăng dần theo người/campaign, bắt đầu `"1"` |
| `cumulativeMeters` | Tổng mét hợp lệ từ đầu giải |
| `weeklyMeters` | Mét tuần hiện tại, ≤ tổng mét |
| `observedAtMs` | Lúc chốt snapshot; lệch tối đa ±5 phút với snapshot mới, không lùi so với bản trước |
| `weekStartMs` | Thứ Hai 00:00 `Asia/Ho_Chi_Minh` (UTC+7) của tuần chứa `observedAtMs` |

Response `200`:

```json
{"externalStudentId":"stu_9001","revision":"1","earnedRunningPoints":"15","spendablePoints":"15","delta":"15","replay":false}
```

- Cùng revision + snapshot: trả receipt cũ, `replay: true`, không cộng trùng; số dư hiện tại lấy qua `accounts`.
- Cùng revision + nội dung khác: `409 REVISION_CONFLICT`.
- vRace giảm mét: gửi revision mới; ví không đủ trừ → `409 CORRECTION_REQUIRES_REVIEW`, không áp dụng thay đổi.
- Sang tuần: gửi revision mới với mét tuần mới, kể cả tổng mét không tăng.
- Quà trong game: dùng mét tuần để xét điều kiện, không đảm bảo nhận quà chỉ vì có chạy.

### `POST /api/partner/v1/accounts`

> Lấy điểm và số dư hiện tại của một sinh viên.

```json
{"externalStudentId":"stu_9001"}
```

Response `200` — đã tiêu 4 điểm trong game, điểm chạy vẫn là 15:

```json
{"externalStudentId":"stu_9001","schoolId":"ou","earnedRunningPoints":"15","spendablePoints":"11","revision":"1","cumulativeMeters":"1500","weeklyMeters":"1500","weekStartMs":1791738000000}
```

> Chưa đồng bộ chạy: các số là `"0"`, `weekStartMs: null`; mét tuần luôn thuộc tuần của snapshot gần nhất.

## 4. Đăng nhập Game / Live Editor

> Nút Portal mở `<GAME_ORIGIN>/?entry=portal` trong cùng tab; Game tự xử lý PKCE, cookie và WebSocket.

| Bước | Thực hiện |
| --- | --- |
| 1. Game → Portal | Redirect tới URL đăng nhập đã cấu hình, kèm `game_campaign`, `game_challenge`, `game_return` |
| 2. Portal | Kiểm tra campaign/return URL; giữ ba tham số qua đăng nhập |
| 3. Backend Portal | Lấy người dùng từ session đã xác minh; gọi `members` nếu cần, rồi `launches` |
| 4. Portal → Game | HTTP `303` tới nguyên `launchUrl`, giữ phần `#launch=...` |
| 5. Game | Đổi ticket một lần, kiểm tra PKCE; mở Game hoặc Live Editor theo quyền |

### `POST /api/partner/v1/launches`

> `codeChallenge` = nguyên `game_challenge` nhận từ Game, 43 ký tự `[A-Za-z0-9_-]`; danh tính lấy từ session Portal.

```json
{"externalStudentId":"stu_9001","codeChallenge":"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"}
```

Response `200`:

```json
{"launchUrl":"https://skai0o0.id.vn/#launch=<ticket>","expiresInSeconds":60}
```

> `launchUrl` dùng origin của môi trường đang gọi; ticket một lần/60 giây, hết hạn thì mở lại `/?entry=portal`.

| Môi trường | `game_campaign` | `game_return` — khớp chính xác |
| --- | --- | --- |
| Sandbox | `99000000-0000-4000-8000-000000000001` | `https://play.skai0o0.id.vn/` |
| Production | `2e00774c-4a8f-4c58-bff6-ed9092901d8f` | `https://skai0o0.id.vn/` |

- Không lấy danh tính/quyền từ query; không log secret hoặc ticket.
- Đối tác gửi URL đăng nhập HTTPS nhận GET cho từng môi trường, không có query string hoặc fragment (`#`); Game tự thêm các tham số handoff.

## 5. Retry và lỗi

> Lỗi ứng dụng: `{"error":"<CODE>","requestId":"<UUID>"}`; dùng `requestId`/header `X-Request-Id` để đối soát.

| Lỗi | Xử lý |
| --- | --- |
| `400`, `413`, `415` | Sửa JSON/schema/thời gian/tuần/kích thước/Content-Type; không thêm query string |
| `401 INVALID_SIGNATURE` | Kiểm tra môi trường, campaign/key/secret, giờ và bytes ký |
| `403 MEMBER_SUSPENDED` | Tài khoản đang khóa |
| `403 VERIFIED_ADMIN_IDENTITY_REQUIRED`, `ADMIN_CANNOT_PLAY` | Kiểm tra danh tính/quyền; admin không có ví/chạy bộ |
| `403 ORIGIN_REJECTED` | Bỏ header `Origin` chuyển tiếp từ browser |
| `404 MEMBER_NOT_FOUND` | Gọi `members` trước |
| `404 NOT_FOUND`, `405 METHOD_NOT_ALLOWED` | Kiểm tra endpoint/method |
| `409 REQUEST_REPLAY` | Nonce, timestamp và chữ ký mới |
| `409 STALE_REVISION`, `REVISION_CONFLICT` | Lấy `accounts` đối soát; không sửa revision đã ghi nhận |
| `409 CORRECTION_REQUIRES_REVIEW`, `CONVERSION_CHANGE_REQUIRES_REVIEW`, `SCHOOL_CHANGE_REQUIRES_REVIEW`, `IDENTITY_ALREADY_BOUND` | Dừng retry, phối hợp đội Game |
| `429` | Chờ `Retry-After` — hiện 60 giây |
| `503`, timeout, lỗi mạng | Retry giãn cách tăng dần, có giới hạn số lần |

- Retry `running`: giữ nguyên snapshot, tạo timestamp/nonce/chữ ký mới.
- Snapshot chưa nhận quá 5 phút: lấy `accounts` đối soát, chốt snapshot mới; không đổi nội dung revision đã nhận.
- SDK mẫu không tự retry hoặc xử lý phản hồi HTML từ proxy; Portal cần bọc xử lý lỗi mạng/transport.

## 6. Trước khi mở Production

| Cần cung cấp/chốt | Nội dung |
| --- | --- |
| Thông tin kết nối | Secret từng môi trường, URL đăng nhập Portal, đầu mối kỹ thuật |
| Danh tính | Nguồn xác minh edu, mapping trường, ID ổn định, danh sách/domain admin |
| Dữ liệu giải | Thời gian giải, tiêu chí vRace hợp lệ, tần suất sync, quy trình điều chỉnh mét |

> Nghiệm thu Sandbox: tạo hồ sơ → sync 1.500 m = 15 điểm → replay không cộng trùng → tiêu điểm không giảm BXH → SSO user/admin → khóa/mở → điều chỉnh mét/đổi tuần/retry → khóa Sandbox bị Production từ chối.

## Thông báo hai kênh (20/10/2026)

**Ingame:** chỉ phát hoạt động mới cho người đang kết nối game qua SSE `/api/notifications/live`; không đọc lại lịch sử khi đăng nhập/reconnect. Ba loại đầu tiên: `rally` (cùng trường), `station_arrival` (toàn campaign), `chest_opened` (toàn campaign, chỉ tên hiển thị/trường/cấp rương, không tọa độ, mã quà hay email). Một banner tại một thời điểm; chờ tối đa 10 tin, tối đa 30 giây, bỏ tin hết hạn. Ẩn/đóng tab sẽ ngắt luồng và bỏ hàng chờ ingame. Phản hồi thao tác cá nhân cũng dùng cùng bộ điều phối banner. Hoạt động không dùng hàng chờ offline ingame.

**Web giải chạy:** Game giữ outbox trong PostgreSQL. Hoạt động chỉ được chuyển tiếp khi admin bật từng loại ở tab Thông báo; mặc định cả ba tắt. Nội dung admin soạn được xếp hàng riêng cho Portal, chọn toàn chiến dịch hoặc một trường; không tạo popup ingame. Adapter phía Portal chủ động gọi API lấy lô tin, lưu bền vững rồi xác nhận. Game không gọi URL ngoài và chưa cần cấu hình endpoint nhận phía Portal.

### Hợp đồng adapter

1. Gọi `POST /api/partner/v1/notifications/pull` với `{"limit":20}`. Ký cùng HMAC v1/campaign/key như API hiện tại; giữ secret ở backend. Đường dẫn ký bao gồm `/notifications/pull`. Mỗi lần thử dùng timestamp/nonce/chữ ký mới.
2. Phản hồi `{version:1, deliveries:[{deliveryId,leaseToken,leaseUntilMs,attempt,notification}]}`. `notification` gồm `version`, `notificationId` (bằng deliveryId), `kind`, `title`, `body`, `occurredAtMs`, `audience`. Audience là `{scope:"campaign"}` hoặc `{scope:"school",schoolId:"hcmut"}`; Portal tự ánh xạ sinh viên thuộc trường và kiểm tra quyền nhận. Không dùng email để định tuyến.
3. Lưu notification vào inbox/job của Portal với ràng buộc duy nhất theo `(campaignId, notificationId)` trong cùng giao dịch với việc tạo việc gửi cho người nhận. Nếu đã tồn tại thì không tạo lại. Khi đã commit, gọi `POST /api/partner/v1/notifications/ack` với `{deliveries:[{deliveryId,leaseToken,delivered:true}]}`. Đây là xác nhận adapter nhận/lưu, không phải sinh viên đã đọc.
4. Lỗi xử lý tạm thời: gửi `delivered:false`. Mất tiến trình trước khi ack: đợi lease hết hạn rồi lấy lại; deliveryId giữ nguyên, leaseToken thay mới. Khử trùng bằng notificationId, không bằng leaseToken. `409 NOTIFICATION_LEASE_CONFLICT` nghĩa là lease đã hết hạn/thay mới; không tiếp tục ack lease cũ.

Giới hạn: 50 tin/lô; lease 90 giây; backoff mũ tối đa 1 giờ; tối đa 8 lần nhận; hết hạn sau 7 ngày. Chọn polling 3–5 giây khi rảnh, backoff khi API lỗi; giữ giới hạn chung 300 request/phút/key/campaign. Chỉ xác nhận thành công sau commit ở Portal. Nội dung là plain text, không hiển thị như HTML.

```js
const { deliveries } = await game.pullNotifications(20);
for (const item of deliveries) {
  // Portal tự triển khai transaction + unique(campaignId, notificationId).
  await persistInboxAndScheduleRecipients(item.notification);
  await game.acknowledgeNotifications([{
    deliveryId: item.deliveryId, leaseToken: item.leaseToken, delivered: true,
  }]);
}
```

Tab Thông báo trong Game hiển thị chờ nhận/đang xử lý/đã được adapter xác nhận/thất bại. Thử nghiệm adapter trước trên Sandbox; không lấy hoặc ack thông báo Production để thử kết nối. Các API quản trị cần quyền `notifications.send`, cookie phiên và CSRF; adapter Portal không dùng API quản trị.
