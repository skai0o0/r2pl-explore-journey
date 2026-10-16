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
  5. Hiển thị BXH Chạy (dùng `earnedRunningPoints` do Game trả về hoặc tự tính theo cùng công thức).
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

> **Lưu ý về mã trường:** Hệ thống đã chuẩn hóa hoàn toàn sang `ou` (thay cho `hcmcou` cũ) và `hpuni` (thay cho `dhhp` cũ) ở cả API và Database (qua migration `008`). Portal chỉ gửi 8 mã chuẩn ở cột `schoolId` bên trên.

### 2.2. Tổ chức Quản trị Đại học AMTECH (`role = "admin"`, `playable = false`)
- Mã định danh: `schoolId: "amtech"` (kèm `email` đã xác thực và `emailVerified: true`).
- Điều kiện cấp quyền `admin`: Email thuộc domain `@amtech.vn`, `@amtech-vn.com` hoặc nằm trong danh sách 12 email nhân sự được duyệt sẵn (`minhchau.nguyen@acer.com`, `acer@amtech.vn`, `test003@amtech.vn`, `test002@amtech.vn`, `test001@amtech.vn`, `predator@amtech.vn`, `leanhtuan@amtech.vn`, `predator@dava.vn`, `khang70121@gmail.com`, `dieplt.sg@gmail.com`, `vrace@amtech.vn`, `dieplt@dava.vn`).
- **Quyền hạn:** Tài khoản `admin` không có HQ, không có ví, không đồng bộ chạy bộ và không xuất hiện trên BXH. Khi đăng nhập qua luồng `launches`, trình duyệt tự động mở thẳng **AMTECH Live Editor** (chế độ xây dựng bản đồ 3D, phát quà, thông báo).

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
*(Nếu `email` nằm trong 12 email nhân sự được duyệt sẵn và `emailVerified: true`, hệ thống tự động cấp quyền `admin` của AMTECH bất kể giá trị `schoolId` gửi kèm).*

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

## 5. Bảng mã lỗi chuẩn

Mọi lỗi đều trả về JSON `{"error": "<CODE>", "requestId": "<UUID>"}`:

| HTTP | Mã lỗi (`error`) | Ý nghĩa & Cách xử lý bên Portal |
| :--- | :--- | :--- |
| `400` | `INVALID_BODY` / `INVALID_VERIFIED_MEMBER` / `INVALID_SNAPSHOT_TIME_OR_DISTANCE` / `INVALID_CODE_CHALLENGE` | Sai định dạng trường, `observedAtMs` lệch quá 5 phút, hoặc `weeklyMeters > cumulativeMeters`. Không tự retry, kiểm tra lại dữ liệu. |
| `401` | `INVALID_SIGNATURE` | Sai HMAC signature, sai `X-R2PL-Campaign`, hoặc đồng hồ server lệch quá 5 phút. |
| `403` | `MEMBER_SUSPENDED` | Tài khoản đang bị khóa (`active: false`). |
| `403` | `VERIFIED_ADMIN_IDENTITY_REQUIRED` | Truyền `schoolId: "amtech"` nhưng thiếu `emailVerified: true` hoặc email không thuộc AMTECH/danh sách duyệt. |
| `403` | `ADMIN_CANNOT_PLAY` | Gọi `running` hoặc `accounts` cho tài khoản Admin AMTECH. |
| `404` | `MEMBER_NOT_FOUND` | Chưa gọi `/api/partner/v1/members` cho `externalStudentId` này trước khi gọi `running`/`accounts`/`launches`. |
| `409` | `REQUEST_REPLAY` | Trùng `X-R2PL-Nonce` đã gửi trước đó. Khi retry bắt buộc tạo `nonce` và `timestamp` mới. |
| `409` | `STALE_REVISION` | `revision` gửi sang nhỏ hơn hoặc bằng `revision` hiện tại (hoặc `observedAtMs` lùi về quá khứ). |
| `409` | `REVISION_CONFLICT` | Cùng `revision` nhưng nội dung mét chạy khác với lần gọi thành công trước đó. |
| `409` | `CORRECTION_REQUIRES_REVIEW` | Giảm km chạy nhưng sinh viên đã tiêu hết điểm trong game (không cho phép âm ví tự động). |
| `409` | `SCHOOL_CHANGE_REQUIRES_REVIEW` | Đổi `schoolId` của sinh viên đã tồn tại. |
| `409` | `IDENTITY_ALREADY_BOUND` | Email AMTECH này đã được gắn với một `externalStudentId` khác. |
| `429` | `RATE_LIMITED` | Vượt quá 300 req/phút/key. Đợi theo header `Retry-After: 60` rồi retry. |
| `503` | `TEMPORARILY_UNAVAILABLE` | DB/Server bận tạm thời. Retry với exponential backoff (giữ nguyên payload, tạo nonce mới). |
