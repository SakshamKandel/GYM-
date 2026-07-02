import type { ComponentProps } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type } from '@gym/ui-tokens';

/**
 * Floating tab bar. ONE tinted pill glides between tabs (240ms ease-out
 * slide — no pop, no scale). Every tab shows icon + label; 5 tabs:
 * Home · Train · Food · Progress · Buddy.
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

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    height: 72,
    width: '94%',
    maxWidth: 440,
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    height: 60,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  /** The single sliding pill (tinted red — icons/labels carry the accent). */
  pill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.full,
    backgroundColor: colors.accentFaint,
  },
  label: {
    fontFamily: type.bodyMedium,
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
  labelActive: { fontFamily: type.bodySemiBold },
});

/** Height consumed by the floating bar — screens add this to bottom padding. */
export const FLOATING_TAB_SPACE = 100;

const SLIDE = { duration: 240, easing: Easing.bezier(0.16, 1, 0.3, 1) };

export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [innerWidth, setInnerWidth] = useState(0);
  const count = Math.max(1, state.routes.length);
  const tabWidth = innerWidth > 0 ? innerWidth / count : 0;

  const pillX = useSharedValue(0);
  const mounted = useRef(false);
  useEffect(() => {
    if (tabWidth <= 0) return;
    const target = state.index * tabWidth;
    if (!mounted.current) {
      // First layout: place the pill without a slide-in from the far left.
      pillX.value = target;
      mounted.current = true;
    } else {
      pillX.value = withTiming(target, SLIDE);
    }
  }, [state.index, tabWidth, pillX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={styles.bar}>
        <View
          style={styles.inner}
          onLayout={(e) => setInnerWidth(e.nativeEvent.layout.width)}
        >
          {tabWidth > 0 ? (
            <Animated.View style={[styles.pill, { width: tabWidth }, pillStyle]} />
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
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
                style={styles.tab}
              >
                <Ionicons
                  name={focused ? icons.active : icons.idle}
                  size={21}
                  color={focused ? colors.accent : colors.textDim}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    focused && styles.labelActive,
                    { color: focused ? colors.accent : colors.textDim },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
