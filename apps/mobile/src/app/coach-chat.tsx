import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  PressableScale,
  Screen,
  UpgradePrompt,
} from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useProfile } from '../state/profile';

/**
 * /coach-chat — Elite 1-on-1 coach chat. Message Greece directly; the thread
 * is gated to Elite via hasEntitlement. Lower tiers see the upgrade sell.
 *
 * Header is the compact chat pattern (not the huge poster header): back
 * circle → Greece's avatar → title + caption, so the thread owns the screen.
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
    width: 44,
    height: 44,
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

function Header({ title, caption }: { title: string; caption?: string }) {
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
        source={NEWIE}
        style={styles.coachAvatar}
        contentFit="cover"
        contentPosition="top"
        accessibilityLabel="Greece"
      />
      <View style={styles.headerText}>
        <AppText variant="title">{title}</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
    </Animated.View>
  );
}

export default function CoachChatScreen() {
  const tier = useProfile((s) => s.tier);
  const unlocked = hasEntitlement({ tier }, 'coach_chat');

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
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: true }}>
      <Header title="Coach chat" caption="Message Greece directly" />
      <CoachThread
        kind="coach_chat"
        emptyTitle="Say hello to Greece"
        emptyBody="Ask about your training, form, or nutrition — Greece reviews these personally and replies within 24h."
        placeholder="Message Greece…"
        starters={[
          "How's my training looking?",
          'Any tips for my squat form?',
          'What should I eat post-workout?',
        ]}
      />
    </Screen>
  );
}
