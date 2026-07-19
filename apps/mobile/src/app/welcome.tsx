import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, nativeOnly, PressableScale, ProgressBar, Ring } from '../components/ui';
import { useBottomClearance } from '../lib/systemBars';

/**
 * Welcome — full-bleed red poster (owner's Planable-style reference, REVAMP
 * brief translated to red/black). A sticker collage floats over darker-red
 * organic shapes: a circular-text badge with Newie at its center, a tilted
 * charcoal "next workout" sticker and a tilted cream focus card with chips
 * and a progress ring. Below, the huge black headline sets one word in an
 * outlined pill and drops Newie's face into the line, reference-style. The
 * cream CTA pill carries a nested black arrow circle.
 *
 * All motion is one-shot entrance choreography (springs, ~150-900ms stagger)
 * — nothing loops, per the standing motion law. Every fill is a token; the
 * only rgba literal is the sanctioned progress track on the cream card.
 *
 * Flows unchanged: Get started / Skip → /onboarding, sign-in → /auth/sign-in.
 */

const MASCOT = require('../../assets/images/mascot.png');

/** Circular badge geometry: text path radius inside a 128px sticker. */
const BADGE = 128;
const BADGE_TEXT_R = 50;
const BADGE_CIRCLE_D = [
  `M ${BADGE / 2},${BADGE / 2}`,
  `m -${BADGE_TEXT_R},0`,
  `a ${BADGE_TEXT_R},${BADGE_TEXT_R} 0 1,1 ${BADGE_TEXT_R * 2},0`,
  `a ${BADGE_TEXT_R},${BADGE_TEXT_R} 0 1,1 -${BADGE_TEXT_R * 2},0`,
].join(' ');

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  // OEM 3-button builds can report insets.bottom=0 under edge-to-edge; the
  // clearance hook falls back to the 48dp bar so the CTA stack stays tappable.
  const bottomClearance = useBottomClearance();

  const start = () => router.push('/onboarding');
  const signIn = () => router.push('/auth/sign-in');

  return (
    <View style={styles.root}>
      {/* Organic darker-red shapes behind everything — solid fills, no blur. */}
      <View pointerEvents="none" style={styles.shapeTop} />
      <View pointerEvents="none" style={styles.shapeSide} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + spacing.md, paddingBottom: bottomClearance + spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.column}>
          {/* Top bar: wordmark + Skip. */}
          <Animated.View entering={nativeOnly(FadeInDown.duration(300))} style={styles.topBar}>
            <AppText variant="label" color={colors.onBlock}>
              GYM TRACKER
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip intro and start setup"
              hitSlop={12}
              onPress={start}
              style={styles.skip}
            >
              <AppText variant="bodyBold" color={colors.onBlock}>
                Skip
              </AppText>
              <Ionicons name="arrow-forward" size={16} color={colors.onBlock} />
            </Pressable>
          </Animated.View>

          {/* Sticker collage. Decorative preview — one a11y summary, details hidden. */}
          <View
            accessible
            accessibilityLabel="Preview stickers: your next workout, weekly focus and progress live here."
            style={styles.collage}
          >
            <View importantForAccessibility="no-hide-descendants" style={styles.collageInner}>
              {/* Charcoal "next workout" sticker — tilted right. */}
              <Animated.View
                entering={nativeOnly(FadeInDown.springify().damping(14).delay(150))}
                style={styles.glassCard}
              >
                <View style={styles.glassIcon}>
                  <Ionicons name="flash" size={18} color={colors.onBlock} />
                </View>
                <View style={styles.glassBody}>
                  <AppText variant="bodyBold" color={colors.text}>
                    Push Day
                  </AppText>
                  <AppText variant="caption" color={colors.textDim}>
                    5 exercises · ~45 min
                  </AppText>
                  <View style={styles.glassBarRow}>
                    <ProgressBar
                      value={0.24}
                      height={6}
                      trackColor={colors.surfaceRaised}
                      fillColor={colors.accent}
                      style={styles.glassBar}
                    />
                    <AppText variant="caption" color={colors.text}>
                      24%
                    </AppText>
                  </View>
                </View>
              </Animated.View>

              {/* Cream focus card — tilted left, overlapping. */}
              <Animated.View
                entering={nativeOnly(FadeInUp.springify().damping(14).delay(280))}
                style={styles.creamCard}
              >
                <View style={styles.creamTop}>
                  <View style={styles.chipRow}>
                    <View style={styles.chip}>
                      <AppText variant="label" color={colors.onBlock}>
                        TRAIN
                      </AppText>
                    </View>
                    <View style={styles.chip}>
                      <AppText variant="label" color={colors.onBlock}>
                        EAT
                      </AppText>
                    </View>
                  </View>
                  <View style={styles.arrowChip}>
                    <Ionicons name="arrow-forward" size={14} color={colors.blockCream} />
                  </View>
                </View>
                <AppText variant="bodyBold" color={colors.onBlock} style={styles.creamTitle}>
                  Focus: Push Week
                </AppText>
                <View style={styles.creamBottom}>
                  <AppText variant="caption" color={colors.creamDim}>
                    Week 3 · Day 4
                  </AppText>
                  <Ring
                    progress={0.72}
                    size={44}
                    strokeWidth={5}
                    color={colors.onBlock}
                    trackColor="rgba(0,0,0,0.15)" // sanctioned: track on a cream block
                    delay={600}
                  />
                </View>
              </Animated.View>

              {/* Circular-text badge with Newie at the center. */}
              <Animated.View
                entering={nativeOnly(ZoomIn.springify().damping(12).delay(420))}
                style={styles.badge}
              >
                <Svg width={BADGE} height={BADGE} viewBox={`0 0 ${BADGE} ${BADGE}`}>
                  <Defs>
                    <Path id="badgeCircle" d={BADGE_CIRCLE_D} />
                  </Defs>
                  <SvgText fill={colors.onBlock} fontSize="11" fontWeight="700" letterSpacing="2.5">
                    <TextPath href="#badgeCircle" startOffset="0">
                      GET STARTED FREE · TRAIN · EAT · GROW ·
                    </TextPath>
                  </SvgText>
                </Svg>
                <View style={styles.badgeCenter}>
                  <Image
                    source={MASCOT}
                    style={styles.badgeMascot}
                    contentFit="cover"
                    accessibilityLabel="Newie, your coach"
                  />
                </View>
              </Animated.View>
            </View>
          </View>

          {/* Headline — huge black Oswald with an outlined pill word and an
              inline Newie chip, reference-style. Read as one sentence. */}
          <View
            accessible
            accessibilityLabel="Take control of your training."
            style={styles.headline}
          >
            <View importantForAccessibility="no-hide-descendants">
              <Animated.View entering={nativeOnly(FadeInUp.springify().delay(520))} style={styles.hRow}>
                <AppText variant="display" color={colors.onBlock} style={styles.hText}>
                  Take{' '}
                </AppText>
                <View style={styles.oval}>
                  <AppText variant="display" color={colors.onBlock} style={styles.hText}>
                    control
                  </AppText>
                </View>
              </Animated.View>
              <Animated.View entering={nativeOnly(FadeInUp.springify().delay(620))} style={styles.hRow}>
                <AppText variant="display" color={colors.onBlock} style={styles.hText}>
                  of{' '}
                </AppText>
                <View style={styles.faceChip}>
                  <Image source={MASCOT} style={styles.faceImg} contentFit="cover" />
                </View>
                <AppText variant="display" color={colors.onBlock} style={styles.hText}>
                  {' '}your
                </AppText>
              </Animated.View>
              <Animated.View entering={nativeOnly(FadeInUp.springify().delay(720))}>
                <AppText variant="display" color={colors.onBlock} style={styles.hText}>
                  training.
                </AppText>
              </Animated.View>
            </View>
          </View>

          <Animated.View entering={nativeOnly(FadeIn.delay(800))}>
            <AppText variant="body" color={colors.onBlock} style={styles.tagline}>
              Workouts, food and progress — one app, one coach.
            </AppText>
          </Animated.View>

          {/* CTA stack. */}
          <Animated.View entering={nativeOnly(FadeInUp.springify().delay(880))} style={styles.actions}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Get started — about 2 minutes to set up"
              pressScale={0.98}
              onPress={start}
              style={styles.cta}
            >
              <AppText variant="bodyBold" color={colors.onBlock}>
                Get started
              </AppText>
              <View style={styles.ctaArrow}>
                <Ionicons name="arrow-forward" size={20} color={colors.blockCream} />
              </View>
            </PressableScale>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I already have an account — sign in"
              hitSlop={8}
              onPress={signIn}
              style={styles.signIn}
            >
              <AppText variant="bodyBold" center color={colors.onBlock}>
                I already have an account
              </AppText>
            </Pressable>
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}

