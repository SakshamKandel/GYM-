export interface PushRefreshNotification {
  request: {
    content: { data?: Record<string, unknown> };
    trigger: unknown;
  };
}

/** Web has no native push listener; foreground catch-up remains in pushRefresh. */
export function registerNotificationListeners(
  _handle: (notification: PushRefreshNotification) => void,
): void {}
