import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import type { FoodItem } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Divider,
  enterDown,
  enterFade,
  enterUp,
  IconChip,
  layoutSpring,
  PressableScale,
  Screen,
  SectionLabel,
} from '../../components/ui';
import { tapHaptic } from '../../lib/haptics';
import { getRepo } from '../../lib/repo';
import { FoodRow } from '../../features/nutrition/FoodRow';
import { parseDateParam, parseMealParam } from '../../features/nutrition/logic';
import { customHref, portionHref, scanHref } from '../../features/nutrition/nav';
import { useFoodSearch, useRecentFoods } from '../../features/nutrition/useFoodSearch';

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // Screen already adds insets.top + 16 of air — keep the extra nudge tiny.
    marginTop: spacing.xs,
  },
  iconBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: { flex: 1, justifyContent: 'center' },
  input: {
    minHeight: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    paddingLeft: spacing.lg,
    // Room for the clear button so long queries never run under it.
    paddingRight: 44,
  },
  clearWrap: { position: 'absolute', right: 4, top: 0, bottom: 0, width: 40 },
  clearBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.xxl },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.min,
  },
});

export default function FoodSearchScreen() {
  const params = useLocalSearchParams<{ meal?: string; date?: string }>();
  const meal = parseMealParam(params.meal);
  const date = parseDateParam(params.date);

  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;
  const { local, remote, loading, error } = useFoodSearch(query);
  const { recent, loaded: recentLoaded } = useRecentFoods(12);
  const [saving, setSaving] = useState(false);

  async function pick(item: FoodItem): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const repo = await getRepo();
      await repo.saveFood(item);
      router.push(portionHref(item.id, meal, date));
    } finally {
      setSaving(false);
    }
  }

  const customRow = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Create custom food"
      onPress={() => router.push(customHref(meal, date))}
      style={styles.ghostRow}
    >
      <IconChip icon="add" />
      <AppText variant="bodyBold" color={colors.textDim}>
        Create custom food
      </AppText>
    </PressableScale>
  );

  return (
    <Screen keyboardAware>
      <Animated.View entering={enterDown(0)} style={styles.headerRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={styles.inputWrap}>
          <AppTextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search foods…"
            returnKeyType="search"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Search foods"
          />
          {query.length > 0 ? (
            <Animated.View entering={enterFade(0)} style={styles.clearWrap}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={{ top: 4, bottom: 4, left: 6, right: 6 }}
                onPress={() => {
                  tapHaptic();
                  setQuery('');
                }}
                style={styles.clearBtn}
              >
                <Ionicons name="close-circle" size={20} color={colors.textFaint} />
              </PressableScale>
            </Animated.View>
          ) : null}
        </View>
        {Platform.OS !== 'web' ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Scan barcode"
            onPress={() => {
              router.push(scanHref(meal, date));
            }}
            style={styles.iconBtn}
          >
            <Ionicons name="barcode-outline" size={24} color={colors.text} />
          </PressableScale>
        ) : null}
      </Animated.View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {searching ? (
          <Animated.View key="results" entering={enterFade(0)}>
            {local.length > 0 ? (
              <>
                <SectionLabel>My foods</SectionLabel>
                {local.map((item, i) => (
                  <Animated.View key={item.id} entering={enterUp(0)} layout={layoutSpring}>
                    {i > 0 ? <Divider /> : null}
                    <FoodRow item={item} onPress={(f) => void pick(f)} />
                  </Animated.View>
                ))}
              </>
            ) : null}
            <SectionLabel>Results</SectionLabel>
            {loading ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.textDim} />
                <AppText variant="caption" color={colors.textDim}>
                  Searching…
                </AppText>
              </View>
            ) : null}
            {error ? (
              <View style={styles.statusRow}>
                <AppText variant="caption" color={colors.textDim}>
                  Couldn&apos;t reach food database — check connection
                </AppText>
              </View>
            ) : null}
            {!loading && !error && remote.length === 0 && local.length === 0 ? (
              <View style={styles.statusRow}>
                <AppText variant="caption" color={colors.textDim}>
                  No matches — try a simpler name
                </AppText>
              </View>
            ) : null}
            {remote.map((item, i) => (
              <Animated.View key={item.id} entering={enterUp(0)} layout={layoutSpring}>
                {i > 0 ? <Divider /> : null}
                <FoodRow item={item} onPress={(f) => void pick(f)} />
              </Animated.View>
            ))}
            <Divider />
            {customRow}
          </Animated.View>
        ) : (
          <Animated.View key="recent" entering={enterFade(0)}>
            <SectionLabel>Recent</SectionLabel>
            {recentLoaded && recent.length === 0 ? (
              <AppText variant="caption" color={colors.textDim}>
                Foods you log will appear here
              </AppText>
            ) : null}
            {recent.map((item, i) => (
              <Animated.View key={item.id} entering={enterUp(Math.min(i, 6))} layout={layoutSpring}>
                {i > 0 ? <Divider /> : null}
                <FoodRow item={item} onPress={(f) => void pick(f)} />
              </Animated.View>
            ))}
            <Divider />
            {customRow}
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}
