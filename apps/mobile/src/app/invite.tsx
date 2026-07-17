import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  enterDown,
  enterFade,
  enterUp,
  PhotoHero,
  PressableScale,
  Screen,
  ScreenHeader,
  stockImages,
} from '../components/ui';
import { sendReferral } from '../features/engagement/invite/actions';
import { ReferralSection } from '../features/engagement/invite/components/ReferralSection';
import { useReferrals } from '../features/engagement/invite/hooks';
import { useAuth } from '../state/auth';

/**
 * /invite — the dedicated "Invite friends" screen (reached from Settings).
 * Same screen skeleton as /leaderboard and /badges: Screen scroll, back
 * header, load-on-focus, quiet stale/retry row instead of a blocking error
 * state. The body is the referral hero + email form + sent-invite status
 * list; a short "How it works" strip explains the two-sided discount.
 */

const HOW_IT_WORKS: { icon: 'mail-outline' | 'person-add-outline' | 'pricetag-outline'; line: string }[] = [
  { icon: 'mail-outline', line: 'Send an invite to a friend who hasn’t joined yet.' },
  { icon: 'person-add-outline', line: 'They create their account with that email.' },
  { icon: 'pricetag-outline', line: 'You BOTH unlock a subscription discount.' },
];

export default function InviteScreen() {
  const status = useAuth((s) => s.status);
  const { referrals, stale, reload } = useReferrals();

  function goBack(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <Screen scroll keyboardAware>
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

      <ScreenHeader eyebrow="Refer & earn" title="Invite friends" style={styles.header} />

      {/* Mood banner — the shared photo-hero treatment (dark frame + scrim +
          red chip + white ink ≥4.5:1). Purely decorative; the header and the
          "How it works" strip carry the actual information. */}
      <Animated.View entering={enterUp(0)}>
        <PhotoHero
          source={stockImages.runnersSilhouetteBlue}
          size="banner"
          recyclingKey="invite-banner"
          accessibilityLabel="Three runners silhouetted against a dawn sky"
          chip={{ label: 'Train together' }}
          title="Invite a friend — you both save."
          style={styles.banner}
        />
      </Animated.View>

      {status !== 'signedIn' ? (
        <Animated.View entering={enterUp(0)}>
          <Card variant="red" style={styles.signedOutCard}>
            <AppText variant="title" color={colors.onBlock}>
              Share the app, share the discount
            </AppText>
            <AppText variant="body" color={colors.onBlock}>
              Sign in to invite friends — when they join, you both get a
              subscription discount.
            </AppText>
            <Button
              label="Sign in"
              variant="onBlock"
              onPress={() => router.push('/auth/sign-in')}
              style={styles.signedOutBtn}
            />
          </Card>
          <View style={styles.signedOutSecondary}>
            <Button
              label="Create account"
              variant="secondary"
              onPress={() => router.push('/auth/sign-up')}
            />
          </View>
        </Animated.View>
      ) : (
        <>
          {stale ? (
            <Animated.View entering={enterFade(0)}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Showing last known state. Tap to retry."
                onPress={reload}
                style={styles.staleRow}
              >
                <Ionicons name="cloud-offline" size={14} color={colors.textDim} />
                <AppText variant="caption" style={styles.staleText}>
                  Showing last known state — tap to retry.
                </AppText>
                <Ionicons name="refresh" size={15} color={colors.textDim} />
              </PressableScale>
            </Animated.View>
          ) : null}

          <Animated.View entering={enterUp(1)}>
            <ReferralSection
              referrals={referrals}
              onRefer={(email) => sendReferral(email)}
              onReload={reload}
            />
          </Animated.View>

          {/* ── How it works — quiet three-step explainer ─────── */}
          <Animated.View entering={enterUp(2)} style={styles.howCard}>
            <AppText variant="label" color={colors.textDim}>
              How it works
            </AppText>
            {HOW_IT_WORKS.map((step, i) => (
              <View key={step.icon} style={styles.howRow}>
                <View style={styles.howNum}>
                  <AppText variant="label" color={colors.accent} tabular>
                    {i + 1}
                  </AppText>
                </View>
                <Ionicons name={step.icon} size={18} color={colors.textDim} />
                <AppText variant="body" style={styles.howText}>
                  {step.line}
                </AppText>
              </View>
            ))}
            <AppText variant="caption" color={colors.textFaint}>
              Invites are for friends who are new to the app — emails that
              already have an account can’t be invited.
            </AppText>
          </Animated.View>
        </>
      )}
    </Screen>
  );
}

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
  header: { marginBottom: spacing.gutter },
  banner: { marginBottom: spacing.gutter },

  // Signed-out — red hero block carries the sign-in invite.
  signedOutCard: { gap: spacing.md },
  signedOutBtn: { marginTop: spacing.xs },
  signedOutSecondary: { marginTop: spacing.md },

  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: touch.min,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  staleText: { flex: 1 },

  // How it works — borderless charcoal block, spacing over hairlines.
  howCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  howRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 32,
  },
  howNum: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howText: { flex: 1 },
});
