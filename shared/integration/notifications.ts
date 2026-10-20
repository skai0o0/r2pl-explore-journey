export const ACTIVITY_NOTIFICATION_KINDS = [
  "rally",
  "station_arrival",
  "chest_opened",
] as const;
export type ActivityNotificationKind =
  (typeof ACTIVITY_NOTIFICATION_KINDS)[number];
export type NotificationKind = ActivityNotificationKind | "admin";
export interface LiveNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly schoolSlot: number | null;
}
export const NOTIFICATION_LABELS: Record<ActivityNotificationKind, string> = {
  rally: "Hiệu triệu thắp đèn",
  station_arrival: "Trường đến trạm tiếp tế",
  chest_opened: "Sinh viên mở rương",
};
export interface NotificationRouting {
  readonly kind: ActivityNotificationKind;
  readonly forwardToPortal: boolean;
}
export interface PortalNotification {
  readonly version: 1;
  readonly notificationId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly occurredAtMs: number;
  readonly audience: {
    readonly scope: "campaign" | "school";
    readonly schoolId?: string;
  };
}
