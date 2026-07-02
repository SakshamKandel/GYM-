import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, enterDown, enterUp, Screen } from '../components/ui';
import { Bubble } from '../features/onboarding/components/NewieStage';

/**
 * Welcome — the front door. Newie greets you chat-style: typing dots for a
 * beat, then his full line as plain visible text. "Get started" hands you to
 * his onboarding conversation. No forced login — sign-in is one tap for
 * returning users.
 */

const NEWIE = require('../../assets/images/newie.png');

export default function WelcomeScreen() {
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
      </Animated.View>

      {/* Bubble — right under brand, no gap */}
      <Animated.View entering={enterUp(1)} style={styles.bubbleWrap}>
        <Bubble
          text={"I'm Newie — Greece built me to get you strong. Train, eat, grow. Ready?"}
        />
        <View style={styles.tail} />
      </Animated.View>

      {/* Hero: Newie fills the remaining space, clear of the actions */}
      <Animated.View entering={enterUp(1)} style={styles.stage}>
        <Image
          source={NEWIE}
          style={styles.newie}
          contentFit="contain"
          accessibilityLabel="Newie, your coach"
        />
      </Animated.View>

      <Animated.View entering={enterUp(2)} style={styles.actions}>
        <Button label="Get started" onPress={() => router.push('/onboarding')} />
        <Button
          label="I already have an account"
          variant="ghost"
          onPress={() => router.push('/auth/sign-in')}
        />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Screen already adds 16px top air; xs keeps total ~20 instead of 28.
  brand: { marginTop: spacing.xs },
  title: { marginTop: 2 },

  bubbleWrap: {
    width: '92%',
    maxWidth: 360,
    marginTop: spacing.lg,
    // Center in the content column so the tail keeps pointing at Newie
    // (who is centered below) on wide viewports where the column caps at 640.
    alignSelf: 'center',
    zIndex: 2,
  },
  tail: {
    width: 16,
    height: 16,
    marginTop: -9,
    alignSelf: 'center',
    marginLeft: 8,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    transform: [{ rotate: '45deg' }],
  },

  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  newie: {
    width: '92%',
    maxWidth: 390,
    height: '100%',
  },

  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
});
