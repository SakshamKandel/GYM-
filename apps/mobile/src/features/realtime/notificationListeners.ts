import * as Notifications from 'expo-notifications';

export type PushRefreshNotification = Notifications.Notification;

/** Register both foreground-arrival and tray-response listeners on native. */
export function registerNotificationListeners(
  handle: (notification: PushRefreshNotification) => void,
): void {
  Notifications.addNotificationReceivedListener(handle);
  Notifications.addNotificationResponseReceivedListener((response) => {
    handle(response.notification);
  });
}
