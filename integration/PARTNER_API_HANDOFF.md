# R2PL Game — Partner API v1.1

> Cập nhật 19/10/2026 · Portal = website giải chạy · Game = R2PL.

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
| Admin AMTECH | Email đã xác minh thuộc `amtech.vn`, `amtech-vn.com`, `acer.com`, `dava.vn` hoặc danh sách được duyệt; trả `role: admin`, `playable: false` |
| `revision`, mét, điểm | Chuỗi số nguyên; `delta` có thể âm |
| Trường thời gian `*Ms` | Unix milliseconds dạng number |
| `earnedRunningPoints` | Điểm chạy cho BXH; tiêu/thưởng game không thay đổi, điều chỉnh vRace có thể thay đổi |
| `spendablePoints` | Số dư tiêu trong game; ví mới bắt đầu từ 0 |

- Portal xác minh và ánh xạ trường; chọn `schoolId: amtech` đơn thuần không cấp admin.
- Admin Portal → dashboard Game; AMTECH mặc định đủ quyền, Acer/Dava mặc định chỉ xem BXH; Game quản lý phân quyền, không gửi mật khẩu hoặc gọi `running`/`accounts` cho admin.
- Tài khoản quản trị riêng của Game dùng `/admin`, không cần tạo bên Portal; không thay đổi luồng SSO/API sinh viên.
- Đổi trường hoặc đổi ID của danh tính đã liên kết cần đối soát với đội Game.

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
