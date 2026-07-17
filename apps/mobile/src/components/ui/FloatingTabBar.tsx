import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { tapHaptic } from '../../lib/haptics';
import { useSession } from '../../features/training/session';

/**
 * Floating tab bar (fluid revision): a compact centered dark pill floating
 * above the bottom inset. Icon-only items — ONE physical signal-red disc
 * slides between tabs on a spring, squashing along its travel axis while it
 * moves and settling with a soft overshoot (fluid-drop feel). Icon ink
 * crossfades in sync with the disc's arrival. Long-press keeps the per-tab
 * quick action. A small red dot marks a live workout session on Train.
 * No glow, no border — the pill separates from the canvas by fill contrast
 * alone (brief §9). Honors the system reduce-motion setting.
 */

export const TAB_ICONS: Record<
  string,
  { active: ComponentProps<typeof Ionicons>['name']; idle: ComponentProps<typeof Ionicons>['name'] }
> = {
  index: { active: 'home', idle: 'home-outline' },
  train: { active: 'barbell', idle: 'barbell-outline' },
  food: { active: 'restaurant', idle: 'restaurant-outline' },
  progress: { active: 'trending-up', idle: 'trending-up-outline' },
};

const QUICK_ACTIONS: Record<string, string> = {
  index: '/settings',
  train: '/workout/start',
  food: '/food/search',
  progress: '/body/log-weight',
};

const BAR_H = 60;
/** Active-state disc — meets the 44dp+ target inside the 56dp item. */
const CIRCLE = 44;
/** Per-tab touch target width (≥48dp floor). */
const ITEM_W = 56;
/** The pill floats this far above the bottom safe-area inset. */
const FLOAT_GAP = 16;

/** Space consumed by the bar — screens pad bottom by this. */
export const FLOATING_TAB_SPACE = 96;

/** Disc travel: settles with a soft overshoot. */
const TRAVEL_SPRING = { damping: 18, stiffness: 220, mass: 0.8 };
const PRESS_SPRING = { damping: 22, stiffness: 420, mass: 0.6 };
/** Ink crossfade tracks the disc's arrival, slightly quicker than the travel. */
const INK_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
  },
  disc: {
    position: 'absolute',
    left: spacing.sm + (ITEM_W - CIRCLE) / 2,
    top: (BAR_H - CIRCLE) / 2,
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: colors.accent,
  },
  item: {
    width: ITEM_W,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
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
    top: (BAR_H - CIRCLE) / 2 + 1,
    right: (ITEM_W - CIRCLE) / 2 + 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
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
  icons: { active: ComponentProps<typeof Ionicons>['name']; idle: ComponentProps<typeof Ionicons>['name'] };
  label: string;
  showLiveDot: boolean;
  /** What the dot means, for the accessibility label (e.g. "workout in
   * progress", "unread messages") — only read when showLiveDot is true. */
  dotHint: string;
  reduceMotion: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function TabItem({
  focused,
  icons,
  label,
  showLiveDot,
  dotHint,
  reduceMotion,
  onPress,
  onLongPress,
}: TabItemProps) {
  const active = useSharedValue(focused ? 1 : 0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    active.value = reduceMotion
      ? (focused ? 1 : 0)
      : withTiming(focused ? 1 : 0, INK_TIMING);
  }, [focused, active, reduceMotion]);

  // Crossfading two stacked icons avoids animating a vector-icon color prop.
  // The active layer also lands with a tiny pop so the arrival reads physical.
  const idleIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - active.value,
  }));
  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ scale: interpolate(active.value, [0, 0.6, 1], [0.8, 1.12, 1]) }],
  }));
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.08 }],
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
      style={styles.item}
    >
      <Animated.View style={[styles.iconStack, pressStyle]}>
        <Animated.View style={[styles.iconLayer, idleIconStyle]}>
          <Ionicons name={icons.idle} size={22} color={colors.textDim} />
        </Animated.View>
        <Animated.View style={[styles.iconLayer, activeIconStyle]}>
          <Ionicons name={icons.active} size={22} color={colors.onBlock} />
        </Animated.View>
      </Animated.View>
      {showLiveDot && !focused ? <View style={styles.liveDot} pointerEvents="none" /> : null}
    </Pressable>
  );
}

/**
 * The single red disc that physically slides under the active tab. While it
 * travels it squashes toward its motion axis (scaleX up / scaleY down) and
 * relaxes as the spring settles — driven by the distance between the sprung
 * position and its target, so the deformation is exactly zero at rest.
 */
function SlidingDisc({ index, reduceMotion }: { index: number; reduceMotion: boolean }) {
  const target = useSharedValue(index * ITEM_W);
  const sprung = useDerivedValue(() =>
    reduceMotion ? target.value : withSpring(target.value, TRAVEL_SPRING),
  );

  useEffect(() => {
    target.value = index * ITEM_W;
  }, [index, target]);

  const discStyle = useAnimatedStyle(() => {
    // 0 at rest → 1 at one full tab of remaining travel.
    const strain = Math.min(Math.abs(target.value - sprung.value) / ITEM_W, 1);
    return {
      transform: [
        { translateX: sprung.value },
        { scaleX: 1 + strain * 0.35 },
        { scaleY: 1 - strain * 0.22 },
      ],
    };
  });

  return <Animated.View pointerEvents="none" style={[styles.disc, discStyle]} />;
}

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  // Live-workout marker on the Train tab — visible from any other tab.
  const sessionActive = useSession((s) => s.status === 'active');

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + FLOAT_GAP }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        <SlidingDisc index={state.index} reduceMotion={reduceMotion} />
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
                  tapHaptic();
                  navigation.navigate(route.name);
                }
              }}
              onLongPress={() => {
                if (quickRoute) {
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
