import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
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
  type CoachTier,
} from '../../features/mentorship/api';
import { useMyCoach } from '../../features/mentorship/hooks';
import { pushPath } from '../../features/mentorship/nav';

/**
 * /coaches/[id] — one coach's full profile: red hero block (avatar, name,
 * headline, experience pills), specialties, certifications, achievements and
 * bio, then ONE state-aware CTA:
 *
 *  your coach          → "Your coach" tag + Open chat
 *  pending → this coach → Cancel request
 *  pending → another    → quiet "already pending" note
 *  not taking clients   → disabled button
 *  otherwise            → Request coaching → intro sheet → POST
 */

const MESSAGE_MAX = 500;

const HERO_AVATAR = 64;

/** Seniority badge label — NOT a billing tier (see coach_profiles.coachTier).
 * Rendered `onBlock` (near-black chip) like its sibling hero chips: a
 * filled-color chip (accent/cream) would blend into the red hero itself. */
const COACH_TIER_LABEL: Record<CoachTier, string> = {
  elite: 'Elite',
  gold: 'Gold',
  silver: 'Silver',
};

const styles = StyleSheet.create({
  backRow: { marginBottom: spacing.lg },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Red hero block (the screen's ONE red block) ──
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  heroAvatar: {
    width: HERO_AVATAR,
    height: HERO_AVATAR,
    borderRadius: radius.md,
    // Near-black tile on red — sanctioned chip-inside-block pattern.
    backgroundColor: colors.onBlock,
  },
  heroName: {
    fontSize: type.size.display,
    lineHeight: 46,
    textTransform: 'uppercase',
  },
  heroHeadline: { opacity: 0.8, marginTop: spacing.sm },
  heroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  // ── Body sections ──
  specialties: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  rowMain: { flex: 1, gap: 2 },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touch.min,
  },
  bulletText: { flex: 1 },
  bio: { marginTop: spacing.xs },
  // ── CTA zone ──
  cta: { marginTop: spacing.xl, gap: spacing.md },
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

  const [coach, setCoach] = useState<CoachDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

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
          <Animated.View entering={enterFade(0)} style={styles.skeletons} accessibilityLabel="Loading coach profile">
            <Skeleton height={220} radius={radius.block} />
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </Animated.View>
        )
      ) : (
        <>
          {/* ── THE red hero block: identity + experience at a glance ── */}
          <Animated.View entering={enterUp(0)}>
            <Card variant="red">
              <View style={styles.heroTop}>
                {coach.avatarUrl !== null ? (
                  <Image
                    source={{ uri: coach.avatarUrl }}
                    style={styles.heroAvatar}
                    contentFit="cover"
                    accessibilityElementsHidden
                  />
                ) : (
                  <IconChip
                    icon="person"
                    size={HERO_AVATAR}
                    color={colors.onBlock}
                    iconColor={colors.text}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <AppText
                    variant="display"
                    color={colors.onBlock}
                    style={styles.heroName}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {coach.displayName}
                  </AppText>
                </View>
              </View>
              <AppText variant="body" color={colors.onBlock} style={styles.heroHeadline}>
                {coach.headline}
              </AppText>
              <View style={styles.heroMeta}>
                <Tag label={COACH_TIER_LABEL[coach.coachTier]} variant="onBlock" />
                <Tag label={`${coach.yearsExperience} yrs`} variant="onBlock" />
                <Tag
                  label={`${coach.activeClients} client${coach.activeClients === 1 ? '' : 's'}`}
                  variant="onBlock"
                />
                <Tag label={`Replies in ${coach.replyWindowHours}h`} variant="onBlock" />
              </View>
            </Card>
          </Animated.View>

          {coach.specialties.length > 0 ? (
            <Animated.View entering={enterUp(1)}>
              <SectionLabel>Specialties</SectionLabel>
              <View style={styles.specialties}>
                {coach.specialties.map((s) => (
                  <Tag key={s} label={s} variant="dim" />
                ))}
              </View>
            </Animated.View>
          ) : null}

          {coach.certifications.length > 0 ? (
            <Animated.View entering={enterUp(2)}>
              <SectionLabel>Certifications</SectionLabel>
              <View style={styles.stack}>
                {coach.certifications.map((c, i) => (
                  <View key={`${c.title}-${i}`} style={styles.row}>
                    <IconChip icon="school" />
                    <View style={styles.rowMain}>
                      <AppText variant="bodyBold" numberOfLines={2}>
                        {c.title}
                      </AppText>
                      <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
                        {c.issuer}
                        {c.year !== null ? ` · ${c.year}` : ''}
                      </AppText>
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {coach.achievements.length > 0 ? (
            <Animated.View entering={enterUp(3)}>
              <SectionLabel>Achievements</SectionLabel>
              <View style={styles.stack}>
                {coach.achievements.map((a, i) => (
                  <View key={`${a}-${i}`} style={styles.bulletRow}>
                    <Ionicons name="trophy-outline" size={16} color={colors.textDim} />
                    <AppText variant="body" style={styles.bulletText}>
                      {a}
                    </AppText>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {coach.bio.trim().length > 0 ? (
            <Animated.View entering={enterUp(4)}>
              <SectionLabel>About</SectionLabel>
              <AppText variant="body" color={colors.textDim} style={styles.bio}>
                {coach.bio}
              </AppText>
            </Animated.View>
          ) : null}

          {/* ── State-aware CTA ── */}
          <Animated.View entering={enterUp(5)} style={styles.cta}>
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
          </Animated.View>

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
  );
}
