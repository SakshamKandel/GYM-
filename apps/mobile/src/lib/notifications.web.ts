export { deepLinkForNotification } from './notificationRouting';

/** Web has an in-app notification center, but no native push/local scheduler. */
export async function requestPermission(): Promise<boolean> {
  return false;
}

export async function scheduleFirstWorkoutsReminder(
  _daysFromNow: number,
  _title: string,
  _body: string,
): Promise<boolean> {
  return false;
}

export async function cancelFirstWorkoutsReminder(): Promise<void> {}

export async function setupNotifications(): Promise<void> {}

export async function registerForPushNotificationsAsync(
  _options: { askIfUndetermined?: boolean } = {},
): Promise<boolean> {
  return false;
}

export function unregisterPushNotificationsAsync(_authToken: string): Promise<boolean> {
  return Promise.resolve(false);
}

export async function scheduleWorkoutReminders(
  _weekdays: number[],
  _hour: number,
  _minute: number,
): Promise<boolean> {
  return false;
}

export async function cancelWorkoutReminders(): Promise<void> {}

export async function scheduleMorningNudge(
  _enabled: boolean,
  _hour: number,
  _minute: number,
): Promise<boolean> {
  return false;
}

export async function scheduleStreakSaverReminder(
  _sessionsLeft: number,
  _streakWeeks: number,
): Promise<boolean> {
  return false;
}

export async function cancelStreakSaverReminder(): Promise<void> {}

export async function scheduleCheckInReminder(
  _enabled: boolean,
  _coachName?: string | null,
): Promise<boolean> {
  return false;
}
