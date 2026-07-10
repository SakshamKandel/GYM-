import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import type { FoodItem } from '@gym/shared';
import {
  AppText,
  AppTextInput,
  Button,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
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

/**
 * Custom food form — block language (REVAMP-BRIEF): back pill → "CUSTOM FOOD"
 * ScreenHeader with a "per 100 g" meta chip → default AppTextInput (filled
 * charcoal, focus ring) → borderless charcoal field rows (§11c) with steppers.
 * The kcal-vs-macros sanity check renders as a red-text row inside the
 * calories card. One primary CTA: the pinned red save pill.
 */

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    // Screen already adds insets.top + 16 of air — keep the extra nudge tiny.
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.xl },
  // Meta chip on dark (brief §6): outlined pill — chips MAY carry borders,
  // the no-border law is for cards. Informational, not pressable.
  metaChip: {
    minHeight: 34,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  // Borderless charcoal field rows (brief §11c): fill contrast + gaps between
  // rounded rows replace hairline dividers.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  // Calories card is a column so the mismatch row can span the full width.
  caloriesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  caloriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touch.min,
  },
  rowStack: { gap: spacing.sm },
  servingGap: { marginTop: spacing.md },
  fieldInfo: { flexShrink: 1 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  mismatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mismatchText: { flexShrink: 1 },
  // paddingBottom keeps the button off the screen edge when insets.bottom is 0 (web).
  pinned: { marginTop: 'auto', paddingTop: spacing.md, paddingBottom: spacing.md },
  error: { marginBottom: spacing.sm },
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
  const [error, setError] = useState(false);

  const implied = impliedKcalMismatch(kcal, macros.protein, macros.carbs, macros.fat);
  const canSave = name.trim().length > 0 && kcal > 0;

  async function save(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    setError(false);
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
      setError(true);
      setSaving(false);
    }
  }

  return (
    <Screen keyboardAware>
      <Animated.View entering={enterDown(0)} style={styles.backRow}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="New food"
          title="Custom food"
          meta={
            <View style={styles.metaChip}>
              <AppText variant="label" color={colors.text}>
                Per 100 g
              </AppText>
            </View>
          }
          style={styles.header}
        />

        <Animated.View entering={enterUp(0)}>
          <AppTextInput
            value={name}
            onChangeText={setName}
            placeholder="Food name"
            autoCorrect={false}
            accessibilityLabel="Food name"
          />
        </Animated.View>

        <Animated.View entering={enterUp(1)} style={styles.caloriesCard}>
          <View style={styles.caloriesRow}>
            <View style={styles.fieldInfo}>
              <AppText variant="body">Calories</AppText>
              <AppText variant="caption" color={colors.textDim}>
                kcal per 100 g
              </AppText>
            </View>
            <Stepper value={kcal} onChange={setKcal} step={10} min={0} max={900} />
          </View>
          {implied !== null ? (
            <Animated.View entering={enterFade(0)} style={styles.mismatchRow}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <AppText
                variant="body"
                color={colors.error}
                tabular
                style={styles.mismatchText}
              >
                macros imply {implied} kcal
              </AppText>
            </Animated.View>
          ) : null}
        </Animated.View>

        <Animated.View entering={enterUp(2)}>
          <SectionLabel>Macros</SectionLabel>
        </Animated.View>

        <View style={styles.rowStack}>
          {MACRO_FIELDS.map((field, i) => (
            <Animated.View key={field.key} entering={enterUp(3 + i)} style={styles.row}>
              <View style={styles.fieldInfo}>
                <View style={styles.fieldLabelRow}>
                  <View style={[styles.dot, { backgroundColor: field.color }]} />
                  <AppText variant="body">{field.label}</AppText>
                </View>
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
        </View>

        <Animated.View entering={enterUp(6)} style={[styles.row, styles.servingGap]}>
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

      <Animated.View entering={enterUp(7)} style={styles.pinned}>
        {error ? (
          <AppText variant="caption" color={colors.error} center style={styles.error}>
            {"Couldn't save — try again."}
          </AppText>
        ) : null}
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
