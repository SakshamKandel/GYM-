import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { tapHaptic } from '../../lib/haptics';

/**
 * Floating tab bar (revamp): a compact centered dark pill floating above the
 * bottom inset. Icon-only items — the ACTIVE icon sits inside a filled
 * signal-red circle (black icon on red, per the block language); inactive
 * icons stay dim. The red circle crossfades between tabs on one spring.
 * Long-press keeps the per-tab quick action. No glow, no border — the pill
 * separates from the canvas by fill contrast alone.
 */

export const TAB_ICONS: Record<
  string,
  { active: ComponentProps<typeof Ionicons>['name']; idle: ComponentProps<typeof Ionicons>['name'] }
> = {
  index: { active: 'home', idle: 'home-outline' },
  train: { active: 'barbell', idle: 'barbell-outline' },
  food: { active: 'restaurant', idle: 'restaurant-outline' },
  progress: { active: 'trending-up', idle: 'trending-up-outline' },
  buddy: { active: 'people', idle: 'people-outline' },
};

const QUICK_ACTIONS: Record<string, string> = {
  index: '/settings',
  train: '/workout/start',
  food: '/food/search',
  progress: '/body/log-weight',
  buddy: '/buddy',
};

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

const BAR_H = 60;
/** Active-state circle — meets the 44dp+ target inside the 56dp item. */
const CIRCLE = 44;
/** Per-tab touch target width (≥48dp floor). */
const ITEM_W = 56;
/** The pill floats this far above the bottom safe-area inset. */
const FLOAT_GAP = 16;

/** Space consumed by the bar — screens pad bottom by this. */
export const FLOATING_TAB_SPACE = 96;

const PILL_SPRING = { damping: 26, stiffness: 260, mass: 0.9 };
const PRESS_SPRING = { damping: 22, stiffness: 420, mass: 0.6 };

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
  item: {
    width: ITEM_W,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
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
});

interface TabItemProps {
  focused: boolean;
  icons: { active: ComponentProps<typeof Ionicons>['name']; idle: ComponentProps<typeof Ionicons>['name'] };
  label: string;
  onPress: () => void;
  onLongPress: () => void;
}

function TabItem({ focused, icons, label, onPress, onLongPress }: TabItemProps) {
  const active = useSharedValue(focused ? 1 : 0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    active.value = withSpring(focused ? 1 : 0, PILL_SPRING);
  }, [focused, active]);

  // The circle fades between the bar's own fill (invisible) and solid red on
  // one spring, so switching tabs reads as the red disc hopping across.
  const circleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      active.value,
      [0, 1],
      [colors.surfaceRaised, colors.accent],
    ),
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));

  // Crossfading two stacked icons avoids animating a vector-icon color prop.
  const idleIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - active.value,
  }));
  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: active.value,
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
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
      <Animated.View style={[styles.circle, circleStyle]}>
        <View style={styles.iconStack}>
          <Animated.View style={[styles.iconLayer, idleIconStyle]}>
            <Ionicons name={icons.idle} size={22} color={colors.textDim} />
          </Animated.View>
          <Animated.View style={[styles.iconLayer, activeIconStyle]}>
            <Ionicons name={icons.active} size={22} color={colors.onBlock} />
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + FLOAT_GAP }]}
      pointerEvents="box-none"
    >
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
