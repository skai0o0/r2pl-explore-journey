// client/src/ui/notifications.ts
/**
 * In-Game Notification Templates & Formatting Utilities
 * Ported from V1 with full Predator HUD styling and click-to-locate support.
 */
import {
  NotificationBanner,
  type NotificationBannerOptions,
} from "./notificationBanner.ts";

export type NotificationCategory =
  | "territory"
  | "landmark"
  | "gacha"
  | "rank"
  | "chest"
  | "ranking";

export interface NotificationSassyExample {
  title: string;
  body: string;
}

export interface NotificationTemplate {
  id: string;
  category: NotificationCategory;
  target: string;
  titleTemplate: string;
  bodyTemplate: string;
  icon?: string;
  sassyExamples?: NotificationSassyExample[];
}

export const DEFAULT_NOTIFICATIONS: NotificationTemplate[] = [
  // --- Territory Category ---
  {
    id: "terr_urgent_expire",
    category: "territory",
    target: "school_online",
    titleTemplate: "Ô tri thức sắp hết hạn!",
    bodyTemplate:
      "Ô tri thức tại ({x}, {z}) sắp hết hạn trong {time_left}! Ôn bài ngay để bảo vệ lãnh thổ.",
    icon: "clock",
    sassyExamples: [
      {
        title: "Kiến thức sắp bốc hơi! ⏰",
        body: "Chỉ còn {time_left} nữa là ô ({x}, {z}) bay màu, đừng để công sức cày cuốc trôi sông!",
      },
    ],
  },
  {
    id: "terr_shared_start",
    category: "territory",
    target: "all",
    titleTemplate: "Ô Tri Thức Chung xuất hiện!",
    bodyTemplate: "{enemy_school} mở Ô Tri Thức Chung tại ({x}, {z})!",
    icon: "swords",
  },
  {
    id: "terr_lost",
    category: "territory",
    target: "school",
    titleTemplate: "Lãnh thổ bị chiếm đóng!",
    bodyTemplate: "Mất ô ({x}, {z}) vào tay {enemy_school}!",
    icon: "shield-broken",
  },
  {
    id: "terr_saved",
    category: "territory",
    target: "school",
    titleTemplate: "Giải cứu lãnh thổ thành công!",
    bodyTemplate: "{student_name} vừa ôn bài giải cứu ô ({x}, {z}) kịp thời!",
    icon: "shield-check",
  },
  {
    id: "terr_captured",
    category: "territory",
    target: "all",
    titleTemplate: "Ô Tri Thức mới được khai phá!",
    bodyTemplate:
      "{student_name} ({my_school}) vừa khai phá ô tri thức tại ({x}, {z})!",
    icon: "target",
  },

  // --- Landmark Category ---
  {
    id: "lm_overtake_warn",
    category: "landmark",
    target: "school",
    titleTemplate: "Báo động: Nguy cơ mất Đèn hiệu!",
    bodyTemplate: "{landmark_name} sắp bị {enemy_school} cướp đèn hiệu!",
    icon: "flame",
  },
  {
    id: "lm_lit_success",
    category: "landmark",
    target: "all",
    titleTemplate: "Thắp sáng Đèn hiệu thành công!",
    bodyTemplate:
      "{landmark_name} đã được thắp sáng thành công bởi {my_school}!",
    icon: "award",
  },
  {
    id: "lm_usurped",
    category: "landmark",
    target: "school",
    titleTemplate: "Mất Đèn hiệu!",
    bodyTemplate: "Mất Đèn hiệu {landmark_name} vào tay {enemy_school}!",
    icon: "zap-off",
  },
  // --- Gacha & Reward Category ---
  {
    id: "gacha_ready",
    category: "gacha",
    target: "personal",
    titleTemplate: "Trạm tiếp tế đã hồi!",
    bodyTemplate:
      "Trạm tiếp tế {chest_tier} ({x}, {z}) đã hồi lượt quay miễn phí!",
    icon: "gift",
  },
  {
    id: "unistop_captured",
    category: "gacha",
    target: "school",
    titleTemplate: "Chiếm trạm tiếp tế thành công!",
    bodyTemplate:
      "{my_school} đã nối tri thức chạm Trạm {chest_tier} ({x}, {z})!",
    icon: "sparkles",
  },
  {
    id: "real_gift_viral",
    category: "gacha",
    target: "all",
    titleTemplate: "TRÚNG QUÀ HIỆN VẬT PREDATOR!",
    bodyTemplate: "{student_name} vừa ẵm trọn {gift_name}! Mã: {gift_code}",
    icon: "gift",
  },
  {
    id: "map_found",
    category: "gacha",
    target: "personal",
    titleTemplate: "Tìm thấy Bản đồ kho báu! 🗺️",
    bodyTemplate:
      "Bản đồ chỉ lối tới rương {chest_tier} tại tọa độ ({x}, {z})!",
    icon: "map",
  },
  {
    id: "key_found",
    category: "gacha",
    target: "personal",
    titleTemplate: "Nhặt được Chìa khóa! 🗝️",
    bodyTemplate: "Chìa khóa {chest_tier} đã vào túi của bạn!",
    icon: "key",
  },
  {
    id: "chest_opened_big",
    category: "chest",
    target: "all",
    titleTemplate: "Mở rương báu thành công!",
    bodyTemplate: "Đã mở rương {chest_tier} tại ({x}, {z}) nhận {reward_text}!",
    icon: "sparkles",
  },

  // --- Rank Category ---
  {
    id: "rank_up",
    category: "rank",
    target: "school",
    titleTemplate: "Thăng hạng bảng xếp hạng!",
    bodyTemplate: "{my_school} leo lên Top {rank}!",
    icon: "trending-up",
  },
  {
    id: "rank_down",
    category: "rank",
    target: "school",
    titleTemplate: "Cảnh báo tụt hạng!",
    bodyTemplate: "{enemy_school} đẩy {my_school} xuống Top {rank}!",
    icon: "trending-down",
  },
  {
    id: "running_points",
    category: "rank",
    target: "personal",
    titleTemplate: "Điểm chạy bộ đã về ví!",
    bodyTemplate: "+{added_points} Điểm từ {km} km chạy bộ đã được cộng!",
    icon: "zap",
  },
];

