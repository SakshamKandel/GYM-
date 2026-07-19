import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { hasEntitlement } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  Card,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  UpgradePrompt,
} from '../components/ui';
import { CoachThread } from '../features/coach/components/CoachThread';
import { useMyCoach } from '../features/mentorship/hooks';
import { pushPath } from '../features/mentorship/nav';
import { useEffectiveTier } from '../lib/tier';
import { useAuth } from '../state/auth';

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
  unassignCard: { gap: spacing.sm },
  unassignActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  unassignBtn: { flex: 1 },
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

/** Last-known assigned coach, persisted so an unassign (coach → null) can
 * still name who it was and offer a rating — B21/Pack L, member side. */
interface LastCoach {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

function lastCoachKey(accountId: string): string {
  return `last-assigned-coach:${accountId}`;
}

function unassignDismissedKey(accountId: string, coachId: string): string {
  return `coach-unassign-dismissed:${accountId}:${coachId}`;
}

export default function CoachChatScreen() {
  const tier = useEffectiveTier();
  const { coach, loaded } = useMyCoach();
  const accountId = useAuth((s) => s.user?.id ?? null);
  const [unassigned, setUnassigned] = useState<LastCoach | null>(null);

  // An ASSIGNED coach unlocks the thread for ANY tier — the server now
  // accepts assigned members; the Elite entitlement stays the other door in.
  const unlocked = coach !== null || hasEntitlement({ tier }, 'coach_chat');
  const coachName = coach?.displayName ?? 'Greece';

  // Track the last assigned coach locally so a silent unassign (B21: the
  // server ends the assignment with no member-visible trace beyond the push)
  // still gets a banner here naming who it was and a way to rate them.
  useEffect(() => {
    if (!loaded || accountId === null) return;
    if (coach !== null) {
      void AsyncStorage.setItem(
        lastCoachKey(accountId),
        JSON.stringify({ id: coach.id, displayName: coach.displayName, avatarUrl: coach.avatarUrl }),
      );
      setUnassigned(null);
      return;
    }
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(lastCoachKey(accountId));
        if (!raw) return;
        const last = JSON.parse(raw) as LastCoach;
        const dismissed = await AsyncStorage.getItem(unassignDismissedKey(accountId, last.id));
        if (!dismissed) setUnassigned(last);
      } catch {
        // Best-effort — worst case the banner just doesn't appear.
      }
    })();
  }, [loaded, coach, accountId]);

  function dismissUnassigned(): void {
    if (accountId !== null && unassigned) {
      void AsyncStorage.setItem(unassignDismissedKey(accountId, unassigned.id), '1');
      void AsyncStorage.removeItem(lastCoachKey(accountId));
    }
    setUnassigned(null);
  }

  const unassignBanner =
    unassigned !== null ? (
      <Animated.View entering={enterUp(0)}>
        <Card style={styles.unassignCard}>
          <AppText variant="bodyBold">Your coaching with {unassigned.displayName} has ended</AppText>
          <AppText variant="caption" color={colors.textDim}>
            You can find a new coach, or leave {unassigned.displayName} a rating first.
          </AppText>
          <View style={styles.unassignActions}>
            <Button
              label="Rate coach"
              variant="secondary"
              onPress={() =>
                pushPath(
                  `/coach-review?coachId=${encodeURIComponent(unassigned.id)}&coachName=${encodeURIComponent(unassigned.displayName)}`,
                )
              }
              style={styles.unassignBtn}
            />
            <Button
              label="Browse coaches"
              variant="secondary"
              onPress={() => pushPath('/coaches')}
              style={styles.unassignBtn}
            />
          </View>
          <Button label="Dismiss" variant="ghost" onPress={dismissUnassigned} />
        </Card>
      </Animated.View>
    ) : null;

  if (!unlocked) {
    return (
      <Screen scroll>
        <Header title="Coach chat" />
        <View style={styles.gateWrap}>
          {unassignBanner}
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
