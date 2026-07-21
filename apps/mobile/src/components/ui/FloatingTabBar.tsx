import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { blurActiveElement } from '../../lib/blurActiveElement';
import { tapHaptic } from '../../lib/haptics';
import { useBottomClearance } from '../../lib/systemBars';
import { useSession } from '../../features/training/session';

/**
 * Floating tab bar — "power cells" (signature revision, OWNER DIRECTIVE
 * 2026-07-18: NO text labels anywhere in the bar — icons only. Do not re-add
 * text in any future pass).
 *
 * A floating charcoal dock holding six recessed CELLS — shallow wells sunk
 * into the surface. The active cell CHARGES: signal-red fill rises from the
 * bottom of the well on a spring (a rep meter filling), the glyph inking
 * from dim outline to solid black as the level passes it. Tapping another
 * tab drains the old cell while the new one charges — each cell owns its own
 * spring, so rapid taps overlap fluidly and never queue. Everything is
 * contained inside its own slot: nothing protrudes, nothing to misalign.
 * A red dot on Train marks a live workout. Long-press keeps the per-tab
 * quick action. No glow, no border — fill contrast only (brief §9).
 * Honors reduce-motion (cells set instantly) and is web-safe (style-driven
 * springs, fully visible initial state, no entering animations).
 */

type IconName = ComponentProps<typeof Ionicons>['name'];

export const TAB_ICONS: Record<string, { active: IconName; idle: IconName }> = {
  index: { active: 'home', idle: 'home-outline' },
  train: { active: 'barbell', idle: 'barbell-outline' },
  food: { active: 'restaurant', idle: 'restaurant-outline' },
  meals: { active: 'fast-food', idle: 'fast-food-outline' },
  gyms: { active: 'location', idle: 'location-outline' },
  progress: { active: 'trending-up', idle: 'trending-up-outline' },
};

const QUICK_ACTIONS: Record<string, string> = {
  index: '/settings',
  train: '/workout/start',
  food: '/food/search',
  meals: '/meals/orders',
  progress: '/body/log-weight',
};

const BAR_H = 60;
/** Recessed cell (well) inside each slot. */
const CELL_W = 44;
const CELL_H = 46;
const CELL_R = 14;
/** Preferred per-tab width; shrinks responsively to the 48dp floor so six
 * tabs still fit small screens without the dock clipping the edges. */
const ITEM_W_MAX = 56;
const ITEM_W_MIN = 48;
/** Minimum breathing room between the dock and each screen edge. */
const EDGE_MARGIN = 10;
/** The dock floats this far above the bottom safe-area inset. */
const FLOAT_GAP = 16;

/** Space consumed by the bar — screens pad bottom by this. */
export const FLOATING_TAB_SPACE = 96;

/** Cell charge/drain — springy fill with a soft settle; drains a touch
 * faster than it charges so attention lands on the new tab. */
const CHARGE_SPRING = { damping: 17, stiffness: 190, mass: 0.9 };
const DRAIN_SPRING = { damping: 22, stiffness: 260, mass: 0.7 };
const PRESS_SPRING = { damping: 22, stiffness: 420, mass: 0.6 };

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  bar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
  },
  item: {
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    width: CELL_W,
    height: CELL_H,
    borderRadius: CELL_R,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.accent,
  },
  iconStack: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    position: 'absolute',
    top: (BAR_H - CELL_H) / 2 + 3,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
    pointerEvents: 'none',
  },
});

interface TabBarProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<
    string,
    { options: { title?: string; tabBarLabel?: unknown } } | undefined
  >;
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

interface TabItemProps {
  focused: boolean;
  icons: { active: IconName; idle: IconName };
  label: string;
  itemW: number;
  showLiveDot: boolean;
  /** What the dot means, for the accessibility label — read when shown. */
  dotHint: string;
  reduceMotion: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function TabItem({
  focused,
  icons,
  label,
  itemW,
  showLiveDot,
  dotHint,
  reduceMotion,
  onPress,
  onLongPress,
}: TabItemProps) {
  // 0 = drained, 1 = fully charged. Each cell owns its spring, so switching
  // tabs overlaps a drain and a charge — fluid under rapid taps, never queued.
  const charge = useSharedValue(focused ? 1 : 0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    charge.value = reduceMotion
      ? (focused ? 1 : 0)
      : withSpring(focused ? 1 : 0, focused ? CHARGE_SPRING : DRAIN_SPRING);
  }, [focused, charge, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    height: interpolate(charge.value, [0, 1], [0, CELL_H]),
  }));
  // The glyph inks to solid as the level passes it (crossfade weighted to the
  // upper half of the fill) and gets a tiny lift at full charge.
  const idleIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(charge.value, [0, 0.45, 0.8], [1, 1, 0]),
  }));
  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(charge.value, [0, 0.45, 0.8], [0, 0, 1]),
    transform: [{ scale: interpolate(charge.value, [0.8, 1], [0.9, 1]) }],
  }));
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.07 }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={showLiveDot ? `${label}, ${dotHint}` : label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      onPressIn={() => {
        pressed.value = withSpring(1, PRESS_SPRING);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, PRESS_SPRING);
      }}
      style={[styles.item, { width: itemW }]}
    >
      <Animated.View style={[styles.cell, pressStyle]}>
        <Animated.View style={[styles.fill, fillStyle]} />
        <View style={styles.iconStack}>
          <Animated.View style={[styles.iconLayer, idleIconStyle]}>
            <Ionicons name={icons.idle} size={22} color={colors.textDim} />
          </Animated.View>
          <Animated.View style={[styles.iconLayer, activeIconStyle]}>
            <Ionicons name={icons.active} size={22} color={colors.onBlock} />
          </Animated.View>
        </View>
      </Animated.View>
      {showLiveDot && !focused ? <View style={styles.liveDot} /> : null}
    </Pressable>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // Live-workout marker on the Train tab — visible from any other tab.
  const sessionActive = useSession((s) => s.status === 'active');

  // Responsive item width: prefer 56dp, shrink to the 48dp floor when six
  // tabs would push the dock past the safe screen edges. Side insets honored.
  const usable =
    screenW - insets.left - insets.right - EDGE_MARGIN * 2 - spacing.sm * 2;
  const itemW = Math.max(
    ITEM_W_MIN,
    Math.min(ITEM_W_MAX, Math.floor(usable / Math.max(state.routes.length, 1))),
  );

  // Clearance above the SYSTEM navigation area. insets.bottom is the truth
  // (gesture bar ~24, 3-button bar ~48); useBottomClearance falls back to the
  // full 3-button height on Android devices that report 0 under edge-to-edge
  // (a spacing.lg floor proved too short — the 48dp bar still covered the
  // dock on OEM builds with broken inset reporting).
  const systemClearance = useBottomClearance();

  return (
    <View style={[styles.wrap, { bottom: systemClearance + FLOAT_GAP }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options ?? {};
          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : (options.title ?? route.name);
          const icons =
            TAB_ICONS[route.name] ??
            ({ active: 'ellipse', idle: 'ellipse-outline' } as const);
          const quickRoute = QUICK_ACTIONS[route.name];

          return (
            <TabItem
              key={route.key}
              focused={focused}
              icons={icons}
              label={label}
              itemW={itemW}
              showLiveDot={route.name === 'train' && sessionActive}
              dotHint="workout in progress"
              reduceMotion={reduceMotion}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  blurActiveElement();
                  tapHaptic();
                  navigation.navigate(route.name);
                }
              }}
              onLongPress={() => {
                if (quickRoute) {
                  blurActiveElement();
                  tapHaptic();
                  router.push(quickRoute as Href);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
