import { useState } from 'react';
import { router } from 'expo-router';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  enterDown,
  enterUp,
  IconChip,
  PressableScale,
  Screen,
} from '../components/ui';
import { CoachCard } from '../features/onboarding/components/NewieStage';

/**
 * Welcome — the front door. Newie greets you chat-style (typing dots, then
 * his line); tapping him cycles through his pitch. Below the hero, a
 * swipeable card strip shows what the app actually does before asking for
 * anything. "Get started" hands you to onboarding — no forced login,
 * sign-in stays one tap for returning users.
 */

const NEWIE = require('../../assets/images/newie.png');

/** Newie's lines — tap him to hear the next one. Each replays the typing dots. */
const LINES = [
  "I'm Newie — Greece built me to get you strong. Train, eat, grow. Ready?",
  'I build your plan around you — your body, your goal, your schedule.',
  "Log your food in seconds. I'll keep the macros straight.",
  'Every workout you log makes the next one smarter.',
];

interface Feature {
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: 'barbell-outline',
    color: colors.accent,
    title: 'Smart workouts',
    body: 'Log sets, reps and RPE — PRs and history tracked for you.',
  },
  {
    icon: 'restaurant-outline',
    color: colors.orange,
    title: 'Food & macros',
    body: 'Log meals in seconds and hit your protein every day.',
  },
  {
    icon: 'trending-up-outline',
    color: colors.blue,
    title: 'Progress you can see',
    body: 'Charts, streaks and body stats that keep you honest.',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    color: colors.success,
    title: 'A coach in your corner',
    body: 'The GM Method by Greece — with Newie guiding every step.',
  },
];

/** Peek of the next card so the strip reads as swipeable at a glance. */
const CARD_PEEK = 36;
const CARD_GAP = 10;

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  // Mirror Screen's content column: 20px gutters, capped at 640 on wide viewports.
  const contentWidth = Math.min(width, 640) - 40;
  const cardWidth = contentWidth - CARD_PEEK;

  const [lineIndex, setLineIndex] = useState(0);
  const [page, setPage] = useState(0);

  const onStripScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const raw = Math.round(e.nativeEvent.contentOffset.x / (cardWidth + CARD_GAP));
    setPage(Math.max(0, Math.min(FEATURES.length - 1, raw)));
  };

  return (
    <Screen>
      {/* Brand */}
      <Animated.View entering={enterDown(0)} style={styles.brand}>
        <AppText variant="label" color={colors.accent}>
          The GM Method · by Greece Maharjan
        </AppText>
        <AppText variant="display" style={styles.title}>
          GYM TRACKER
        </AppText>
        <View style={styles.titleRule} />
      </Animated.View>

      {/* Coach card — right under brand; the hero below is the speaker,
          so the card skips its avatar chip. */}
      <Animated.View entering={enterUp(1)} style={styles.cardWrap}>
        <CoachCard
          text={LINES[lineIndex]}
          showAvatar={false}
          reserveLines={3}
          style={styles.welcomeCard}
        />
      </Animated.View>

      {/* Hero: Newie fills the flexible space. Tap him for his next line. */}
      <Animated.View entering={enterUp(1)} style={styles.stage}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Newie, your coach — tap to hear more"
          pressScale={0.97}
          onPress={() => setLineIndex((i) => (i + 1) % LINES.length)}
          style={styles.newiePress}
        >
          <Image source={NEWIE} style={styles.newie} contentFit="contain" />
        </PressableScale>
      </Animated.View>

      {/* What you get — swipeable, dots track the page */}
      <Animated.View entering={enterUp(2)}>
        <FlatList
          data={FEATURES}
          keyExtractor={(f) => f.title}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + CARD_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          onScroll={onStripScroll}
          scrollEventThrottle={32}
          ItemSeparatorComponent={StripGap}
          renderItem={({ item }) => (
            <View
              style={[styles.card, { width: cardWidth }]}
              accessible
              accessibilityLabel={`${item.title}. ${item.body}`}
            >
              <IconChip icon={item.icon} iconColor={item.color} />
              <View style={styles.cardText}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="caption" numberOfLines={2}>
                  {item.body}
                </AppText>
              </View>
            </View>
          )}
        />
        <View style={styles.dots} importantForAccessibility="no-hide-descendants">
          {FEATURES.map((f, i) => (
            <View
              key={f.title}
              style={[styles.dot, i === page ? styles.dotActive : styles.dotIdle]}
            />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={enterUp(3)} style={styles.actions}>
        <Button label="Get started" onPress={() => router.push('/onboarding')} />
        <Button
          label="I already have an account"
          variant="ghost"
          onPress={() => router.push('/auth/sign-in')}
        />
        <AppText variant="caption" center color={colors.textFaint}>
          About 2 minutes to set up — Newie walks you through it.
        </AppText>
      </Animated.View>
    </Screen>
  );
}

function StripGap() {
  return <View style={{ width: CARD_GAP }} />;
}

const styles = StyleSheet.create({
  // Screen already adds 16px top air; xs keeps total ~20 instead of 28.
  brand: { marginTop: spacing.xs },
  title: { marginTop: 2 },
  titleRule: {
    width: 34,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },

  cardWrap: {
    width: '92%',
    maxWidth: 360,
    marginTop: spacing.lg,
    // Center in the content column, hugging the centered Newie hero below,
    // on wide viewports where the column caps at 640.
    alignSelf: 'center',
  },
  // The screen has room — extra vertical padding lets the greeting breathe.
  welcomeCard: { paddingVertical: spacing.lg },

  stage: {
    flex: 1,
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  newiePress: {
    width: '92%',
    maxWidth: 390,
    height: '100%',
  },
  newie: { width: '100%', height: '100%' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 84,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cardText: { flex: 1, gap: 2 },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  dot: { height: 6, borderRadius: radius.full },
  dotActive: { width: 18, backgroundColor: colors.accent },
  dotIdle: { width: 6, backgroundColor: colors.borderStrong },

  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingTop: spacing.lg,
  },
});
