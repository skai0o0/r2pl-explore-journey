# R2PL Game V2 — Hành trình Khám phá (Explore Journey)

> **Trạng thái:** Ký duyệt chính thức **`ruleVersion = 1`** ([`docs/GAME_SPEC.md`](docs/GAME_SPEC.md)). Đạt chuẩn **G-V1 Parity** với 18/18 hành trình người chơi & vận hành (PV01–PV18 FULL).

Dự án game khám phá bản đồ 1.000 × 1.000 ô cho giải chạy **Road to Predator League 2027**, phục vụ sinh viên 8 trường đại học lớn tại Việt Nam: **HCMUT, HCMCOU, DTU, DHHP, HSU, HUCE, NTU, HCMIU**.

---

## 1. Hướng dẫn Chạy Dev Server & Trải nghiệm

Dùng chế độ A để chỉnh UI/đồ họa, chế độ B để chơi gameplay đầy đủ. Portal giả lập ở chế độ C chỉ bật khi cần kiểm thử tích hợp đăng nhập và điểm chạy.

### Chế độ A: Dev Server (Hot-reload UI, Shader & Đồ họa 3D không cần PostgreSQL)
Dùng khi cần phát triển, tinh chỉnh giao diện, camera Three.js, shader viền ô, ánh sáng, hiệu ứng đổi màu tile và Colyseus WebSocket in-memory cực nhanh:

1. **Khởi chạy Backend dev server (Colyseus WebSocket 2568 + HTTP API 4176):**
   ```bash
   npm run dev:server
   ```
2. **Khởi chạy Vite Frontend dev server (cổng 5173, tự động proxy `/api` sang 4176):**
   ```bash
   npm run dev
   ```

