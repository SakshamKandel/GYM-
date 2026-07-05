import type { ComponentProps } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '@gym/ui-tokens';
import { tapHaptic } from '../../lib/haptics';

/**
 * Floating tab bar — charcoal capsule with an expanding signal-red pill.
 *
 * Inactive tabs are calm outline icons. The active tab grows into a solid
 * red capsule holding icon + label side by side; switching tabs morphs the
 * pill across (the old one shrinks as the new one grows on the same spring),
 * so no absolute positioning or width measuring is needed. Long-press keeps
 * the per-tab quick action. No glow, no blur — flat brand surfaces only.
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

const BAR_H = 64;
const PILL_H = 48; // touch floor
/** How much wider the active tab is than an idle one. */
const ACTIVE_FLEX = 2.2;
/** Room the label can occupy inside the pill before clipping. */
const LABEL_MAX_W = 92;

/** Space consumed by the bar — screens pad bottom by this. */
export const FLOATING_TAB_SPACE = 96;

const PILL_SPRING = { damping: 26, stiffness: 260, mass: 0.9 };
const PRESS_SPRING = { damping: 22, stiffness: 420, mass: 0.6 };

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 430,
    height: BAR_H,
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: BAR_H / 2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 8,
  },
  tab: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: (BAR_H - PILL_H) / 2,
    paddingHorizontal: 3,
  },
  pill: {
    height: PILL_H,
    borderRadius: PILL_H / 2,
    flexDirection: 'row',
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
  labelClip: {
    overflow: 'hidden',
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    letterSpacing: 0.2,
    color: colors.onAccent,
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

  // The tab itself grows/shrinks; the red fill fades on the same spring, so
  // the pill reads as one shape morphing across the bar.
  const growStyle = useAnimatedStyle(() => ({
    flex: 1 + active.value * (ACTIVE_FLEX - 1),
  }));

  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      active.value,
      [0, 1],
      ['rgba(0,0,0,0)', colors.accent],
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

  // The label unclips as the pill grows; keeping it width-clipped (instead of
  // conditionally mounted) is what lets the morph stay one smooth spring.
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(active.value, [0.5, 1], [0, 1], 'clamp'),
    maxWidth: active.value * LABEL_MAX_W,
    marginLeft: active.value * 7,
  }));

  return (
    <Animated.View style={[styles.tab, growStyle]}>
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
      >
        <Animated.View style={[styles.pill, pillStyle]}>
          <View style={styles.iconStack}>
            <Animated.View style={[styles.iconLayer, idleIconStyle]}>
              <Ionicons name={icons.idle} size={22} color={colors.textFaint} />
            </Animated.View>
            <Animated.View style={[styles.iconLayer, activeIconStyle]}>
              <Ionicons name={icons.active} size={21} color={colors.onAccent} />
            </Animated.View>
          </View>
          <Animated.View style={[styles.labelClip, labelStyle]}>
            <Animated.Text numberOfLines={1} style={styles.label}>
              {label}
            </Animated.Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) }]}
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
                  navigation.navigate(quickRoute);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
