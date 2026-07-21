/** A notification data field, tolerant of whatever primitive shape was sent. */
function stringField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Resolve notification data to an in-app route without loading native APIs. */
export function deepLinkForNotification(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const type = stringField(data, 'type');
  if (!type) return null;
  const id = stringField(data, 'id');
  switch (type) {
    case 'order':
      return '/meals/orders';
    case 'cycle':
      return '/meals/subscriptions';
    case 'tier':
      return '/subscribe';
    case 'coach_chat':
    case 'coach':
      return '/coach-chat';
    case 'support':
      return '/support';
    case 'gym':
      return id ? `/gyms/${encodeURIComponent(id)}` : '/gyms/saved';
    default:
      return null;
  }
}
