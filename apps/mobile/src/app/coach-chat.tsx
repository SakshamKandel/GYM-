import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, Screen, UpgradePrompt } from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useProfile } from '../state/profile';

/**
 * /coach-chat — Elite 1-on-1 coach chat. Message Greece directly; the thread
 * is gated to Elite via hasEntitlement. Lower tiers see the upgrade sell.
 */

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
  headerText: { flex: 1 },
  gateWrap: { gap: spacing.lg, paddingTop: spacing.xl },
});

function Header({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.headerText}>
        <AppText variant="title">{title}</AppText>
        {caption ? <AppText variant="caption">{caption}</AppText> : null}
      </View>
    </View>
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
      />
    </Screen>
  );
}