export function formatNotificationText(
  templateText: string,
  vars: Record<string, any>,
): string {
  if (!templateText) return "";
  let result = templateText;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(
      `{${key}}`,
      val !== undefined && val !== null ? String(val) : "",
    );
  }
  return result;
}

export function getNotificationTemplate(
  id: string,
): NotificationTemplate | undefined {
  return DEFAULT_NOTIFICATIONS.find((t) => t.id === id);
}

export function notifyGameEvent(
  templateId: string,
  vars: Record<string, any> = {},
  onClick?: (() => void) | undefined,
): HTMLElement | undefined {
  const tpl = getNotificationTemplate(templateId);
  if (!tpl) return undefined;
  const title = formatNotificationText(tpl.titleTemplate, vars);
  const body = formatNotificationText(tpl.bodyTemplate, vars);
  return NotificationBanner.show({
    title,
    body,
    ...(tpl.icon ? { icon: tpl.icon } : {}),
    category: tpl.category,
    durationMs: 6500,
    ...(onClick ? { onClick } : {}),
  });
}

export function notifyActionError(
  message: string,
  reason?: string | undefined,
  onClick?: (() => void) | undefined,
): HTMLElement {
  return NotificationBanner.show({
    title: "Chưa thể thực hiện",
    body: reason ? `${message}: ${reason}` : message,
    category: "error",
    icon: "zap-off",
    durationMs: 5000,
    ...(onClick ? { onClick } : {}),
  });
}

export function notifyActionSuccess(
  title: string,
  body: string,
  onClick?: (() => void) | undefined,
  category: "territory" | "landmark" | "gacha" | "rank" = "territory",
  icon?: string | undefined,
): HTMLElement {
  return NotificationBanner.show({
    title,
    body,
    category,
    icon: icon ?? "check-circle",
    durationMs: 5500,
    ...(onClick ? { onClick } : {}),
  });
}
