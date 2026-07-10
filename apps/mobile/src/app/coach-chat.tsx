import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  PressableScale,
  Screen,
  UpgradePrompt,
} from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useMyCoach } from '../features/mentorship/hooks';
import { useEffectiveTier } from '../lib/tier';

/**
 * /coach-chat — 1-on-1 coach chat. Unlocked for Elite (the classic Greece
 * thread) AND for any member with an ASSIGNED coach (the server allows
 * assigned members regardless of tier). Everyone else sees the upgrade sell
 * plus a route into the coach directory.
 *
 * Header is the compact chat pattern (not the huge poster header): back
 * circle → coach avatar → title + caption, so the thread owns the screen.
 */

const NEWIE = require('../../assets/images/newie.png');

const AVATAR = 40;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachAvatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  headerText: { flex: 1 },
  gateWrap: { gap: spacing.lg, paddingTop: spacing.xl },
});

function Header({
  title,
  caption,
  coachName = 'Greece',
  avatarUrl = null,
}: {
  title: string;
  caption?: string;
  coachName?: string;
  avatarUrl?: string | null;
}) {
  return (
    <Animated.View entering={enterDown()} style={styles.header}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={4}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/');
        }}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </PressableScale>
      <Image
        source={avatarUrl !== null ? { uri: avatarUrl } : NEWIE}
        style={styles.coachAvatar}
        contentFit="cover"
        contentPosition="top"
        accessibilityLabel={coachName}
      />
      <View style={styles.headerText}>
        <AppText variant="title">{title}</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
    </Animated.View>
  );
}

export default function CoachChatScreen() {
  const tier = useEffectiveTier();
  const { coach } = useMyCoach();
  // An ASSIGNED coach unlocks the thread for ANY tier — the server now
  // accepts assigned members; the Elite entitlement stays the other door in.
  const unlocked = coach !== null || hasEntitlement({ tier }, 'coach_chat');
  const coachName = coach?.displayName ?? 'Greece';

  if (!unlocked) {
    return (
      <Screen scroll>
        <Header title="Coach chat" />
        <View style={styles.gateWrap}>
          <UpgradePrompt
            requiredTier="elite"
            title="1-on-1 coach chat"
            description="Message Greece directly and get personal guidance."
          />
          <Button label="See plans" onPress={() => router.push('/subscribe' as Href)} />
          <Button
            label="Browse coaches"
            variant="secondary"
            onPress={() => router.push('/coaches' as Href)}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: true }}>
      <Header
        title="Coach chat"
        caption={`Message ${coachName} directly`}
        coachName={coachName}
        avatarUrl={coach?.avatarUrl ?? null}
      />
      <CoachThread
        kind="coach_chat"
        coachName={coachName}
        emptyTitle={`Say hello to ${coachName}`}
        emptyBody={`Ask about your training, form, or nutrition — ${coachName} reviews these personally and replies within 24h.`}
        placeholder={`Message ${coachName}…`}
        starters={[
          "How's my training looking?",
          'Any tips for my squat form?',
          'What should I eat post-workout?',
        ]}
      />
    </Screen>
  );
}
