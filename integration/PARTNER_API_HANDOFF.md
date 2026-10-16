# R2PL Game — Partner API v1.1 (Tài liệu kết nối cho Web Giải Chạy)

Tài liệu kỹ thuật kết nối giữa **Backend Web Giải Chạy (Portal)** và **Backend Game R2PL**.
Đi kèm tài liệu này:
- `integration/openapi.json`: OpenAPI 3.1 schema v1.1 (import thẳng vào Postman / Swagger).
- `integration/partner-client.mjs`: SDK mẫu bằng Node.js (0 dependency, 28 dòng code).

---

## 1. Kiến trúc & Phân tách trách nhiệm

```text
[vRace] ---> [Backend Portal (Web Tổng)] ===(POST JSON + HMAC-SHA256)===> [Backend Game R2PL]
```

- **Portal (Web Tổng) phụ trách:**
  1. Đăng nhập sinh viên bằng mail `.edu`, xác minh tư cách tham gia giải và map sinh viên vào đúng 1 trong 8 mã trường thi đấu (`hcmut`, `ou`, `dtu`, `hpuni`, `hsu`, `huce`, `ntu`, `hcmiu`).
  2. Đối với nhân sự vận hành / BTC (**Đại học AMTECH**): xác minh email và gửi kèm `email` + `emailVerified: true` để nhận quyền `admin` (vào thẳng **Live Editor**, không tham gia thi đấu).
  3. Nhận dữ liệu chạy từ vRace, lọc hoạt động hợp lệ trong thời gian giải.
  4. Gọi API đồng bộ hồ sơ (`members`) và tổng quãng đường hợp lệ (`running`) sang Game.
- **Game R2PL phụ trách:**
  1. Quy đổi quãng đường thành Điểm (`1 km = 10 Points`, tính trên tổng mét tích lũy `floor(cumulativeMeters * 10 / 1000)` để không mất mét lẻ).
  2. Quản lý 2 số dư tách biệt cho mỗi sinh viên:
     - `earnedRunningPoints`: Tổng điểm từ chạy bộ (dùng cho BXH Chạy — **không bao giờ giảm** khi tiêu điểm trong game, **không tăng** khi nhận thưởng trong game).
     - `spendablePoints`: Số dư ví thực tế để tiêu trong game (mở ô, nuôi Shared Knowledge...).
  3. Xét điều kiện trúng Quà hiện vật (Gift) dựa trên `weeklyMeters > 0` của tuần hiện tại.

---

## 2. Danh sách Trường & Phân quyền (`user` vs `admin`)

### 2.1. Bảng 8 Trường Thi Đấu (`role = "user"`, `playable = true`)
Mã `schoolId` thống nhất trên toàn bộ API v1.1 và Database:

| Slot | Mã `schoolId` | Viết tắt (`shortName`) | Tên đầy đủ (`fullName`) | Domain email chuẩn |
| :---: | :--- | :--- | :--- | :--- |
| `0` | **`hcmut`** | `HCMUT` | Đại Học Bách Khoa_Hồ Chí Minh | `hcmut.edu.vn` |
| `1` | **`ou`** | `OU` | Đại Học Mở_Hồ Chí Minh | `ou.edu.vn` |
| `2` | **`dtu`** | `DTU` | Đại Học Duy Tân_Đà Nẵng | `dtu.edu.vn` |
| `3` | **`hpuni`** | `HPUNI` | Đại Học Hải Phòng | `hpuni.edu.vn` |
| `4` | **`hsu`** | `HSU` | Đại Học Hoa Sen_Hồ Chí Minh | `sinhvien.hoasen.edu.vn` |
| `5` | **`huce`** | `HUCE` | Đại Học Xây Dựng_Hà Nội | `st.huce.edu.vn` |
| `6` | **`ntu`** | `NTU` | Đại Học Nha Trang | `ntu.edu.vn` |
| `7` | **`hcmiu`** | `HCMIU` | Đại Học Quốc Tế | `student.hcmiu.edu.vn` |

