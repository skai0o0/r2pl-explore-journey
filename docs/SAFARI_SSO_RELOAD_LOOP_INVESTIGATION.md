# Điều tra vòng reload và đăng nhập trên Safari

- Ngày ghi nhận: 27/10/2026, múi giờ Việt Nam.
- Bản code được rà soát: `f0127435404bb0323c7871ccea332b180c576cd9`.
- Phạm vi: đọc code, kiểm tra dữ liệu production và đánh giá độc lập bằng GPT-6.1 Terra.
- Trạng thái: **chưa xác định nguyên nhân gốc trên Safari; chưa triển khai bản vá**.

## 1. Hiện tượng được báo

Người dùng marketing gặp lỗi trên Safari của MacBook Air M1. Phiên bản hệ điều hành được người báo mô tả là macOS 27; chưa thu thập phiên bản Safari hoặc số build để xác minh.

Game tải lại liên tục, có chuyển qua web giải chạy rồi quay lại game, không hiện thông báo lỗi. Theo người báo, khi xảy ra lỗi không có thiết bị hay tab khác đang chơi cùng tài khoản. Sự cố xảy ra trên production đang phục vụ người chơi.

Việc chuyển qua web giải khiến nhánh xác thực/SSO cần được ưu tiên điều tra. Tuy nhiên, sự cố đồ họa khởi đầu bằng reload rồi kéo theo SSO vẫn chưa được loại trừ.

## 2. Những gì đã và chưa xác nhận

### Đã xác nhận từ code

- Có ba nhánh chủ động gọi `location.reload()` khi gặp lỗi phiên.
- Bootstrap bị từ chối sẽ tự chuyển sang web giải để đăng nhập.
- Chưa có cơ chế giới hạn toàn bộ chuỗi tự phục hồi qua reload và chuyển hướng SSO.
- WebSocket có khối bắt lỗi chung cho xác thực và xử lý lệnh; một lỗi xử lý lệnh bị reject có thể bị gắn nhãn hết phiên.
- Hai nhánh xử lý HTTP 401 chạy trước kiểm tra phản hồi còn thuộc lần kết nối/hồ sơ hiện tại.

### Kiểm tra production chỉ đọc

Tài khoản được báo vẫn có `active=true`, `access_enabled=true`, `test_profiles=true`. Cấu hình sinh viên chuyển đổi cũ đang không hoạt động. Tại thời điểm kiểm tra không có phiên quản trị còn hiệu lực.

Đây là ảnh chụp trạng thái tại thời điểm kiểm tra, không chứng minh cookie bị Safari chặn hoặc phiên bị thu hồi đúng lúc sự cố xảy ra. Phần log Nginx đã kiểm tra chưa cung cấp chuỗi request Safari tương ứng để nối từng lần reload với lỗi 401.

### Chưa xác nhận

- Chưa tái hiện trên chính Safari/Mac gặp lỗi.
- Chưa có log mạng cho chuỗi `Set-Cookie → bootstrap → ws-ticket → WebSocket` của lần xảy ra lỗi.
- Chưa xác định request nào thất bại đầu tiên, mã đóng WebSocket thực tế hoặc có mất WebGL context hay không.
- Không có bằng chứng đủ để quy lỗi cho Safari/macOS 27, cookie, GPU hoặc dùng đồng thời tài khoản.

## 3. Code nghi vấn

### 3.1. Profile trả 401 làm tải lại trang ngay

