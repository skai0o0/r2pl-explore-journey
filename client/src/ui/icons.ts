// client/src/ui/icons.ts

export type IconSize = "sm" | "md" | "lg" | number;

function parseSize(size: IconSize): { width: number; height: number } {
  if (typeof size === "number") return { width: size, height: size };
  switch (size) {
    case "sm":
      return { width: 16, height: 16 };
    case "lg":
      return { width: 24, height: 24 };
    default:
      return { width: 20, height: 20 };
  }
}

export function createSvg(
  content: string,
  size: IconSize = "md",
  className = "",
): string {
  const { width, height } = parseSize(size);
  return `<svg width="${width}" height="${height}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon ${className}">${content}</svg>`;
}

export const Icons = {
  // Điểm số / Năng lượng đổi đất
  point: (size: IconSize = "md") =>
    createSvg(
      `
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" fill-opacity="0.25"/>
  `,
      size,
      "icon-point",
    ),

  // Lãnh thổ / Ô đất (Hexagon Grid Tile)
  tile: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  `,
      size,
      "icon-tile",
    ),

  // Hành động Chiếm đất / Đổi đất (Flag Claim)
  claim: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
    <line x1="4" y1="22" x2="4" y2="15"/>
  `,
      size,
      "icon-claim",
    ),

  // Trường đại học / Học viện
  school: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
  `,
      size,
      "icon-school",
    ),

  // Công trình biểu tượng (Landmark / Monument)
  landmark: (size: IconSize = "md") =>
    createSvg(
      `
    <line x1="2" y1="22" x2="22" y2="22"/>
    <line x1="4" y1="18" x2="20" y2="18"/>
    <path d="M6 18v-7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7"/>
    <path d="M12 2l4 7H8z"/>
  `,
      size,
      "icon-landmark",
    ),

  // Khiên phòng thủ
  shield: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  `,
      size,
      "icon-shield",
    ),

  // Tấn công / Tranh chấp (Crossed Swords)
  sword: (size: IconSize = "md") =>
    createSvg(
      `
    <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
    <line x1="13" y1="19" x2="19" y2="13"/>
    <line x1="16" y1="16" x2="20" y2="20"/>
    <line x1="19" y1="21" x2="21" y2="19"/>
    <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/>
    <line x1="5" y1="14" x2="11" y2="20"/>
  `,
      size,
      "icon-sword",
    ),

  // Bản đồ & Minimap
  map: (size: IconSize = "md") =>
    createSvg(
      `
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
    <line x1="8" y1="2" x2="8" y2="18"/>
    <line x1="16" y1="6" x2="16" y2="22"/>
  `,
      size,
      "icon-map",
    ),

  // La bàn / Đặt lại camera
  compass: (size: IconSize = "md") =>
    createSvg(
      `
    <circle cx="12" cy="12" r="10"/>
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" fill-opacity="0.3"/>
  `,
      size,
      "icon-compass",
    ),

  // Xếp hạng (Leaderboard / Trophy)
  trophy: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2"/>
    <path d="M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/>
    <path d="M4 22h16"/>
    <path d="M10 14.66V17c0 .55-.45 1-1 1H8c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h8c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-1c-.55 0-1-.45-1-1v-2.34"/>
    <path d="M6 3h12v7a6 6 0 0 1-12 0V3z"/>
  `,
      size,
      "icon-trophy",
    ),

  // Phóng to / Thu nhỏ
  zoomIn: (size: IconSize = "md") =>
    createSvg(
      `
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    <line x1="11" y1="8" x2="11" y2="14"/>
    <line x1="8" y1="11" x2="14" y2="11"/>
  `,
      size,
    ),

  zoomOut: (size: IconSize = "md") =>
    createSvg(
      `
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    <line x1="8" y1="11" x2="14" y2="11"/>
  `,
      size,
    ),

  // Hồ sơ sinh viên
  user: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  `,
      size,
      "icon-user",
    ),

  // Tọa độ / Vị trí
  crosshair: (size: IconSize = "md") =>
    createSvg(
      `
    <circle cx="12" cy="12" r="10"/>
    <line x1="22" y1="12" x2="18" y2="12"/>
    <line x1="6" y1="12" x2="2" y2="12"/>
    <line x1="12" y1="6" x2="12" y2="2"/>
    <line x1="12" y1="22" x2="12" y2="18"/>
  `,
      size,
      "icon-crosshair",
    ),

  // Cài đặt / Dev tool
  settings: (size: IconSize = "md") =>
    createSvg(
      `
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  `,
      size,
    ),

  // Cảnh báo / Khóa
  lock: (size: IconSize = "md") =>
    createSvg(
      `
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  `,
      size,
      "icon-lock",
    ),

  check: (size: IconSize = "md") =>
    createSvg(
      `
    <polyline points="20 6 9 17 4 12"/>
  `,
      size,
      "icon-check",
    ),

  lightning: (size: IconSize = "md") =>
    createSvg(
      `
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/>
  `,
      size,
      "icon-lightning",
    ),

  star: (size: IconSize = "md") =>
    createSvg(
      `
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>
  `,
      size,
      "icon-star",
    ),

  close: (size: IconSize = "md") =>
    createSvg(
      `
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  `,
      size,
      "icon-close",
    ),

  target: (size: IconSize = "md") =>
    createSvg(
      `
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
    <line x1="12" y1="2" x2="12" y2="5"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="5" y2="12"/>
    <line x1="19" y1="12" x2="22" y2="12"/>
  `,
      size,
      "icon-target",
    ),

  // Ngọn lửa / Bonfire Landmark
  flame: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
  `,
      size,
      "icon-flame",
    ),

  fire: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
  `,
      size,
      "icon-flame",
    ),

  // Ôn bài / Sách tri thức (Study / Knowledge Book)
  book: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  `,
      size,
      "icon-book",
    ),

  // Chìa khóa rương (Key)
  key: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="m21 2-2 2m-1.5 1.5L14 9l-1.5-1.5L11 9l-1.5-1.5L8 9"/>
    <circle cx="7.5" cy="15.5" r="5.5"/>
    <path d="m15.5 7.5 3 3"/>
  `,
      size,
      "icon-key",
    ),

  // Hộp quà hiện vật (Gift)
  gift: (size: IconSize = "md") =>
    createSvg(
      `
    <polyline points="20 12 20 22 4 22 4 12"/>
    <rect x="2" y="7" width="20" height="5"/>
    <line x1="12" y1="22" x2="12" y2="7"/>
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
  `,
      size,
      "icon-gift",
    ),

  // Hòm Cyber / Rương (Box / Chest)
  box: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <path d="M3.27 6.96 12 12.01l8.73-5.05"/>
    <path d="M12 22.08V12"/>
  `,
      size,
      "icon-box",
    ),

  // Hiệu ứng ánh sáng / Sparkles
  sparkles: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    <path d="M5 3v4"/>
    <path d="M19 17v4"/>
    <path d="M3 5h4"/>
    <path d="M17 19h4"/>
  `,
      size,
      "icon-sparkles",
    ),

  // Tinh thể Tri thức (Crystal / Diamond)
  crystal: (size: IconSize = "md") =>
    createSvg(
      `
    <polygon points="6 3 18 3 22 9 12 22 2 9" fill="currentColor" fill-opacity="0.25"/>
    <polyline points="2 9 12 12 22 9"/>
    <line x1="12" y1="22" x2="12" y2="12"/>
    <polyline points="6 3 12 12 18 3"/>
  `,
      size,
      "icon-crystal",
    ),

  // Đèn hiệu Công trình (Beacon Light / Light Pillar)
  beacon: (size: IconSize = "md") =>
    createSvg(
      `
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    <polygon points="12 7 15 12 12 17 9 12" fill="currentColor" fill-opacity="0.6"/>
  `,
      size,
      "icon-beacon",
    ),
};