### 2.2. Tổ chức Quản trị Đại học AMTECH (`role = "admin"`, `playable = false`)
- Mã định danh: `schoolId: "amtech"` (truyền kèm `email` đã xác thực và `emailVerified: true`).
- Điều kiện cấp quyền `admin`: Email thuộc domain công ty hoặc nằm trong danh sách email nhân sự/BTC đã được thống nhất giữa 2 bên.
- **Quyền hạn:** Tài khoản `admin` không có HQ, không có ví, không đồng bộ chạy bộ và không xuất hiện trên BXH. Khi đăng nhập qua luồng `launches`, trình duyệt tự động mở thẳng **AMTECH Live Editor** (chế độ quản trị bản đồ 3D, phát quà, thông báo).

---

## 3. Xác thực Server-to-Server (HMAC-SHA256)

Mỗi môi trường (Staging / Production) dùng chung bộ thông số cấu hình:
- `GAME_ORIGIN`: URL của server game (VD: `https://skai0o0.id.vn`)
- `CAMPAIGN_ID`: UUID của chiến dịch (VD: `99000000-0000-4000-8000-000000000001`)
- `KEY_ID`: Định danh key (VD: `partner-main`)
- `SECRET`: Chuỗi bí mật tối thiểu 32 bytes (chỉ lưu ở backend 2 bên)

### Headers bắt buộc cho mọi request `POST /api/partner/v1/*`:
```http
Content-Type: application/json
X-R2PL-Campaign: <CAMPAIGN_ID>
X-R2PL-Key-Id: <KEY_ID>
X-R2PL-Timestamp: <Unix epoch milliseconds, chuỗi 13 chữ số, lệch tối đa ±300s>
X-R2PL-Nonce: <Chuỗi ngẫu nhiên 16–128 ký tự [A-Za-z0-9_-], duy nhất cho mỗi request>
X-R2PL-Signature: <64 ký tự hex chữ thường HMAC-SHA256>
```

### Cách tạo `X-R2PL-Signature`:
Nối **7 dòng UTF-8** bằng ký tự xuống dòng `\n` (LF, không có `\n` ở cuối):
```text
r2pl-v1
<CAMPAIGN_ID>
POST
<Exact Path, ví dụ: /api/partner/v1/running>
<X-R2PL-Timestamp>
<X-R2PL-Nonce>
<sha256_hex_lowercase(raw_json_body_bytes)>
```
Sau đó tính `HMAC_SHA256(secret, canonical_string)` ra hex chữ thường.

### Code mẫu ký & gọi API (Node.js):
```js
import { R2plPartnerClient } from "./partner-client.mjs";

const game = new R2plPartnerClient({
  origin: process.env.R2PL_GAME_ORIGIN,
  campaignId: process.env.R2PL_CAMPAIGN_ID,
  keyId: process.env.R2PL_KEY_ID,
  secret: process.env.R2PL_PARTNER_SECRET,
});
```

---

## 4. Chi tiết 4 Endpoint Partner API v1.1

> **Quy ước kiểu dữ liệu:**
> - `externalStudentId`: ID ổn định bên Portal (regex: `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`, **không truyền email vào trường này**).
> - Số nguyên lớn (`revision`, `cumulativeMeters`, `weeklyMeters`, điểm trả về) đều truyền dạng **chuỗi số nguyên không dấu** (`"0"`, `"1500"`) để tránh mất chính xác JSON.

---

### 4.1. Tạo / Cập nhật / Khóa Sinh viên hoặc Admin AMTECH
**`POST /api/partner/v1/members`**

Gọi khi người dùng xác thực xong, đổi tên hiển thị, hoặc khi cần khóa quyền truy cập. Gọi lặp lại nhiều lần không làm reset ví game.

#### Trường hợp A — Sinh viên 8 trường thi đấu:
```json
{
  "externalStudentId": "stu_9001",
  "schoolId": "ou",
  "displayName": "Nguyen Van A",
  "eduVerified": true,
  "active": true
}
```
**Response `200 OK`:**
```json
{
  "externalStudentId": "stu_9001",
  "schoolId": "ou",
  "active": true,
  "role": "user",
  "playable": true
}
```