Nguồn: [client/src/main.ts:549](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/client/src/main.ts#L549).

```ts
if (response.status === 401 && !session.fixtureOnly) {
  sessionStorage.removeItem("r2pl-portal-session");
  location.reload();
  return;
}
```

Kiểm tra `generation`, `profileRequest` và token hiện tại nằm phía sau nhánh này. Vì thế, phản hồi 401 cũ vẫn có thể làm reload dù người dùng vừa đổi hồ sơ hoặc lần kết nối đã thay đổi.

### 3.2. Không lấy được vé WebSocket cũng làm reload

Nguồn: [client/src/main.ts:1295](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/client/src/main.ts#L1295).

`/api/portal/ws-ticket` trả 401 sẽ gọi `location.reload()`. Nhánh này cũng chưa kiểm tra `attempt === generation` trước khi quyết định reload.

### 3.3. WebSocket đóng 4001 dẫn tới reload

Nguồn: [client/src/main.ts:1313](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/client/src/main.ts#L1313).

Khi đóng với mã 4001, client xóa trạng thái phiên cũ và tải lại. Nhánh `onLeave` này đã có kiểm tra generation; vấn đề chính là ý nghĩa mã 4001 ở phía server và việc tự phục hồi chưa có giới hạn chung.

### 3.4. Bootstrap bị từ chối tự kích hoạt SSO

Nguồn: [client/src/portalSession.ts:199](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/client/src/portalSession.ts#L199).

```ts
if (bootstrap.status === 401 || bootstrap.status === 403) {
  await login();
  return new Promise<never>(() => {});
}
```

Nếu phiên sau handoff vẫn không được chấp nhận, đây là đường có thể khiến người chơi quay lại web giải nhiều lần. Riêng lỗi 401/403 tại bước đổi launch ticket đã có màn hình yêu cầu đăng nhập lại; không nên quy mọi lỗi handoff thành cùng một nhánh tự động.

Chuỗi khả dĩ:

```text
Phiên bị từ chối / WebSocket đóng 4001
  → game reload
  → bootstrap 401 hoặc 403
  → tự chuyển sang web giải
  → nhận handoff và quay lại game
  → nếu phiên tiếp tục bị từ chối: lặp lại
```

Đây là cơ chế có thể xảy ra theo code, chưa phải bản ghi tái hiện ca Safari được báo.

### 3.5. Bắt lỗi xác thực và xử lý lệnh trong cùng một khối

Nguồn: [server/realtime/GatewayRoom.ts:45](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/server/realtime/GatewayRoom.ts#L45).

```ts
void Promise.resolve(auth.validate!(client.auth as SyntheticIdentity))
  .then(() => core.handle(client.sessionId, bytes))
  .catch(() => client.leave(4001, "Session expired"));
```

Khối `catch` nhận cả lỗi kiểm tra phiên lẫn lỗi được truyền ra từ `core.handle`. Không phải mọi lệnh bị từ chối đều đi qua nhánh này, nhưng nếu Promise xử lý lệnh reject, client sẽ nhận nhãn hết phiên. Kiểm tra phiên định kỳ cũng gắn nhãn hết phiên cho mọi lỗi truy vấn, kể cả lỗi cơ sở dữ liệu tạm thời.

### 3.6. Những yếu tố liên quan cần phân biệt

- [PortalCookies.ts:23](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/server/integration/PortalCookies.ts#L23): cookie production dùng `__Host-r2pl_game`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Các cờ này tự chúng không chứng minh có lỗi; cần xác nhận game có được mở ở trang cấp cao nhất, đúng origin và trong cùng tab hay không.
- [PartnerTestProfiles.ts:97](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/server/integration/PartnerTestProfiles.ts#L97): đăng nhập/bind hồ sơ test mới thu hồi các phiên chơi cũ của cùng chủ tài khoản. Điều này có thể kết hợp với tự đăng nhập lại để tạo xung đột nhiều thiết bị, nhưng người báo đã phủ nhận việc sử dụng đồng thời nên đây không phải kết luận cho ca hiện tại.
- [gameConfig.ts:373](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/shared/gameplay/gameConfig.ts#L373): phiên dài một giờ; kiểm tra phiên WebSocket và làm mới profile mỗi 5 giây. Cơ chế mới phải xử lý được việc hết phiên bình thường.

## 4. Hướng sửa đề xuất

### Ưu tiên 1: giới hạn và gom luồng tự phục hồi

1. Dùng chung một bộ điều phối phục hồi cho lỗi profile, lấy vé WebSocket và đóng kết nối vì phiên không hợp lệ.
2. Kiểm tra generation/request/token còn hiện hành trước mọi tác động từ lỗi xác thực. Bỏ qua phản hồi cũ sau khi đổi hồ sơ hoặc đổi lần kết nối.
3. Chỉ cho một tiến trình phục hồi chạy tại một thời điểm, kể cả khi nhiều request cùng báo lỗi.
4. Giới hạn số lượt tự chuyển SSO trong một chuỗi phục hồi, lưu trạng thái qua reload và chuyển hướng cùng tab. Ví dụ một lượt tự phục hồi rồi dừng; con số và thời gian chờ cần chốt khi triển khai.
5. Khi chạm giới hạn, hiện màn hình ổn định với lý do, mã chẩn đoán và nút thử lại do người dùng chủ động bấm.
6. Chỉ đặt lại bộ đếm sau khi phiên thực sự ổn định. Không reset ngay lúc exchange hoặc bootstrap thành công nếu sau đó WebSocket có thể tiếp tục thất bại.
7. Bao lỗi đọc/ghi storage. Nếu không giữ được bộ đếm, dừng an toàn và hiện thông báo thay vì mặc định cho phép tự redirect vô hạn. Không lưu token hoặc launch ticket vào bộ đếm.

Đây là biện pháp chặn vòng lặp và cải thiện chẩn đoán, không tự khắc phục nguyên nhân cookie hay SSO.

### Ưu tiên 2: phân loại lỗi server đúng nguyên nhân

- Tách lỗi phiên không tồn tại/hết hạn/đã thu hồi khỏi lỗi tạm thời khi kiểm tra phiên.
- Tách khối bắt lỗi `auth.validate` khỏi xử lý lỗi `core.handle`; lỗi xử lý lệnh không được mặc định thành mã hết phiên.
- Với lỗi tạm thời, thử lại có khoảng chờ tăng dần và giới hạn số lần; tránh tạo thêm tải lúc cơ sở dữ liệu gặp sự cố.
- **Không xử lý lệnh thay đổi game khi chưa xác thực thành công.** Thử lại không được biến thành cơ chế bỏ qua phân quyền.
- Phân biệt 401 với 403 theo mã lỗi và ngữ cảnh; thiếu quyền hoặc lỗi CSRF không phải lúc nào cũng được chữa bằng đăng nhập lại.

### Ưu tiên 3: bổ sung dấu vết vừa đủ

Ghi lại giai đoạn thất bại, HTTP status, mã đóng WebSocket, request ID, số lượt phục hồi và thời điểm. Chỉ ghi khi có lỗi/thay đổi trạng thái, không tạo luồng ghi log liên tục theo từng khung hình.

Không ghi cookie, mật khẩu, token, verifier, launch ticket hoặc nguyên URL có thể chứa thông tin đăng nhập. Log client cũng không được dùng làm bằng chứng để cấp quyền phía server.

## 5. Trường hợp hướng này xử lý được và giới hạn

- Phiên liên tục bị từ chối: chặn việc chuyển qua lại vô hạn và hiện điểm thất bại. Chưa tự làm phiên đó hợp lệ.
- Nhiều tín hiệu 401/4001 cùng xuất hiện: gom thành một lần phục hồi.
- Phản hồi cũ sau đổi hồ sơ: loại bỏ quyết định reload dựa trên trạng thái đã lỗi thời.
- Lỗi truy vấn tạm thời hoặc lỗi xử lý lệnh: giảm trường hợp bị báo nhầm là hết phiên nếu triển khai phân loại lỗi đúng.
- Cookie thực sự không được lưu/gửi, web giải mở sai ngữ cảnh, sai cấu hình quyền: vẫn cần sửa nguyên nhân tương ứng.
- Safari/WebGL thực sự crash hoặc tiến trình trình duyệt bị đóng: giới hạn SSO không sửa được sự cố đồ họa ban đầu.

## 6. Nguy cơ phát sinh lỗi mới

- Đặt lại bộ đếm quá sớm làm vòng lặp tồn tại; đặt lại quá muộn có thể chặn một lần hết phiên bình thường sau một giờ.
- Nhiều bộ đếm độc lập có thể tạo redirect trùng; cookie dùng chung giữa các tab trong khi verifier và guard riêng từng tab làm việc phối hợp khó hơn.
- Portal mở tab mới hoặc storage không khả dụng có thể làm mất bộ đếm và verifier. Cần thông báo rõ, không bỏ kiểm tra PKCE để ép đăng nhập thành công.
- Retry không giới hạn làm tăng tải khi server gặp lỗi. Phân loại sai lỗi tạm thời thành hợp lệ có thể tạo lỗ hổng bảo mật.
- Màn hình dừng không có nút thử lại hoặc không giải phóng trạng thái phục hồi có thể khóa người chơi dù dịch vụ đã hoạt động lại.

Không gán phần trăm xảy ra cho các rủi ro trên vì chưa có số liệu thực nghiệm Safari.

## 7. Các ca kiểm thử cần có trước khi triển khai

1. Hết phiên thông thường, tự phục hồi thành công một lần và tiếp tục chơi.
2. Exchange thành công nhưng bootstrap hoặc WebSocket tiếp tục từ chối: dừng đúng giới hạn.
3. Profile 401, ws-ticket 401 và đóng kết nối cùng xuất hiện: chỉ có một lượt phục hồi.
4. Phản hồi 401 của hồ sơ cũ về sau khi đổi trường/hồ sơ: không gây reload phiên mới.
5. Lỗi quyền/CSRF: hiện đúng lý do, không tự đăng nhập vòng lặp.
6. Cơ sở dữ liệu lỗi tạm thời rồi phục hồi: không thực thi lệnh trong lúc chưa xác thực; không báo nhầm mọi lỗi là hết phiên.
7. `core.handle` reject: không bị chuyển thành mã hết phiên chỉ vì dùng chung `catch`.
8. Mất mạng, tab ẩn rồi mở lại, kết nối lại và đổi cookie: không tạo nhiều chuỗi redirect.
9. Storage bị chặn/lỗi hoặc portal mở tab mới: dừng an toàn, giữ kiểm tra PKCE.
10. Kiểm tra trên Safari của máy gặp lỗi, ghi chuỗi request và mã đóng kết nối để xác định tác nhân ban đầu.
11. Đối chiếu Chrome và luồng tài khoản sinh viên thường, tài khoản test, dashboard để tránh hồi quy.

## 8. Nhánh đồ họa cần theo dõi riêng

[worldView.ts:421](https://github.com/skai0o0/r2pl-explore-journey/blob/f0127435404bb0323c7871ccea332b180c576cd9/client/src/worldView.ts#L421) dùng antialias, tỷ lệ pixel tối đa 2 và bóng đổ 2048. Nước có thể kích hoạt vẽ cảnh khoảng 20 lần/giây khi sông nằm trong khung nhìn. Chưa có cơ chế chẩn đoán/phục hồi mất WebGL context riêng của ứng dụng.

Đây là các yếu tố tải GPU cần đo nếu xác nhận Safari bị mất context hoặc khởi động lại tiến trình. Chưa có bằng chứng chúng là tác nhân của vòng SSO hiện tại; không nên quy kết hoặc thay đổi chất lượng đồ họa production chỉ từ giả thuyết này.

## 9. Tài liệu tham khảo và cách triển khai

- [WebKit: Tracking Prevention](https://webkit.org/tracking-prevention/) giải thích chính sách cookie trong các ngữ cảnh website khác nhau. Đây là căn cứ để kiểm tra ngữ cảnh mở game, không phải bằng chứng cookie của ca hiện tại bị chặn.
- [WebKit bug 289601](https://bugs.webkit.org/show_bug.cgi?id=289601) có báo cáo WebGL mất context/crash trên một số thiết bị Apple và phiên bản cũ. Không suy rộng báo cáo đó thành lỗi đã xác nhận trên cấu hình của người dùng này.

Production đang phục vụ chiến dịch. Đề xuất triển khai bản vá nhỏ trên môi trường giả lập/staging trước, bổ sung kiểm thử ở mục 7, rồi xác nhận trên Safari thật. Việc ghi nhận tài liệu này không thay đổi hành vi đăng nhập, quyền tài khoản hay cấu hình production.
