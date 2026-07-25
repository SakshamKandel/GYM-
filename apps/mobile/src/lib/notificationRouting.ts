/** A notification data field, tolerant of whatever primitive shape was sent. */
function stringField(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolve notification data to an in-app route without loading native APIs.
 *
 * Every `data.type` the server can send (apps/web `notify(...)` /
 * `sendPushToAccount(...)` call sites) is accounted for below — either mapped
 * to the screen that shows the thing the notification is about, or explicitly
 * listed as unmapped with the reason. A type that is missing entirely makes the
 * tap do nothing, which reads as a broken notification.
 */
export function deepLinkForNotification(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const type = stringField(data, 'type');
  if (!type) return null;
  const id = stringField(data, 'id');
  switch (type) {
    // ── Member-facing ────────────────────────────────────────────
    case 'order':
    case 'meal_order':
    case 'meal_payment_decided':
      return '/meals/orders';
    case 'cycle':
    case 'meal_cycle':
    case 'meal_subscription_updated':
      return '/meals/subscriptions';
    case 'tier':
    // A membership payment receipt was approved or rejected — the plan screen
    // is where the resulting (or unchanged) membership is visible.
    case 'payment_decided':
      return '/subscribe';
    case 'coach_chat':
    case 'coach':
      return '/coach-chat';
    case 'coach_plan':
    // The coach approved or adjusted the next progression; it shows up on the
    // next logged set, so the Train tab is the closest thing to "see it".
    case 'suggestion_reviewed':
      return '/(tabs)/train';
    case 'coach_request_decided':
      return '/coaches';
    // The member's own application to become a coach was approved or rejected;
    // the apply screen renders that decision.
    case 'application_decided':
      return '/coaches/apply';
    case 'milestone':
      return '/(tabs)/progress';
    // Awarded or coach-verified badge → the badge shelf.
    case 'badge_earned':
    case 'badge_verified':
      return '/badges';
    // The coach's reply lives on the Home check-in card, same as the come-back
    // nudge, which is simply "open the app".
    case 'checkin_reply':
    case 'home':
      return '/(tabs)';
    case 'support':
    case 'support_reply':
      return '/support';
    case 'gym':
      return id ? `/gyms/${encodeURIComponent(id)}` : '/gyms/saved';
    // Admin announcement (POST /api/admin/broadcast). There is no dedicated
    // screen for it — the message itself IS the content, so a tap opens the
    // notification inbox where the durable copy lives (and where the member can
    // re-read it after the banner is gone).
    case 'broadcast':
      return '/notifications';

    // ── Coach console ────────────────────────────────────────────
    // A client just submitted a check-in — open that client, or the roster when
    // the id didn't come through.
    case 'coach_client':
      return id ? `/staff/coach/client/${encodeURIComponent(id)}` : '/staff/coach';
    // A member asked this coach to take them on; pending requests sit on the
    // coach console home.
    case 'coach_request':
      return '/staff/coach';
    // Seniority (silver/gold/elite) request decided — the profile screen shows
    // the current tier and the request state.
    case 'tier_request_decided':
      return '/staff/coach/profile';
    case 'payout_decided':
      return '/staff/coach/wallet';

    // ── Staff console (inbound-work fan-outs) ────────────────────
    case 'coach_application':
      return '/staff/admin/applications';
    case 'meal_payment':
      return '/staff/admin/meal-payments';
    case 'payment_request':
      return '/staff/admin/payments';

    // ── Deliberately unmapped ────────────────────────────────────
    // 'payout' goes to a restaurant PARTNER account. The partner portal is
    // web-only (/partner) — there is no mobile screen to open — so the
    // notification stays a read-only inbox entry.
    default:
      return null;
  }
}
