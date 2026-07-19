import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  Divider,
  EmptyState,
  enterDown,
  enterFade,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
  SectionLabel,
  Sheet,
  Skeleton,
  StatBlock,
  Tag,
} from '../../components/ui';
import { successHaptic } from '../../lib/haptics';
import { useAuth } from '../../state/auth';
import {
  cancelCoachRequest,
  createCoachRequest,
  getCoachDetail,
  toMentorshipError,
  type CoachDetail,
} from '../../features/mentorship/api';
import { CoachHero } from '../../features/mentorship/components/CoachHero';
import { useMyCoach } from '../../features/mentorship/hooks';
import { pushPath } from '../../features/mentorship/nav';

/**
 * /coaches/[id] — one coach's full public profile, redesigned as a rich
 * scrolling page:
 *
 *   hero (photo + scrim, or the ONE red block when no photo) with name,
 *   seniority badge and verified mark → 3-up big-number stat row →
 *   availability strip → specialty chips → certifications → achievements →
 *   recent client wins (anonymised coach-logged milestones) → about with
 *   read-more → a STICKY state-aware CTA pinned to the bottom:
 *
 *    your coach          → "Your coach" tag + Open chat
 *    pending → this coach → Cancel request
 *    pending → another    → quiet "already pending" note
 *    not taking clients   → disabled button
 *    otherwise            → Request coaching → intro sheet → POST
 *
 * All request/cancel logic is unchanged from the pre-redesign screen.
 */

const MESSAGE_MAX = 500;

/** Scroll clearance so the last section never hides behind the pinned CTA. */
const CTA_SPACE = 150;

/** Bios longer than this collapse behind a Read-more toggle. */
const BIO_COLLAPSE_CHARS = 280;
const BIO_COLLAPSED_LINES = 6;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** 'YYYY-MM-DD' → 'Mar 2026' — string math only, no Date/timezone traps. */
function formatAchievedAt(iso: string): string {
  const [y, m] = iso.split('-');
  const year = Number(y);
  const month = Number(m);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return iso;
  return `${MONTHS[month - 1] ?? ''} ${year}`.trim();
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Stat row: the signature big-number unit, 3-up in a charcoal card ──
  statCard: { marginTop: spacing.md },
  statRow: { flexDirection: 'row', alignItems: 'stretch' },
  statCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  // ── Availability strip ──
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: touch.min,
    marginTop: spacing.sm,
  },
  availDot: { width: 8, height: 8, borderRadius: radius.full },
  availText: { flex: 1 },
  // ── Body sections ──
  specialties: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  certRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  certMain: { flex: 1, gap: 2 },
  // Achievements: ONE card with divider-separated lines — not row wallpaper.
  achieveLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  achieveText: { flex: 1 },
  winLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  winMain: { flex: 1, gap: 2 },
  bio: { marginTop: spacing.xs },
  readMore: {
    minHeight: touch.min,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingRight: spacing.lg,
  },
  // ── Pinned CTA bar ──
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
  ctaInner: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    gap: spacing.md,
  },
  yourCoachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  ctaNote: { textAlign: 'center' },
  errorLine: { textAlign: 'center' },
  // ── Request sheet ──
  sheetBody: { gap: spacing.md, paddingBottom: spacing.sm },
  sheetInput: { minHeight: 96, paddingTop: spacing.lg, textAlignVertical: 'top' },
  // ── Loading skeleton ──
  skeletons: { gap: spacing.md },
});

/** Friendly line for each typed request/cancel failure. */
function requestErrorLine(code: string): string {
  switch (code) {
    case 'already_pending':
      return 'You already have a pending request.';
    case 'already_assigned':
      return 'You already have a coach.';
    case 'not_accepting':
      return "This coach isn't taking new clients right now.";
    case 'not_found':
      return 'This coach is no longer available.';
    case 'unauthorized':
      return 'Your session expired — sign in again to continue.';
    default:
      return "Couldn't reach the server — try again.";
  }
}