* 🌐 **Truy cập:** [**`http://localhost:5173/`**](http://localhost:5173/)
* ⚡ **Tính năng:** Đầy đủ 8 trường đại học, 16 tài khoản test sinh viên, 10 Landmark, 15 UniStop, 15 Rương, Colyseus WebSocket thời gian thực mà không cần cài đặt hoặc kết nối PostgreSQL.

---

### Chế độ B: Full-stack Playable Server (G-V1 Đầy đủ với 8 Trường + Bot + PostgreSQL)
Dùng để trải nghiệm trọn vẹn vòng lặp gameplay: kết nối WebSocket Colyseus thời gian thực, lưu trữ dữ liệu bền vững vào PostgreSQL, 24 bot tự động khám phá và 16 tài khoản sinh viên.

#### Chạy nhanh với PowerShell (Local Fixture)
```powershell
# Lần đầu, nếu chưa có .env:
Copy-Item .env.example .env
# Sửa .env để trỏ tới PostgreSQL test đang chạy trên máy.
npm run play:school
```

**Luồng mặc định: màn hình tải → vào game bằng tài khoản local, không qua màn hình đăng nhập Portal.** `play:schools` vẫn là lệnh tương đương. Launcher đọc `.env`, không đọc `.env.portal` và không khởi động Portal giả lập.

* 🌐 **Web Client:** Mở URL `Eight-school playable fixture` được in ra trong terminal; mặc định [**`http://127.0.0.1:4176/`**](http://127.0.0.1:4176/).
* 🔌 **Colyseus WebSocket:** Cổng `2568`
* 🛠️ **Admin Map Editor:** Bấm nút **Admin Map Editor** ở góc trái, nhập mật khẩu mặc định local: `dev-map-admin`

Nếu server cũ còn chạy, dừng bằng **Ctrl+C** rồi chạy lại để nhận thay đổi. Xem cách thiết lập database test và biến môi trường tại [`README_PLAY.md`](README_PLAY.md).

### Kiểm thử client qua Cloudflare trên Demo

Admin AMTECH đăng nhập tại `https://portal.skai0o0.id.vn/`, bấm **Mở Live Editor** để đi qua `https://play.skai0o0.id.vn/?entry=admin` và nhận phiên Editor của campaign Demo. Người chơi ẩn danh vẫn vào Demo trực tiếp. Cầu nối admin dùng bộ biến `DEMO_ADMIN_*` riêng trên hai service Portal/Demo; không dùng credentials hay campaign Production. Quyền do server xác thực, không lấy từ query URL. Khi chưa bật cầu nối, đường `entry=admin` dừng ở thông báo kết nối thay vì cho vào giao diện người chơi.

Chạy từ máy người kiểm thử, không SSH vào server để chạy. Dừng bot trong game trước: bộ bot nội bộ và bộ client này dùng chung tài khoản synthetic.

```powershell
# Thử nhỏ trước, sau đó 200 phiên HTTPS/WSS qua domain công khai
npm run simulate:public -- --count=20 --duration=30 --ramp=10 --assets=none
npm run simulate:public -- --count=200 --duration=60 --ramp=60 --assets=none
```

Mỗi client có phiên HTTP/2 và WebSocket riêng; tự mở ô, nhận bản đồ và gọi API định kỳ; tự đóng khi hết thời gian hoặc Ctrl+C. Sau giai đoạn khởi tạo, các client bắt đầu chơi cùng nhau. Chỉ nhận domain `https://play.skai0o0.id.vn`, kiểm tra campaign synthetic và không dùng database/secret Production. Nút bot trong game vẫn điều khiển bot chạy nội bộ server; các client bên ngoài không hiện trong bộ đếm đó.

Kết quả JSON ở `artifacts/public-clients/`: số client kết nối thành công, lỗi/mã ngắt, ACK p50/p95/p99, thời gian nhận trạng thái ô, byte M2 và lưu lượng HTTP. `--assets=shell` tải thêm HTML và entry JS/CSS cho từng client; cả hai chế độ chưa mô phỏng tải model 3D, cache trình duyệt, FPS hoặc người dùng từ nhiều mạng khác nhau. Byte M2 không gồm overhead mạng; HTTP ghi riêng body trước/sau giải nén, không gồm header và TLS/TCP. Kết quả là tải thực tế của tuyến đang thử, không phải giới hạn tổng của Cloudflare. Các ô đã mở trên Demo được giữ lại sau lượt thử.

### Chế độ C: Portal giả lập — chỉ bật khi cần kiểm thử tích hợp

Dùng để tự tạo tài khoản sinh viên, thêm hoạt động chạy giả lập, đồng bộ Điểm và kiểm tra nút **Chơi game**. Chuẩn bị `.env.portal`, database test và khóa tích hợp theo [hướng dẫn sandbox](README_PLAY.md#chạy-sandbox-để-webdev-thử-ngay).

```powershell
# Terminal 1: server game tích hợp Portal
npm run migrate:portal
npm run build:all
npm run start:portal

# Terminal 2: Portal giả lập
npm run demo:portal
```

Mở URL do Portal in ra (theo cấu hình mẫu: `http://127.0.0.1:4188/login`; game ở `4186`). Campaign và số dư Portal tách riêng với phiên chơi local ở `4176`.

Khi liên kết web giải chạy thật, sinh viên đăng nhập trên web tổng rồi bấm **Chơi game** mở `<PUBLIC_ORIGIN>/?entry=portal`. Game tự thực hiện handoff để nhận danh tính, hiện màn hình tải và vào game, không yêu cầu bấm đăng nhập thêm. Nút **Về giải chạy** kết thúc phiên game và trở về Portal. Hợp đồng API/handoff nằm trong [`README_PLAY.md`](README_PLAY.md#đăng-nhập-từ-landing-page-sang-game).

---

## 2. Hướng dẫn Thao tác & Phím tắt trong Game

| Phím / Thao tác | Chức năng |
| :--- | :--- |
| **Chuột trái (Kéo)** | Lia bản đồ (Pan map). |
| **Cuộn chuột (Scroll)** | Thu phóng camera (Zoom in / Zoom out). |
| **Click ô đất (4-cạnh)** | Chọn ô để khám phá (**1 Point** nếu ô mới; **2 Points** nếu giao lưu ô trường đối thủ; **0 Point** nếu ô đã sở hữu). |
| **`H`** | Di chuyển camera về ngay **Trụ sở chính (HQ)** của trường bạn. |
| **`L`** | Di chuyển camera đến **Danh thắng / Landmark** gần nhất. |
| **`O`** | Thu phóng xem toàn cảnh bản đồ thế giới (Overview). |
| **`I`** | Chuyển đổi giữa góc nhìn **Isometric nghiêng 3D** và góc nhìn **Top-down từ trên xuống**. |
| **Minimap (góc dưới trái)** | Click vào minimap để dịch chuyển góc nhìn tức thì tới tọa độ đó. |

---

## 3. Các Cải tiến Đồ họa & Shader Mới nhất

1. **Hệ thống Chiếu sáng & Đổ bóng Mềm (Real-time Shadows):**
   * Kích hoạt `PCFSoftShadowMap` với shadow map 2048×2048.
   * Ánh sáng mặt trời (`DirectionalLight` 2.4) chiếu từ phía sau camera, đổ bóng công trình nghiêng về phía người chơi trong góc nhìn Isometric.
   * Frustum bóng tự động co giãn và di chuyển bám sát tầm nhìn camera, giữ cho bóng luôn sắc nét ở mọi mức zoom.
   * Mặt phẳng `ShadowMaterial` trong suốt đón bóng trực tiếp trên nền địa hình mà không làm biến đổi màu sương mù.
2. **Shader Viền Lãnh thổ & Sương mù Khám phá ([`tileFx.ts`](client/src/tileFx.ts)):**
   * **Đường viền lãnh thổ (Breathing Border):** Viền sáng nổi bật tự động nhận diện mép lãnh thổ trường, có nhịp thở nhẹ.
   * **Rãnh phân cách ô:** Hiệu ứng bevel mỏng giữa các ô đất giúp nhận diện rõ ranh giới từng ô.
   * **Frontier Glow:** Các ô sương mù tiếp giáp trực tiếp với lãnh thổ trường phát ra ánh sáng dịu cùng màu nhận diện, báo hiệu cho người chơi biết ô có thể mở tiếp theo.
   * **Hoạt ảnh Sóng Khám phá (Wave Ripple & Flash):** Khi một ô được mở thành công, ô sẽ chớp sáng và phát ra vòng sóng lan tỏa rộng 6 ô trong 1,4 giây; khi mất ô phát ra sóng cảnh báo màu cam đỏ.
   * **Hoa văn Giao lưu (Shared Knowledge):** Thay thế caro 1 ô bằng các đường sọc chéo 3 ô đan xen màu của 2 trường, dễ nhìn và không gây rối mắt.

---

## 4. Các Lệnh Kiểm thử & Xây dựng (Scripts)

```bash
# Kiểm tra kiểu dữ liệu tĩnh (TypeScript strict)
npm run typecheck

# Kiểm tra quy chuẩn mã nguồn (Biome linter)
npm run lint

# Chạy toàn bộ test suite (100+ tests)
npm test

# Build client production vào thư mục dist/client
npm run build:client

# Typecheck và build game (không build Portal giả lập)
npm run build

# Chỉ build giao diện Portal giả lập / build cả game và Portal
npm run build:portal
npm run build:all

# Kiểm tra kích thước bundle
npm run report:size
```

---

## 5. Tài liệu Tham khảo Liên quan

* [`README_PLAY.md`](README_PLAY.md) — Sổ tay vận hành G-V1 đầy đủ, hướng dẫn tích hợp Campaign API, GLB Auto-loader và nghiệm thu 500-client load test.
* [`docs/GAME_SPEC.md`](docs/GAME_SPEC.md) — Đặc tả luật game chính thức đã ký duyệt (`ruleVersion = 1`).
* [`shared/gameplay/gameConfig.ts`](shared/gameplay/gameConfig.ts) — Bảng cấu hình tập trung toàn bộ tham số gameplay (costs, timers, probabilities, footprints, coordinates).
* [`docs/COMPLETION_PROGRESS.md`](docs/COMPLETION_PROGRESS.md) — Tiến độ chi tiết 18 hành trình (PV01–PV18) và checklist G-V1.
