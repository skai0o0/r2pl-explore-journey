/** Per-Landmark puzzle copy. Story and hints never contain the answer; answers remain per-school. */
export interface LandmarkPuzzle {
  readonly story: string;
  readonly hints: readonly [string, string, string];
}
export const LANDMARK_PUZZLES: Readonly<Record<string, LandmarkPuzzle>> = {
  fansipan: {
    story:
      "Giữa vùng Tây Bắc mây phủ quanh năm, một đỉnh núi vươn cao hơn ba nghìn mét. Người leo núi mất nhiều ngày để chạm tới, còn du khách có thể đi cáp treo ngắm biển mây.",
    hints: [
      "Thuộc dãy Hoàng Liên Sơn, nằm ở tỉnh Lào Cai.",
      "Cao khoảng 3.143 m, cao nhất ba nước Việt Nam – Lào – Campuchia.",
      "Được mệnh danh là “Nóc nhà Đông Dương”.",
    ],
  },
  halong: {
    story:
      "Hàng nghìn đảo đá vôi nhô lên từ làn nước xanh ngọc ở vùng biển Đông Bắc. Truyền thuyết kể rằng rồng mẹ và rồng con đã hạ xuống đây để chặn giặc.",
    hints: [
      "Thuộc tỉnh Quảng Ninh, được UNESCO ghi danh Di sản thiên nhiên thế giới.",
      "Nổi tiếng với những chuyến du thuyền qua đêm giữa các đảo đá vôi.",
      "Tên gọi gắn với hình ảnh con rồng hạ xuống biển.",
    ],
  },
  nguhanhson: {
    story:
      "Năm ngọn núi đá cẩm thạch đứng giữa vùng đồng bằng ven biển miền Trung, bên trong ẩn chứa những hang động và ngôi chùa cổ. Làng nghề dưới chân núi nổi tiếng với tượng đá.",
    hints: [
      "Nằm gần thành phố Đà Nẵng, cách phố cổ Hội An không xa.",
      "Năm ngọn núi mang tên năm yếu tố: Kim, Mộc, Thủy, Hỏa, Thổ.",
      "Còn gọi là Non Nước, nổi tiếng nghề điêu khắc đá mỹ nghệ.",
    ],
  },
  phongnha: {
    story:
      "Một dòng sông ngầm chảy sâu trong lòng núi đá vôi, nơi thạch nhũ óng ánh hiện ra dưới ánh đèn khi thuyền trôi vào trong hang.",
    hints: [
      "Nằm trong Vườn quốc gia Phong Nha – Kẻ Bàng ở vùng Bắc Trung Bộ.",
      "Được UNESCO công nhận là Di sản thiên nhiên thế giới.",
      "Gần hang Sơn Đoòng, một trong những hang lớn nhất thế giới.",
    ],
  },
  nuibaden: {
    story:
      "Ngọn núi đứng đơn độc giữa đồng bằng Đông Nam Bộ, trên đỉnh có chùa và quần thể tâm linh. Du khách có thể đi cáp treo hoặc leo bộ trong những chuyến hành hương đầu năm.",
    hints: [
      "Cao khoảng 986 m, là ngọn núi cao nhất Nam Bộ.",
      "Thuộc tỉnh Tây Ninh.",
      "Gắn với truyền thuyết thờ Linh Sơn Thánh Mẫu, dân gian gọi là một vị “Bà”.",
    ],
  },
  thanglong: {
    story:
      "Giữa lòng thủ đô, một quần thể di tích từng là trung tâm quyền lực của nhiều triều đại suốt hơn một nghìn năm. Khu khảo cổ ở đây được UNESCO ghi danh năm 2010.",
    hints: [
      "Nằm ở quận Ba Đình, Hà Nội.",
      "Có Đoan Môn và Cột cờ Hà Nội gần đó.",
      "Là kinh đô của nhà Lý từ năm 1010, gợi hình ảnh rồng bay lên.",
    ],
  },
  canghaiphong: {
    story:
      "Cửa ngõ hàng hải lớn của miền Bắc, nơi những con tàu container từ khắp thế giới cập bến. Thành phố này còn được gọi là “thành phố hoa phượng đỏ”.",
    hints: [
      "Một trong những cảng biển lớn nhất phía Bắc Việt Nam.",
      "Nằm ở thành phố có biệt danh “thành phố hoa phượng đỏ”.",
      "Khu bến Lạch Huyện nước sâu thuộc hệ thống cảng này.",
    ],
  },
  kinhthanhhue: {
    story:
      "Bên dòng sông Hương êm đềm, những cung điện, lăng tẩm và tường thành rêu phong kể chuyện triều đại phong kiến cuối cùng của Việt Nam.",
    hints: [
      "Là kinh đô triều Nguyễn từ năm 1802 đến năm 1945.",
      "Có Ngọ Môn, điện Thái Hòa và Tử Cấm Thành.",
      "Nằm bên sông Hương, ở miền Trung.",
    ],
  },
  bitexco: {
    story:
      "Một tòa tháp thủy tinh giữa trung tâm Sài Gòn, thân tháp gợi hình búp sen đang nở và có sân đỗ trực thăng nhô ra ở lưng chừng trời.",
    hints: [
      "Cao 68 tầng, khoảng 262 m, nằm ở Quận 1, TP.HCM.",
      "Thiết kế lấy cảm hứng từ hình búp sen, quốc hoa Việt Nam.",
      "Có đài quan sát Saigon Skydeck ngắm toàn thành phố.",
    ],
  },
  cairang: {
    story:
      "Từ tờ mờ sáng, ghe xuồng đã chen nhau trên sông, chở đầy trái cây và nông sản. Người bán treo hàng lên cây sào dựng cao để khách từ xa nhìn thấy.",
    hints: [
      "Nằm ở miền Tây Nam Bộ, gần thành phố Cần Thơ.",
      "Hàng hóa được treo lên “cây bẹo” để rao bán.",
      "Họp ngay trên sông, đông nhất vào buổi sáng sớm.",
    ],
  },
};
/** First hint kept for existing callers. */
export const LANDMARK_HINTS: Record<string, string> = Object.fromEntries(
  Object.entries(LANDMARK_PUZZLES).map(([id, p]) => [id, p.hints[0]]),
);
