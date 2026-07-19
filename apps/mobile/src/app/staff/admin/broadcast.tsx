import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../../../components/ui';
import {
  getBroadcastHistory,
  previewBroadcastAudience,
  sendBroadcast,
  toStaffError,
  type BroadcastHistoryEntry,
  type StaffErrorCode,
  type Tier,
} from '../../../features/staff/api';
import { replaceStaff, staffCan, STAFF_ROUTES } from '../../../features/staff/nav';
import { ReauthSheet, useReauth } from '../../../features/staff/ReauthGate';
import { useAuth } from '../../../state/auth';

/**
 * Admin · Broadcast — push announcement composer + send history (v1.0.3
 * mobile parity, ARCHITECTURE-REVIEW-2026-07-18 §6 NEXT). Mirrors the web
 * BroadcastComposer's shape: compose a title/body, optionally narrow the
 * audience to one tier and/or one ISO-3166 country, preview the audience size
 * via previewBroadcastAudience (debounced, race-guarded), then CONFIRM before
 * the irreversible fan-out — the send reaches real devices and cannot be
 * recalled, so the primary button always routes through ConfirmDialog rather
 * than firing immediately. History has no dedicated route; it's reconstructed
 * from the `broadcast.send` audit trail by getBroadcastHistory.
 *
 * Requires `broadcast.send` (super_admin + main_admin only).
 */

const TIERS: Tier[] = ['starter', 'silver', 'gold', 'elite'];
const AUDIENCE_DEBOUNCE_MS = 400;
const TITLE_MAX = 120;
const BODY_MAX = 500;

function errorLine(code: StaffErrorCode): string {
  if (code === 'unauthorized') return 'Your session expired — sign in again.';
  if (code === 'forbidden') return "You don't have access to this.";
  if (code === 'not_configured') return 'Push is not configured on the server — no broadcast was sent.';
  return "Couldn't reach the server.";
}

function describeAudience(tier: Tier | null, country: string | null): string {
  const parts: string[] = [];
  if (tier) parts.push(`${tier.charAt(0).toUpperCase()}${tier.slice(1)} tier`);
  if (country) parts.push(country);
  return parts.length === 0 ? 'All members' : parts.join(' · ');
}

