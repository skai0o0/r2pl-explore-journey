import {
  ACTIVITY_NOTIFICATION_KINDS,
  type ActivityNotificationKind,
  type LiveNotification,
} from "../../shared/integration/notifications.ts";
import { NotificationBanner } from "./ui/notificationBanner.ts";
/** Online only: hiding/leaving closes the feed and drops queued activity. No history replay. */
export function startLiveNotifications(): () => void {
  let source: EventSource | undefined;
  const seen = new Set<string>();
  const connect = () => {
    source?.close();
    source = undefined;
    NotificationBanner.clearAll();
    if (document.hidden) return;
    source = new EventSource("/api/notifications/live");
    source.onerror = () => NotificationBanner.clearAll();
    source.addEventListener("notification", (event) => {
      try {
        const data = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as LiveNotification;
        if (
          !data ||
          typeof data.id !== "string" ||
          !/^\d+$/.test(data.id) ||
          !ACTIVITY_NOTIFICATION_KINDS.includes(
            data.kind as ActivityNotificationKind,
          ) ||
          typeof data.title !== "string" ||
          data.title.length > 100 ||
          typeof data.body !== "string" ||
          data.body.length > 500 ||
          !Number.isFinite(data.expiresAtMs) ||
          data.expiresAtMs <= Date.now() ||
          seen.has(data.id)
        )
          return;
        seen.add(data.id);
        if (seen.size > 200) seen.delete(seen.values().next().value!);
        NotificationBanner.show({
          title: data.title,
          body: data.body,
          expiresAtMs: data.expiresAtMs,
          category:
            data.kind === "rally"
              ? "landmark"
              : data.kind === "chest_opened"
                ? "chest"
                : "territory",
        });
      } catch {
        /* Ignore malformed events without exposing payload. */
      }
    });
  };
  document.addEventListener("visibilitychange", connect);
  connect();
  const close = () => {
    source?.close();
    NotificationBanner.clearAll();
  };
  window.addEventListener("pagehide", close);
  return () => {
    close();
    document.removeEventListener("visibilitychange", connect);
    window.removeEventListener("pagehide", close);
  };
}
