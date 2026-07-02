import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch, type } from '@gym/ui-tokens';
import type { FoodItem } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Button,
  enterDown,
  enterUp,
  PressableScale,
  Screen,
  Stepper,
} from '../../components/ui';
import { tapHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import {
  impliedKcalMismatch,
  parseDateParam,
  parseMealParam,
} from '../../features/nutrition/logic';
import { portionHref } from '../../features/nutrition/nav';

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  input: {
    marginTop: spacing.sm,
    minHeight: touch.min,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  fieldInfo: { flexShrink: 1 },
  mismatch: { marginTop: spacing.xs },
  // paddingBottom keeps the button off the screen edge when insets.bottom is 0 (web).
  pinned: { marginTop: 'auto', paddingTop: spacing.md, paddingBottom: spacing.md },
});

interface MacroField {
  key: 'protein' | 'carbs' | 'fat';
  label: string;
  color: string;
}

const MACRO_FIELDS: MacroField[] = [
  { key: 'protein', label: 'Protein', color: colors.protein },
  { key: 'carbs', label: 'Carbs', color: colors.carbs },
  { key: 'fat', label: 'Fat', color: colors.fat },
];

export default function CustomFoodScreen() {
  const params = useLocalSearchParams<{ meal?: string; date?: string }>();
  const meal = parseMealParam(params.meal);
  const date = parseDateParam(params.date);

  const [name, setName] = useState('');
  const [kcal, setKcal] = useState(100);
  const [macros, setMacros] = useState({ protein: 0, carbs: 0, fat: 0 });
  const [serving, setServing] = useState(0);
  const [saving, setSaving] = useState(false);

  const implied = impliedKcalMismatch(kcal, macros.protein, macros.carbs, macros.fat);
  const canSave = name.trim().length > 0 && kcal > 0;

  async function save(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const item: FoodItem = {
        id: uid(),
        name: name.trim(),
        brand: null,
        source: 'custom',
        barcode: null,
        kcalPer100: kcal,
        proteinPer100: macros.protein,
        carbsPer100: macros.carbs,
        fatPer100: macros.fat,
        servingGrams: serving > 0 ? serving : null,
        servingLabel: null,
      };
      const repo = await getRepo();
      await repo.saveFood(item);
      tapHaptic();
      router.replace(portionHref(item.id, meal, date));
    } catch {
      setSaving(false);
    }
  }

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
        <AppText variant="title">Custom food</AppText>
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterUp(0)}>
          <AppTextInput
            value={name}
            onChangeText={setName}
            placeholder="Food name"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Food name"
          />
        </Animated.View>

        <Animated.View entering={enterUp(1)} style={styles.fieldRow}>
          <View style={styles.fieldInfo}>
            <AppText variant="body">Calories</AppText>
            <AppText variant="caption" color={colors.textDim}>
              kcal per 100 g
            </AppText>
            {implied !== null ? (
              <AppText variant="caption" color={colors.textFaint} style={styles.mismatch} tabular>
                macros imply {implied} kcal
              </AppText>
            ) : null}
          </View>
          <Stepper value={kcal} onChange={setKcal} step={10} min={0} max={900} />
        </Animated.View>

        {MACRO_FIELDS.map((field, i) => (
          <Animated.View key={field.key} entering={enterUp(2 + i)} style={styles.fieldRow}>
            <View style={styles.fieldInfo}>
              <AppText variant="body">{field.label}</AppText>
              <AppText variant="caption" color={colors.textDim}>
                grams per 100 g
              </AppText>
            </View>
            <Stepper
              value={macros[field.key]}
              onChange={(next) => setMacros((m) => ({ ...m, [field.key]: next }))}
              step={1}
              min={0}
              max={100}
            />
          </Animated.View>
        ))}

        <Animated.View entering={enterUp(5)} style={styles.fieldRow}>
          <View style={styles.fieldInfo}>
            <AppText variant="body">Serving size</AppText>
            <AppText variant="caption" color={colors.textDim}>
              optional, grams per serving
            </AppText>
          </View>
          <Stepper
            value={serving}
            onChange={setServing}
            step={5}
            min={0}
            max={500}
            format={(v) => (v === 0 ? '—' : String(v))}
          />
        </Animated.View>
      </ScrollView>

      <Animated.View entering={enterUp(6)} style={styles.pinned}>
        <Button
          label="Save food"
          onPress={() => void save()}
          disabled={!canSave}
          loading={saving}
        />
      </Animated.View>
    </Screen>
  );
}
