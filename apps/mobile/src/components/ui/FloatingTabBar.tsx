import type { ComponentProps } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, type } from '@gym/ui-tokens';
import { tapHaptic } from '../../lib/haptics';

/**
 * Brand-Aligned Floating Tab Bar.
 * Reworked completely from scratch to maintain the core GYM Tracker theme.
 * Displays a floating dark capsule. The active tab is highlighted by a solid
 * signal-red active circle badge that slides smoothly behind the selected icon.
 * Active icons turn crisp white inside the circle and translate up slightly,
 * revealing an uppercase text label below the badge with perfect breathing room.
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

const BAR_H = 72; // Increased height to ensure spacious layout
const CIRCLE_SIZE = 44; // Perfect solid red circle badge

/** Space consumed by the bar — screens pad bottom by this. */
export const FLOATING_TAB_SPACE = 96; // Adjusted to match the taller tab bar height

const SLIDE_SPRING = { damping: 24, stiffness: 220, mass: 0.8 };
const FADE_SPRING = { damping: 26, stiffness: 400, mass: 0.5 };

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 8,
    right: 8,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 460,
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 36,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  circle: {
    position: 'absolute',
    top: 8, // Centered in the top 60dp of the tab bar
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: colors.accent, // Solid signal-red accent circle (no glow)
  },
  tab: {
    flex: 1,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    bottom: 6, // Positioned safely below the active circle
    fontFamily: type.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});

/* --- Per-tab: animated icon + label reveal --- */

interface TabItemProps {
  focused: boolean;
  icons: { active: ComponentProps<typeof Ionicons>['name']; idle: ComponentProps<typeof Ionicons>['name'] };
  label: string;
  onPress: () => void;
  onLongPress: () => void;
}

function TabItem({ focused, icons, label, onPress, onLongPress }: TabItemProps) {
  const active = useSharedValue(focused ? 1 : 0);
  const translateY = useSharedValue(focused ? -6 : 0);
  const scale = useSharedValue(focused ? 1.05 : 0.85);

  useEffect(() => {
    active.value = withSpring(focused ? 1 : 0, FADE_SPRING);
    translateY.value = withSpring(focused ? -6 : 0, FADE_SPRING);
    scale.value = withSpring(focused ? 1.05 : 0.85, FADE_SPRING);
  }, [focused]);

  const iconStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  const labelStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [{ translateY: (1 - active.value) * 4 }],
  }));

  // Icon is white inside the red circle badge, and dim gray when inactive
  const iconColor = focused ? colors.onAccent : colors.textFaint;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.tab,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Animated.View style={iconStyle}>
        <Ionicons name={focused ? icons.active : icons.idle} size={22} color={iconColor} />
      </Animated.View>
      <Animated.Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={[styles.label, labelStyle, { color: colors.text }]}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const count = Math.max(1, state.routes.length);
  const tabWidth = barWidth > 0 ? barWidth / count : 0;

  const circleX = useSharedValue(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (tabWidth <= 0) return;
    const circleTarget = state.index * tabWidth + (tabWidth - CIRCLE_SIZE) / 2;

    if (!mounted.current) {
      circleX.value = circleTarget;
      mounted.current = true;
    } else {
      circleX.value = withSpring(circleTarget, SLIDE_SPRING);
    }
  }, [state.index, tabWidth]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: circleX.value }],
  }));

  return (
    <View
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) }]}
      pointerEvents="box-none"
    >
      <View
        style={styles.bar}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {tabWidth > 0 ? (
          <Animated.View style={[styles.circle, circleStyle]} pointerEvents="none" />
        ) : null}

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