// Legacy alias compatibility
export const iconGear = (size: IconSize = 18, _color = "currentColor") =>
  Icons.settings(size);
export const iconLightning = (size: IconSize = 14, _color = "currentColor") =>
  createSvg(
    `
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
`,
    size,
  );
export const iconSword = (size: IconSize = 18, _color = "currentColor") =>
  Icons.sword(size);
export const iconShield = (size: IconSize = 18, _color = "currentColor") =>
  Icons.shield(size);
export const iconHammer = (size: IconSize = 18, _color = "currentColor") =>
  createSvg(
    `
  <path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/>
  <path d="M17.64 15 22 10.64"/>
  <path d="m20.91 3.26-6.36 6.36-2.12-2.12 6.36-6.36a1.5 1.5 0 0 1 2.12 0l1.41 1.41a1.5 1.5 0 0 1 0 2.12z"/>
`,
    size,
  );
export const iconFlag = (size: IconSize = 18, _color = "currentColor") =>
  Icons.claim(size);
export const iconMapGrid = (size: IconSize = 18, _color = "currentColor") =>
  Icons.tile(size);
export const iconTrophy = (size: IconSize = 18, _color = "currentColor") =>
  Icons.trophy(size);
export const iconCross = (size: IconSize = 18, _color = "currentColor") =>
  Icons.lock(size);
export const iconCheck = (size: IconSize = 18, _color = "currentColor") =>
  Icons.check(size);