// Darker-red organic shapes — solid token fill (accentDim), never rgba decor.
const SHAPE = colors.accentDim;

const styles = StyleSheet.create({
  // `minHeight` makes the red poster fill a tall web viewport even when the
  // content itself is shorter. Native still relies on flex:1 as usual.
  root: { flex: 1, minHeight: '100%', backgroundColor: colors.blockRed, overflow: 'hidden' },
  scroll: { flex: 1, width: '100%', overflow: 'hidden' },
  scrollContent: { flexGrow: 1, minHeight: '100%' },

  column: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: spacing.gutter,
    flexGrow: 1,
    minHeight: '100%',
  },

  // Big soft shapes anchored off-canvas — poster depth without gradients.
  shapeTop: {
    position: 'absolute',
    top: -140,
    right: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: SHAPE,
  },
  shapeSide: {
    position: 'absolute',
    top: 240,
    left: -160,
    width: 300,
    height: 420,
    borderRadius: 150,
    transform: [{ rotate: '18deg' }],
    backgroundColor: SHAPE,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  skip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
    paddingLeft: spacing.md,
  },

  collage: { height: 316, marginTop: spacing.md },
  collageInner: { flex: 1 },

  // Charcoal sticker card (was translucent white — rgba decor is banned).
  glassCard: {
    position: 'absolute',
    top: 22,
    right: 0,
    width: 210,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
    transform: [{ rotate: '8deg' }],
  },
  glassIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassBody: { gap: 2 },
  glassBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  glassBar: { flex: 1 },

  creamCard: {
    position: 'absolute',
    top: 128,
    left: -6,
    width: 236,
    borderRadius: radius.lg,
    backgroundColor: colors.blockCream,
    padding: spacing.lg,
    gap: spacing.sm,
    transform: [{ rotate: '-8deg' }],
  },
  creamTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  chip: {
    borderWidth: 1.5,
    borderColor: colors.onBlock,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  arrowChip: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creamTitle: { marginTop: spacing.xs },
  creamBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  badge: {
    position: 'absolute',
    top: -4,
    left: 10,
    width: BADGE,
    height: BADGE,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-14deg' }],
  },
  badgeCenter: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.onBlock,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMascot: { width: '150%', height: '150%', marginTop: '18%' },

  headline: { marginTop: spacing.xl },
  // Wrap so large font scales drop the pill/chip to a new line instead of
  // clipping against the root's overflow:hidden on narrow phones.
  hRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  hText: {
    fontSize: type.size.heroTitle,
    lineHeight: Math.round(type.size.heroTitle * 1.12),
  },
  oval: {
    borderWidth: 2.5,
    borderColor: colors.onBlock,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingBottom: 2,
  },
  faceChip: {
    width: 62,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.onBlock,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceImg: { width: 46, height: 46, marginTop: 10 },

  tagline: { marginTop: spacing.md },

  actions: { marginTop: 'auto', paddingTop: spacing.xl, gap: spacing.sm },
  cta: {
    minHeight: 62,
    borderRadius: radius.full,
    backgroundColor: colors.blockCream,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  ctaArrow: {
    position: 'absolute',
    right: 8,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.onBlock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signIn: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
