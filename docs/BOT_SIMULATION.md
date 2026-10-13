# Bot mô phỏng 8 trường

Script: scripts/simulate-school-bots.ts; chạy bằng npm run sim:bots.

Mỗi bot đăng nhập bằng token giả lập, gửi EXPLORE qua Colyseus WebSocket thật, nhận ACK/snapshot/delta riêng của trường. PostgreSQL commit ví, knowledge, idempotency và outbox như playable baseline. Bot không đọc database hay bản đồ đối thủ. Báo cáo quản trị tổng hợp được tạo riêng sau ACK và đối chiếu database; không phát vào client.

## Chạy bằng PowerShell

Cần Node >=22.12, npm dependencies đã cài và PostgreSQL local với database dùng một lần. Database phải có tên r2pl_bot_test_* hoặc r2pl_prep_test_*. Script tự áp dụng hai baseline migrations trong database đó; không tự tạo database.

~~~powershell
$env:R2PL_BOT_SIMULATION = '1'
$env:R2PL_BOT_DATABASE_URL = 'postgresql://prep_fixture@127.0.0.1:55439/r2pl_prep_test_current'
npm run sim:bots -- --duration=60 --preset=mixed --bots-per-school=3 --retry-every=10 --reconnect-every=20
~~~

URL trên là fixture local đã dùng để kiểm chứng trong workspace; nếu chạy máy khác hãy thay bằng database dùng một lần của máy đó. Script mở server trên cổng loopback tự chọn, tạo campaign riêng; không kết nối campaign đang chơi. Campaign tự được xóa khi kết thúc; report vẫn giữ. --keep-data=true chỉ giữ campaign synthetic của lượt chạy để điều tra.

~~~powershell
npm run sim:bots -- --help
npm run sim:bots -- --duration=120 --preset=fast --bots-per-school=5
npm run sim:bots -- --duration=60 --preset=bursty --layout=spread --region-size=64 --credits=50
npm run sim:bots -- --duration=30 --rates=0.25,0.5,0.75,1,1.5,2,3,5 --max-actions=1000
~~~

## Hành vi và tốc độ

Ba vai trò luân phiên trong mỗi trường: explorer mở rộng biên bốn hướng; connector hướng về điểm hẹn công khai; steward thỉnh thoảng quay lại ô đã biết để tạo hành vi no-change. Điểm hẹn chỉ là mục tiêu planner, không có bonus hay gameplay landmark. Bot chỉ ghi nhận ô đã nhận từ projection của trường, không coi lệnh đang chờ là thành công. Mỗi bot có một lệnh đang chờ, nhịp jitter 80–120%, retry cùng command key; reconnect nhận snapshot mới rồi thử lại lệnh đã commit.

| Alias hiển thị | mixed: hành động/giây/bot | slow | fast |
| --- | ---: | ---: | ---: |
| HCMUT | 0.25 | 0.1 | 1 |
| HCMCOU | 0.5 | 0.15 | 1.5 |
| DTU | 0.75 | 0.2 | 2 |
| DHHP | 1 | 0.25 | 2.5 |
| HSU | 1.5 | 0.3 | 3 |
| HUCE | 2 | 0.4 | 3.5 |
| NTU | 3 | 0.5 | 4 |
| HCMIU | 5 | 0.75 | 5 |

bursty dùng mixed: 5 giây đầu mỗi chu kỳ 15 giây x1.5, còn lại x0.4, trần 5 lệnh/giây/bot. --rates có đúng 8 giá trị 0.05–5 theo thứ tự trên. Tốc độ là mục tiêu, không phải cam kết throughput. Số bot/trường mặc định 3, cho phép 1–20; tổng nhịp trường xấp xỉ số bot nhân tốc độ mỗi bot.

Tên trường chỉ là alias trình bày theo Gamenote; registry lưu fixture-school-0..7. Không phê duyệt mapping production. gather (mặc định) đặt cả 8 trường trong một vùng, có 8 điểm xuất phát khác nhau và cùng điểm hẹn trung tâm; mọi cặp đều có thể overlapping. contact đặt bốn cặp trường gần tâm thế giới; spread phân tán bốn cặp, mỗi cặp có điểm hẹn riêng. Vùng planner là fixture giới hạn, chưa phải bản đồ gameplay hoàn chỉnh. HQ/footprint/địa điểm thật vẫn chờ World Design.

## Kết quả và giới hạn

Mỗi lượt tạo thư mục docs/benchmarks/bots/<timestamp-id>/ chứa map.svg, live.json cập nhật khoảng 5 giây, timeline.json và report.json. Màu pha là overlapping presence. Đọc status và tất cả integrity trước khi kết luận lượt chạy đạt. Exit code khác 0 nếu kiểm tra sai, transport thất bại hoặc bị ngắt. Sau pha hành động, script cho outbox và replica tối đa 45 giây hội tụ; relay có lease 30 giây. Tổng thời gian tiến trình gồm migrations, kết nối, pha chơi và kiểm tra cuối, có thể dài hơn --duration.

ackLatencyMs tính cả ACK retry có chủ ý. ownReplicaVisibilityMs đo từ lần gửi đầu tới knowledge xuất hiện trong replica bot, không đo GPU/browser paint. m2BytesReceived là payload binary M2, không phải tổng TCP/WebSocket bytes. Seed tái lập lựa chọn khi cùng chuỗi quan sát; timing mạng và cạnh tranh concurrent không đảm bảo bản đồ giống từng byte giữa lượt.

Kiểm tra cuối: CRC/revision của projection riêng, ACK map khớp durable mask, bảo toàn ví/ledger, một idempotency record mỗi logical action, outbox không còn pending và không thiếu mẫu visibility. Map/report là artifact quản trị synthetic, không phục vụ cho người chơi.

--credits mặc định 500 fixture-credit mỗi bot; --max-actions mặc định 10000 toàn lượt; --duration 1–600 giây. --retry-every=0 / --reconnect-every=0 tắt lỗi có chủ ý; mặc định retry mỗi 25 lệnh và không reconnect. --region-size chỉ 64/128/256. Output chỉ được nằm dưới docs/benchmarks/bots; không đi qua symlink/junction. Không hỗ trợ remote DB hay production URL.

Phạm vi hiện chạy ruleVersion 0, cost 1 fixture-credit. Giao lưu hiện là cùng tiến tới điểm hẹn và overlapping knowledge. Contest, defense, upkeep, decay, Landmark, running feed và reward UI chưa nằm trong luồng bot. --require-full-gameplay=true dừng trước mutation nếu cần các tính năng này. Không khẳng định mô phỏng đầy đủ luật cuối trong Gamenote; phải bổ sung adapter qua command server đã được duyệt khi gameplay tương ứng hoàn thiện. Không mở khóa production, M5/M6 hay protocol v1 mới.

Test bot riêng: npm run test:bots (network test cần R2PL_PREPARATION_DATABASE_URL). Regression PostgreSQL đầy đủ: đặt R2PL_TEST_DATABASE_URL vào r2pl_prep_test_* rồi npm run test:postgres.