/** Short relative age ("3m", "2h", "5d") with an absolute fallback. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RetryLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onRetry}
      style={styles.retry}
    >
      <Ionicons name="refresh" size={15} color={colors.textDim} />
      <AppText variant="caption">{message} Tap to retry.</AppText>
    </PressableScale>
  );
}

function HistoryRow({ entry }: { entry: BroadcastHistoryEntry }) {
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyHead}>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.historyTitle}>
          {entry.title || '(no title)'}
        </AppText>
        <AppText variant="caption" color={colors.textFaint}>
          {relativeTime(entry.createdAt)}
        </AppText>
      </View>
      <AppText variant="caption" color={colors.textDim}>
        {describeAudience((entry.tier as Tier) || null, entry.country)}
      </AppText>
      <AppText variant="caption" tabular color={colors.textDim}>
        {entry.recipients} member{entry.recipients === 1 ? '' : 's'} · {entry.delivered} delivered
        {entry.failed > 0 ? ` · ${entry.failed} failed` : ''}
      </AppText>
      {entry.truncated ? (
        <AppText variant="caption" color={colors.warning}>
          Audience exceeded the send cap — only the first {entry.devices.toLocaleString()} devices
          were reached.
        </AppText>
      ) : null}
      {entry.actorEmail ? (
        <AppText variant="caption" color={colors.textFaint}>
          Sent by {entry.actorEmail}
        </AppText>
      ) : null}
    </View>
  );
}

export default function AdminBroadcastScreen() {
  const token = useAuth((s) => s.token);
  const staffPermissions = useAuth((s) => s.staffPermissions);
  const allowed = staffCan(staffPermissions, 'broadcast.send');
  // B26: an irreversible mass push to real devices is the same class of
  // action as a refund/role-revoke elsewhere in the console — it now gets
  // the same fresh-password step-up instead of firing on a bare confirm tap.
  const reauth = useReauth();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tier, setTier] = useState<Tier | null>(null);
  const [country, setCountry] = useState('');

  const [recipients, setRecipients] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentResult, setSentResult] = useState<{ recipients: number } | null>(null);

  const [history, setHistory] = useState<BroadcastHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const titleTrimmed = title.trim();
  const bodyTrimmed = body.trim();
  const canCompose = titleTrimmed.length > 0 && bodyTrimmed.length > 0;
  const countryTrimmed = country.trim().toUpperCase();

  const loadHistory = useCallback(async () => {
    if (!token) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await getBroadcastHistory(token));
    } catch (e) {
      setHistoryError(errorLine(toStaffError(e).code));
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (allowed) void loadHistory();
  }, [allowed, loadHistory]);

  // Debounced, race-guarded audience preview — recomputes whenever the tier
  // or country filter changes so the composer always shows the CURRENT
  // filters' reach before the irreversible send.
  useEffect(() => {
    if (!allowed || !token) return;
    const reqId = ++previewSeq.current;
    setPreviewing(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const count = await previewBroadcastAudience(
            { tier: tier ?? undefined, country: countryTrimmed || undefined },
            token,
          );
          if (reqId !== previewSeq.current) return;
          setRecipients(count);
        } catch {
          if (reqId !== previewSeq.current) return;
          setRecipients(null);
        } finally {
          if (reqId === previewSeq.current) setPreviewing(false);
        }
      })();
    }, AUDIENCE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [allowed, token, tier, countryTrimmed]);

  function openConfirm(): void {
    if (!canCompose) {
      setSendError('A title and a message are both required.');
      return;
    }
    setSendError(null);
    setConfirmOpen(true);
  }

  async function send(): Promise<void> {
    if (!token || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const count = await sendBroadcast(
        { title: titleTrimmed, body: bodyTrimmed, tier: tier ?? undefined, country: countryTrimmed || undefined },
        token,
      );
      setSentResult({ recipients: count });
      setConfirmOpen(false);
      setTitle('');
      setBody('');
      setTier(null);
      setCountry('');
      setRecipients(null);
      await loadHistory();
    } catch (e) {
      setConfirmOpen(false);
      setSendError(errorLine(toStaffError(e).code));
    } finally {
      setSending(false);
    }
  }

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else replaceStaff(STAFF_ROUTES.adminHome);
  }

  if (!allowed) {
    return (
      <Screen>
        <BackRow onBack={goBack} />
        <Animated.View entering={enterUp(0)} style={styles.locked}>
          <Ionicons name="lock-closed" size={28} color={colors.textFaint} />
          <AppText variant="caption" center color={colors.textFaint}>
            Only a super admin or main admin can send broadcasts.
          </AppText>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAware>
      <BackRow onBack={goBack} />

      <Animated.View entering={enterUp(0)}>
        <Card style={styles.composeCard}>
          <SectionLabel>Title</SectionLabel>
          <AppTextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. New winter program is live"
            maxLength={TITLE_MAX}
            editable={!sending}
            accessibilityLabel="Broadcast title"
          />

          <SectionLabel>Message</SectionLabel>
          <AppTextInput
            value={body}
            onChangeText={setBody}
            placeholder="Keep it short — this shows as a push notification."
            multiline
            maxLength={BODY_MAX}
            editable={!sending}
            style={styles.bodyInput}
            accessibilityLabel="Broadcast message"
          />
          <AppText variant="caption" color={colors.textFaint} style={styles.counter}>
            {bodyTrimmed.length}/{BODY_MAX}
          </AppText>

          <SectionLabel>Tier (optional)</SectionLabel>
          <View style={styles.chipRow}>
            <Chip label="All tiers" selected={tier === null} onPress={() => setTier(null)} />
            {TIERS.map((t) => (
              <Chip
                key={t}
                label={t.charAt(0).toUpperCase() + t.slice(1)}
                selected={tier === t}
                onPress={() => setTier(t)}
              />
            ))}
          </View>

          <SectionLabel>Country (optional)</SectionLabel>
          <AppTextInput
            value={country}
            onChangeText={(v) => setCountry(v.toUpperCase())}
            placeholder="2-letter code, e.g. NP"
            maxLength={2}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!sending}
            accessibilityLabel="Country code filter"
          />

          <View style={styles.audienceRow}>
            <AppText variant="caption" color={colors.textDim}>
              Audience: {describeAudience(tier, countryTrimmed || null)}
            </AppText>
            {previewing ? (
              <ActivityIndicator size="small" color={colors.textFaint} />
            ) : (
              <AppText variant="caption" color={colors.textFaint} tabular>
                {recipients === null ? '—' : `~${recipients.toLocaleString()} reached`}
              </AppText>
            )}
          </View>

          {sendError ? (
            <AppText variant="caption" color={colors.error}>
              {sendError}
            </AppText>
          ) : null}

          {sentResult ? (
            <View style={styles.resultBanner}>
              <AppText variant="caption" color={colors.success}>
                Sent to {sentResult.recipients} member{sentResult.recipients === 1 ? '' : 's'}.
              </AppText>
            </View>
          ) : null}

          <Button
            label="Send broadcast"
            onPress={openConfirm}
            disabled={sending || !canCompose}
            loading={sending}
            style={styles.sendBtn}
          />
        </Card>
      </Animated.View>

      <Animated.View entering={enterUp(1)}>
        <SectionLabel>Recent broadcasts</SectionLabel>
        {historyLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : historyError ? (
          <RetryLine message={historyError} onRetry={() => void loadHistory()} />
        ) : !history || history.length === 0 ? (
          <EmptyState
            icon="megaphone"
            title="No broadcasts yet"
            body="Announcements you send appear here, newest first."
          />
        ) : (
          <Card style={styles.historyCard}>
            {history.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </Card>
        )}
      </Animated.View>

      <ConfirmDialog
        visible={confirmOpen}
        title="Send this broadcast?"
        message={`"${titleTrimmed}" reaches ${describeAudience(tier, countryTrimmed || null)}${
          recipients !== null ? ` (~${recipients.toLocaleString()} members)` : ''
        }. This sends a push notification immediately and cannot be undone.`}
        confirmLabel={sending ? 'Sending…' : 'Confirm & send'}
        cancelLabel="Cancel"
        onConfirm={() => reauth.guard(() => void send())}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* Step-up password prompt (B26) — same fresh-password gate as the
          money-moving refund actions elsewhere in the console. */}
      <ReauthSheet controller={reauth} />
    </Screen>
  );
}

/** Shared back row + revamp header. */
function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <>
      <Animated.View entering={enterDown()} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>
      <ScreenHeader eyebrow="Admin console" title="Broadcast" style={styles.header} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.gutter },
  locked: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  composeCard: { gap: spacing.sm, marginBottom: spacing.lg },
  bodyInput: { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },
  counter: { marginTop: -spacing.xs, alignSelf: 'flex-end' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  audienceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  resultBanner: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  sendBtn: { marginTop: spacing.sm },
  historyCard: { gap: 0 },
  historyRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceRaised,
  },
  historyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  historyTitle: { flex: 1 },
});