#### Trường hợp B — Quản trị viên AMTECH (Live Editor):
```json
{
  "externalStudentId": "staff_101",
  "schoolId": "amtech",
  "displayName": "Acer Test",
  "email": "acer@amtech.vn",
  "emailVerified": true,
  "active": true
}
```
*(Nếu `email` được duyệt và `emailVerified: true`, hệ thống tự động cấp quyền `admin` của AMTECH bất kể giá trị `schoolId` gửi kèm).*

**Response `200 OK`:**
```json
{
  "externalStudentId": "staff_101",
  "schoolId": null,
  "organizationId": "amtech",
  "role": "admin",
  "playable": false,
  "active": true
}
```

---

### 4.2. Đồng bộ quãng đường chạy từ vRace (Chỉ dành cho Sinh viên `role = "user"`)
**`POST /api/partner/v1/running`**

Gọi mỗi khi Portal nhận quãng đường mới từ vRace (hoặc khi sang tuần mới cần cập nhật `weeklyMeters`).
**Quan trọng:** Gửi **tổng tích lũy trong giải** (`cumulativeMeters`), KHÔNG gửi delta của lẻ từng buổi chạy, và KHÔNG gửi tổng km toàn thời gian từ trước khi giải mở trên vRace.

**Request Body:**
```json
{
  "externalStudentId": "stu_9001",
  "revision": "1",
  "cumulativeMeters": "1500",
  "weeklyMeters": "1500",
  "observedAtMs": 1792026000000,
  "weekStartMs": 1791738000000
}
```
- `revision`: Số thứ tự bản ghi của sinh viên đó, tăng dần từ `"1"`, `"2"`, `"3"`...
- `cumulativeMeters`: Tổng số mét hợp lệ tích lũy từ đầu chiến dịch đến nay.
- `weeklyMeters`: Tổng số mét hợp lệ trong tuần hiện tại (`<= cumulativeMeters`).
- `observedAtMs`: Unix ms lúc Portal chốt snapshot này (không được lệch quá ±5 phút so với giờ server).
- `weekStartMs`: Unix ms mốc **Thứ Hai 00:00:00 múi giờ `Asia/Ho_Chi_Minh` (UTC+7)** của tuần chứa `observedAtMs`.

**Response `200 OK`:**
```json
{
  "externalStudentId": "stu_9001",
  "revision": "1",
  "earnedRunningPoints": "15",
  "spendablePoints": "15",
  "delta": "15",
  "replay": false
}
```

**Cơ chế Idempotency & Xử lý sự cố:**
- **Khi lỗi mạng / timeout / `503` / `429`:** Portal giữ nguyên toàn bộ JSON payload (kể cả `revision` và `observedAtMs`), chỉ ký lại header `X-R2PL-Timestamp` + `X-R2PL-Nonce` mới rồi gửi lại. Nếu Game đã xử lý trước đó, Game trả lại đúng receipt cũ với `"replay": true`, tuyệt đối không cộng trùng điểm.
- **Khi vRace hủy/trừ km gian lận:** Portal tăng `revision` mới với `cumulativeMeters` giảm xuống.
  - Nếu ví sinh viên còn đủ điểm chưa tiêu -> Game tự trừ ví (`delta` âm).
  - Nếu sinh viên đã tiêu lẹm vào số điểm gian lận đó (ví không đủ trừ) -> Game trả `409 CORRECTION_REQUIRES_REVIEW` và giữ nguyên trạng thái để admin 2 bên xử lý.

---

### 4.3. Truy vấn số dư & trạng thái tài khoản
**`POST /api/partner/v1/accounts`**

Dùng khi Portal muốn lấy điểm chạy và số dư ví hiện tại của sinh viên để hiển thị trên trang cá nhân của web giải chạy.

**Request Body:**
```json
{
  "externalStudentId": "stu_9001"
}
```

**Response `200 OK`:**
```json
{
  "externalStudentId": "stu_9001",
  "schoolId": "ou",
  "earnedRunningPoints": "15",
  "spendablePoints": "11",
  "revision": "1",
  "cumulativeMeters": "1500",
  "weeklyMeters": "1500",
  "weekStartMs": 1791738000000
}
```

---

### 4.4. Đăng nhập SSO từ Web Giải Chạy sang Game / Live Editor (PKCE Handshake)
**`POST /api/partner/v1/launches`**