export default function CoachProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const coachId = typeof id === 'string' ? id : '';
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const my = useMyCoach();
  const insets = useSafeAreaInsets();

  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);

  const reload = useCallback(() => {
    if (status !== 'signedIn' || token === null || coachId === '') return;
    void (async () => {
      try {
        const next = await getCoachDetail(coachId, token);
        if (useAuth.getState().token !== token) return;
        setCoach(next);
        setNotFound(false);
        setLoadError(false);
      } catch (err) {
        if (toMentorshipError(err).code === 'not_found') setNotFound(true);
        else setLoadError(true);
      }
    })();
  }, [status, token, coachId]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function sendRequest(): void {
    if (token === null || sending) return;
    const intro = message.trim();
    setSending(true);
    setActionError(null);
    void (async () => {
      try {
        await createCoachRequest(coachId, intro.length > 0 ? intro : undefined, token);
        successHaptic();
        setSheetOpen(false);
        setMessage('');
        my.reload(); // banner + CTA flip to the pending state
      } catch (err) {
        const code = toMentorshipError(err).code;
        setActionError(requestErrorLine(code));
        // The server knows better — resync so the CTA reflects reality.
        if (code === 'already_pending' || code === 'already_assigned') {
          setSheetOpen(false);
          my.reload();
        }
      } finally {
        setSending(false);
      }
    })();
  }

  function cancelRequest(): void {
    if (token === null || my.request === null || cancelling) return;
    const requestId = my.request.id;
    setCancelling(true);
    setActionError(null);
    void (async () => {
      try {
        await cancelCoachRequest(requestId, token);
        my.reload();
      } catch (err) {
        const code = toMentorshipError(err).code;
        // Already decided/withdrawn server-side — resync instead of erroring.
        if (code === 'not_found') my.reload();
        else setActionError(requestErrorLine(code));
      } finally {
        setCancelling(false);
      }
    })();
  }

  // ── Signed out: everything here needs an account ──
  if (status !== 'signedIn') {
    return (
      <Screen scroll>
        <Animated.View entering={enterDown()} style={styles.backRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={goBack}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>
        <EmptyState
          icon="people"
          title="Sign in to view coaches"
          body="Coach profiles, requests and 1-on-1 chat live on your account."
          actionLabel="Sign in"
          onAction={() => pushPath('/auth/sign-in')}
        />
      </Screen>
    );
  }

  const isMyCoach = my.coach !== null && my.coach.id === coachId;
  const pendingHere = my.request !== null && my.request.coachId === coachId;
  const pendingElsewhere = my.request !== null && my.request.coachId !== coachId;
  const accepting = coach !== null && coach.acceptingClients && coach.hasCapacity;

  const wins = coach?.milestones ?? [];
  const bioText = coach?.bio.trim() ?? '';
  const bioCollapsible = bioText.length > BIO_COLLAPSE_CHARS;

  const availabilityLine =
    coach === null
      ? ''
      : accepting
        ? `Accepting new clients · ${coach.activeClients} of ${coach.capacity} spots filled`
        : coach.acceptingClients
          ? `Roster full · ${coach.activeClients} of ${coach.capacity} spots filled`
          : 'Not taking new clients right now';

  const showCtaBar = coach !== null && !notFound;

  return (
    <View style={styles.shell}>
      <Screen scroll bottomInset={showCtaBar ? CTA_SPACE : 0}>
        <Animated.View entering={enterDown()} style={styles.backRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={goBack}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </PressableScale>
        </Animated.View>

        {notFound ? (
          <EmptyState
            icon="person-remove"
            title="Coach not found"
            body="This profile may have been removed."
            actionLabel="Browse coaches"
            onAction={goBack}
          />
        ) : coach === null ? (
          loadError ? (
            <EmptyState
              icon="cloud-offline"
              title="Couldn't load this coach"
              body="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => {
                setLoadError(false);
                reload();
              }}
            />
          ) : (
            <Animated.View
              entering={enterFade(0)}
              style={styles.skeletons}
              accessibilityLabel="Loading coach profile"
            >
              <Skeleton height={300} radius={radius.block} />
              <Skeleton height={110} radius={radius.block} />
              <Skeleton height={64} />
              <Skeleton height={64} />
            </Animated.View>
          )
        ) : (
          <>
            {/* ── Hero: photo + scrim, or the ONE red block when no photo ── */}
            <Animated.View entering={enterUp(0)}>
              <CoachHero
                name={coach.displayName}
                headline={coach.headline}
                photoUrl={coach.photoUrl ?? coach.avatarUrl}
                tier={coach.coachTier}
              />
            </Animated.View>

            {/* ── Big-number stat row ── */}
            <Animated.View entering={enterUp(1)} style={styles.statCard}>
              <Card padding={spacing.lg}>
                <View style={styles.statRow}>
                  <StatBlock
                    label="Years"
                    value={coach.yearsExperience}
                    size="stat"
                    align="center"
                    style={styles.statCell}
                  />
                  <View style={styles.statDivider} />
                  <StatBlock
                    label="Clients"
                    value={coach.activeClients}
                    unit={`/ ${coach.capacity}`}
                    size="stat"
                    align="center"
                    style={styles.statCell}
                  />
                  <View style={styles.statDivider} />
                  {wins.length > 0 ? (
                    <StatBlock
                      label="Client wins"
                      value={wins.length}
                      size="stat"
                      align="center"
                      accent
                      style={styles.statCell}
                    />
                  ) : (
                    <StatBlock
                      label="Replies"
                      value={coach.replyWindowHours}
                      unit="h"
                      size="stat"
                      align="center"
                      style={styles.statCell}
                    />
                  )}
                </View>
              </Card>

              {/* Availability strip — capacity context under the numbers. */}
              <View style={styles.availRow}>
                <View
                  style={[
                    styles.availDot,
                    { backgroundColor: accepting ? colors.success : colors.textFaint },
                  ]}
                />
                <AppText variant="caption" color={colors.textDim} style={styles.availText}>
                  {availabilityLine}
                </AppText>
                <AppText variant="label">Replies in {coach.replyWindowHours}h</AppText>
              </View>
            </Animated.View>

            {coach.specialties.length > 0 ? (
              <Animated.View entering={enterUp(2)}>
                <SectionLabel>Specialties</SectionLabel>
                <View style={styles.specialties}>
                  {coach.specialties.map((s) => (
                    <Tag key={s} label={s} variant="dim" />
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {coach.certifications.length > 0 ? (
              <Animated.View entering={enterUp(3)}>
                <SectionLabel>Certifications</SectionLabel>
                <View style={styles.stack}>
                  {coach.certifications.map((c, i) => (
                    <View key={`${c.title}-${i}`} style={styles.certRow}>
                      <IconChip icon="school" size={36} />
                      <View style={styles.certMain}>
                        <AppText variant="bodyBold" numberOfLines={2}>
                          {c.title}
                        </AppText>
                        <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                          {c.issuer}
                        </AppText>
                      </View>
                      {c.year !== null ? <AppText variant="label">{c.year}</AppText> : null}
                    </View>
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {coach.achievements.length > 0 ? (
              <Animated.View entering={enterUp(4)}>
                <SectionLabel>Achievements</SectionLabel>
                <Card padding={spacing.lg}>
                  {coach.achievements.map((a, i) => (
                    <View key={`${a}-${i}`}>
                      {i > 0 ? <Divider /> : null}
                      <View style={styles.achieveLine}>
                        <Ionicons name="trophy-outline" size={16} color={colors.textDim} />
                        <AppText variant="body" style={styles.achieveText}>
                          {a}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </Card>
              </Animated.View>
            ) : null}

            {/* ── Social proof: anonymised coach-logged client milestones ── */}
            {wins.length > 0 ? (
              <Animated.View entering={enterUp(5)}>
                <SectionLabel>Recent client wins</SectionLabel>
                <Card padding={spacing.lg}>
                  {wins.map((w, i) => (
                    <View key={`${w.title}-${w.achievedAt}-${i}`}>
                      {i > 0 ? <Divider /> : null}
                      <View style={styles.winLine}>
                        <IconChip icon="ribbon-outline" size={36} />
                        <View style={styles.winMain}>
                          <AppText variant="bodyBold" numberOfLines={2}>
                            {w.title}
                          </AppText>
                          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                            {formatAchievedAt(w.achievedAt)}
                          </AppText>
                        </View>
                      </View>
                    </View>
                  ))}
                </Card>
              </Animated.View>
            ) : null}

            {bioText.length > 0 ? (
              <Animated.View entering={enterUp(6)}>
                <SectionLabel>About</SectionLabel>
                <AppText
                  variant="body"
                  color={colors.textDim}
                  style={styles.bio}
                  numberOfLines={
                    bioCollapsible && !bioExpanded ? BIO_COLLAPSED_LINES : undefined
                  }
                >
                  {bioText}
                </AppText>
                {bioCollapsible ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={bioExpanded ? 'Show less of the bio' : 'Read the full bio'}
                    onPress={() => setBioExpanded((v) => !v)}
                    style={styles.readMore}
                  >
                    <AppText variant="caption" color={colors.accent}>
                      {bioExpanded ? 'Show less' : 'Read more'}
                    </AppText>
                  </PressableScale>
                ) : null}
              </Animated.View>
            ) : null}

            {/* ── Intro sheet: optional message → POST /api/coach-requests ── */}
            <Sheet
              visible={sheetOpen}
              onClose={() => {
                setSheetOpen(false);
                setActionError(null);
              }}
              title={`Request ${coach.displayName}`}
            >
              <View style={styles.sheetBody}>
                <AppTextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Introduce yourself (optional)"
                  multiline
                  maxLength={MESSAGE_MAX}
                  style={styles.sheetInput}
                  accessibilityLabel="Introduction message, optional"
                />
                <AppText variant="caption" color={colors.textFaint}>
                  Max {MESSAGE_MAX} characters. Contact details are hidden until your coach
                  accepts.
                </AppText>
                {actionError !== null ? (
                  <AppText variant="caption" color={colors.error}>
                    {actionError}
                  </AppText>
                ) : null}
                <Button label="Send request" loading={sending} onPress={sendRequest} />
              </View>
            </Sheet>
          </>
        )}
      </Screen>

      {/* ── Sticky state-aware CTA — always on screen, logic unchanged ── */}
      {showCtaBar ? (
        <Animated.View
          entering={enterFade(2)}
          style={[styles.ctaBar, { paddingBottom: insets.bottom + spacing.md }]}
        >
          <View style={styles.ctaInner}>
            {actionError !== null && !sheetOpen ? (
              <AppText variant="caption" color={colors.error} style={styles.errorLine}>
                {actionError}
              </AppText>
            ) : null}

            {isMyCoach ? (
              <>
                <View style={styles.yourCoachRow}>
                  <Tag label="Your coach" variant="filled" />
                </View>
                <Button
                  label="Open chat"
                  variant="secondary"
                  onPress={() => pushPath('/coach-chat')}
                />
                <Button
                  label="Rate this coach"
                  variant="ghost"
                  onPress={() =>
                    pushPath(
                      `/coach-review?coachId=${encodeURIComponent(coach.id)}&coachName=${encodeURIComponent(coach.displayName)}`,
                    )
                  }
                />
              </>
            ) : pendingHere ? (
              <>
                <AppText variant="caption" color={colors.textDim} style={styles.ctaNote}>
                  Your request is with {coach.displayName} — you&apos;ll hear back soon.
                </AppText>
                <Button
                  label="Cancel request"
                  variant="secondary"
                  loading={cancelling}
                  onPress={cancelRequest}
                />
              </>
            ) : pendingElsewhere ? (
              <AppText variant="caption" color={colors.textDim} style={styles.ctaNote}>
                You already have a pending request with {my.request?.coachName ?? 'another coach'}.
              </AppText>
            ) : !accepting ? (
              <Button label="Not taking clients" onPress={() => undefined} disabled />
            ) : (
              <Button
                label="Request coaching"
                onPress={() => {
                  setActionError(null);
                  setSheetOpen(true);
                }}
              />
            )}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