Sinh viên (hoặc Admin AMTECH) đang đăng nhập ở Portal bấm nút **"Chơi Game" / "Mở Live Editor"** sẽ vào thẳng Game không cần đăng nhập lại:

```text
[Browser] --(1) Mở <GAME_ORIGIN>/?entry=portal--> [Game Client]
[Browser] <--(2) Redirect sang PORTAL_LOGIN_URL?game_campaign=...&game_challenge=...&game_return=...
[Portal Backend] --(3) Kiểm tra session + gọi POST /api/partner/v1/launches--> [Game Backend]
[Portal Backend] <--(4) Nhận { launchUrl: "<GAME_ORIGIN>/#launch=<ticket>" }
[Browser] <--(5) Portal trả HTTP 303 Redirect sang launchUrl --> Vào thẳng Game (hoặc Live Editor nếu là AMTECH)!
```

**Request Body (`POST /api/partner/v1/launches`):**
```json
{
  "externalStudentId": "stu_9001",
  "codeChallenge": "E9Melhoa2OwvFrGMTJguXt5a2Vq9t3X8_A1b2C3d4E5"
}
```

**Response `200 OK`:**
```json
{
  "launchUrl": "https://skai0o0.id.vn/#launch=a1b2c3...64_hex_chars",
  "expiresInSeconds": 60
}
```

---

## 5. Bảng mã lỗi chuẩn & Cách xử lý chi tiết

Mọi lỗi trả về đều có định dạng chuẩn JSON: `{"error": "<CODE>", "requestId": "<UUID>"}`.
`requestId` dùng để đối soát log giữa hai hệ thống.

| HTTP Status | Mã lỗi (`error`) | Nguyên nhân kích hoạt | Cách xử lý phía Webdev Tổng |
| :---: | :--- | :--- | :--- |
| **`400`** | `INVALID_JSON` | Body gửi lên không phải JSON hợp lệ. | Kiểm tra cú pháp JSON của request body. |
| **`400`** | `INVALID_BODY` | Body chứa trường thừa hoặc thiếu các trường bắt buộc theo schema. | Đối chiếu payload với mục 4 của tài liệu này hoặc OpenAPI schema. |
| **`400`** | `INVALID_VERIFIED_MEMBER` | `displayName` rỗng/dài hơn 100 ký tự, chứa ký tự điều khiển, hoặc `eduVerified !== true`. | Kiểm tra dữ liệu sinh viên trước khi gọi `/members`. |
| **`400`** | `INVALID_SNAPSHOT_TIME_OR_DISTANCE` | `observedAtMs` lệch quá ±5 phút so với giờ máy chủ Game, hoặc `weeklyMeters > cumulativeMeters`. | Kiểm tra đồng bộ NTP giờ hệ thống; đảm bảo số mét tuần không lớn hơn tổng mét tích lũy. |
| **`400`** | `INVALID_CODE_CHALLENGE` | `codeChallenge` không đúng chuẩn regex `^[A-Za-z0-9_-]{43}$`. | Truyền nguyên vẹn `game_challenge` nhận được từ URL query của Game. |
| **`400`** | `POINTS_OVERFLOW` | Tổng mét vượt quá giới hạn tính toán an toàn của hệ thống. | Kiểm tra lại giá trị mét chạy gửi lên từ vRace. |
| **`400`** | `QUERY_NOT_SUPPORTED` | Endpoint partner bị gọi kèm query string trên URL. | Bỏ query param trên URL; truyền dữ liệu hoàn toàn qua JSON body. |
| **`401`** | `INVALID_SIGNATURE` | Chữ ký HMAC sai, sai secret, sai `keyId`, hoặc `X-R2PL-Campaign` không khớp. | Kiểm tra lại công thức ký canonical string (7 dòng LF) và cặp Key/Secret. |
| **`403`** | `ORIGIN_REJECTED` | Header `Origin` gửi lên không khớp với cấu hình `PUBLIC_ORIGIN` của game. | Server-to-server call không cần gửi header `Origin` của browser. |
| **`403`** | `MEMBER_SUSPENDED` | Tài khoản đang có trạng thái `active: false`. | Sinh viên đang bị khóa quyền; cần kích hoạt lại (`active: true`) qua `/members` nếu muốn mở lại. |
| **`403`** | `VERIFIED_ADMIN_IDENTITY_REQUIRED` | Gửi `schoolId: "amtech"` nhưng thiếu `emailVerified: true` hoặc email không hợp lệ. | Đảm bảo portal đã xác minh email nhân sự trước khi gửi flag `emailVerified: true`. |
| **`403`** | `ADMIN_CANNOT_PLAY` | Gọi `/running` hoặc `/accounts` cho tài khoản Admin AMTECH. | Admin AMTECH không có ví/chạy bộ; web tổng không đẩy dữ liệu chạy cho role admin. |
| **`404`** | `NOT_FOUND` | Sai đường dẫn endpoint hoặc method. | Kiểm tra lại URL (phải là `POST /api/partner/v1/<operation>`). |
| **`404`** | `MEMBER_NOT_FOUND` | `externalStudentId` chưa từng được tạo qua `/api/partner/v1/members`. | Bắt buộc gọi `/members` để tạo hồ sơ trước khi gọi `/running`, `/accounts` hoặc `/launches`. |
| **`405`** | `METHOD_NOT_ALLOWED` | Gọi HTTP method khác `POST` (ví dụ `GET`). | Tất cả endpoint thao tác dữ liệu đều dùng method `POST`. |
| **`409`** | `REQUEST_REPLAY` | `X-R2PL-Nonce` đã từng được ghi nhận trong cửa sổ chống phát lại. | Khi retry request, bắt buộc tạo `nonce` ngẫu nhiên mới và `timestamp` hiện tại. |
| **`409`** | `STALE_REVISION` | `revision` gửi sang nhỏ hơn hoặc bằng revision đã lưu, hoặc `observedAtMs` lùi về quá khứ. | Tăng `revision` (dạng chuỗi số nguyên tăng dần) cho mỗi lần đồng bộ mới. |
| **`409`** | `REVISION_CONFLICT` | Cùng 1 số `revision` nhưng nội dung mét chạy khác với lần gọi thành công trước đó. | Nếu muốn cập nhật số liệu mới, phải tăng số `revision` tiếp theo. |
| **`409`** | `SCHOOL_CHANGE_REQUIRES_REVIEW` | Gọi `/members` với `schoolId` khác với trường sinh viên đã được gắn ban đầu. | Hệ thống không cho phép tự ý chuyển trường thi đấu giữa chừng. |
| **`409`** | `IDENTITY_ALREADY_BOUND` | Email nhân sự AMTECH này đã gắn với một `externalStudentId` khác trước đó. | Kiểm tra và giữ nguyên mapping `externalStudentId` ổn định cho từng người dùng. |
| **`409`** | `CONVERSION_CHANGE_REQUIRES_REVIEW` | Tỷ lệ quy đổi điểm chạy bị thay đổi giữa chiến dịch. | Liên hệ đội ngũ Game để đối soát rebase điểm. |
| **`409`** | `CORRECTION_REQUIRES_REVIEW` | vRace hủy km gian lận nhưng sinh viên đã lỡ tiêu hết số điểm đó trong game (ví không đủ trừ). | Không tự retry; giữ nguyên và phối hợp BTC đối soát thủ công. |
| **`413`** | `BODY_TOO_LARGE` | JSON body vượt quá giới hạn 16.384 bytes. | Giảm dung lượng payload (các endpoint đối tác chỉ gửi object đơn lẻ). |
| **`415`** | `JSON_REQUIRED` | Thiếu hoặc sai header `Content-Type: application/json`. | Bắt buộc set header `Content-Type: application/json; charset=utf-8`. |
| **`429`** | `RATE_LIMITED` | Vượt ngưỡng 300 requests/phút/key. | Đọc header `Retry-After: 60`, tạm dừng và retry sau thời gian quy định. |
| **`503`** | `TEMPORARILY_UNAVAILABLE` | Database hoặc máy chủ Game bận/bảo trì tạm thời. | Giữ nguyên payload ban đầu, sinh `nonce` mới và retry với thuật toán exponential backoff. |
