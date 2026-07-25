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
  Chip,
  enterDown,
  enterFade,
  enterUp,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '../../components/ui';
import { tapHaptic } from '../../lib/haptics';
import { uid } from '../../lib/id';
import { getRepo } from '../../lib/repo';
import {
  CUSTOM_FOOD_LIMITS,
  impliedKcalMismatch,
  parseAmountInput,
  parseDateParam,
  parseMealParam,
  parseStringParam,
  toPer100,
  type NutritionBasis,
} from '../../features/nutrition/logic';
import { useFoodMemory } from '../../features/nutrition/foodMemory';
import { portionHref } from '../../features/nutrition/nav';

/**
 * Custom food form — block language (REVAMP-BRIEF): back pill → "CUSTOM FOOD"
 * ScreenHeader → default AppTextInput (filled charcoal, focus ring) → borderless
 * charcoal field rows (§11c). One primary CTA: the pinned red save pill.
 *
 * The form follows the LABEL, not our storage format. Every figure is typed,
 * not stepped (a label reads 247 kcal, and no amount of tapping a +10 stepper
 * gets you to 247), and the member picks which column of the label they are
 * copying: per 100 g or per serving. Per-serving figures are converted here,
 * so what gets stored is still the per-100 g food the rest of the app expects.
 *
 * A barcode arrives here when a scan came up empty. Filing the new food under
 * it is what stops the same packet dead-ending, and duplicating, forever.
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
  // Basis picker: which column of the label the numbers below are copied from.
  // SectionLabel above already supplies the gap, so no extra top margin.
  basisRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
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
  // Typed amount: right-aligned so a column of numbers lines up like a label.
  amount: { width: 116, textAlign: 'right' },
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

type Amounts = Record<'kcal' | 'protein' | 'carbs' | 'fat', string>;

const EMPTY_AMOUNTS: Amounts = { kcal: '', protein: '', carbs: '', fat: '' };

/** Barcodes are carried in a URL — keep only what the food record allows. */
function cleanBarcode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

export default function CustomFoodScreen() {
  const params = useLocalSearchParams<{
    meal?: string;
    date?: string;
    barcode?: string;
  }>();
  const meal = parseMealParam(params.meal);
  const date = parseDateParam(params.date);
  const barcode = cleanBarcode(parseStringParam(params.barcode));
  const rememberBarcodeFood = useFoodMemory((s) => s.rememberBarcodeFood);

  const [name, setName] = useState('');
  const [basis, setBasis] = useState<NutritionBasis>('per100');
  const [servingInput, setServingInput] = useState('');
  const [amounts, setAmounts] = useState<Amounts>(EMPTY_AMOUNTS);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);

  const perServing = basis === 'serving';
  const amountCaption = perServing ? 'per serving' : 'per 100 g';
  const serving = parseAmountInput(servingInput);

  // Sanity check runs on whatever the member typed, in whichever column they
  // typed it — the ratio is the same either way.
  const implied = impliedKcalMismatch(
    parseAmountInput(amounts.kcal) ?? 0,
    parseAmountInput(amounts.protein) ?? 0,
    parseAmountInput(amounts.carbs) ?? 0,
    parseAmountInput(amounts.fat) ?? 0,
  );

  function setAmount(key: keyof Amounts, value: string): void {
    setAmounts((a) => ({ ...a, [key]: value }));
    if (issue) setIssue(null);
  }

  function chooseBasis(next: NutritionBasis): void {
    if (next === basis) return;
    tapHaptic();
    setBasis(next);
    setIssue(null);
  }

  /** The food to save, or the one thing standing in the way of saving it. */
  function build(): { item: FoodItem } | { problem: string } {
    const trimmedName = name.trim();
    if (!trimmedName) return { problem: 'Give the food a name first.' };

    const values = {
      kcal: parseAmountInput(amounts.kcal),
      protein: parseAmountInput(amounts.protein),
      carbs: parseAmountInput(amounts.carbs),
      fat: parseAmountInput(amounts.fat),
    };
    if (
      values.kcal === null ||
      values.protein === null ||
      values.carbs === null ||
      values.fat === null ||
      serving === null
    ) {
      return { problem: 'Use numbers only, like 247 or 4.7.' };
    }
    if (values.kcal <= 0) return { problem: 'Add the calories from the label.' };
    if (perServing && serving <= 0) {
      return { problem: 'Add how many grams one serving weighs.' };
    }
    if (serving > CUSTOM_FOOD_LIMITS.servingGrams) {
      return { problem: 'That serving size looks too big. Check the label.' };
    }

    const servingGrams = serving > 0 ? serving : 0;
    const per100 = {
      kcal: toPer100(values.kcal, basis, servingGrams),
      protein: toPer100(values.protein, basis, servingGrams),
      carbs: toPer100(values.carbs, basis, servingGrams),
      fat: toPer100(values.fat, basis, servingGrams),
    };
    if (
      per100.kcal === null ||
      per100.protein === null ||
      per100.carbs === null ||
      per100.fat === null
    ) {
      return { problem: 'Add how many grams one serving weighs.' };
    }
    if (per100.kcal > CUSTOM_FOOD_LIMITS.kcalPer100) {
      return {
        problem: perServing
          ? 'Those calories work out higher than any food can be. Check the serving size.'
          : 'No food has that many calories in 100 g. Check the number.',
      };
    }
    if (
      per100.protein > CUSTOM_FOOD_LIMITS.macroPer100 ||
      per100.carbs > CUSTOM_FOOD_LIMITS.macroPer100 ||
      per100.fat > CUSTOM_FOOD_LIMITS.macroPer100
    ) {
      return {
        problem: perServing
          ? 'Protein, carbs and fat add up to more than the serving weighs. Check the serving size.'
          : 'Protein, carbs and fat are grams in 100 g, so none can be over 100.',
      };
    }

    return {
      item: {
        id: uid(),
        name: trimmedName.slice(0, CUSTOM_FOOD_LIMITS.nameChars),
        brand: null,
        source: 'custom',
        barcode,
        kcalPer100: per100.kcal,
        proteinPer100: per100.protein,
        carbsPer100: per100.carbs,
        fatPer100: per100.fat,
        servingGrams: servingGrams > 0 ? servingGrams : null,
        servingLabel: null,
      },
    };
  }

  async function save(): Promise<void> {
    if (saving) return;
    const built = build();
    if ('problem' in built) {
      setIssue(built.problem);
      return;
    }
    setSaving(true);
    setIssue(null);
    try {
      const repo = await getRepo();
      await repo.saveFood(built.item);
      // File it under the barcode that came up empty, so the next scan of this
      // packet goes straight to the portion screen instead of here again.
      if (barcode) rememberBarcodeFood(barcode, built.item.id);
      tapHaptic();
      router.replace(portionHref(built.item.id, meal, date));
    } catch {
      setIssue("Couldn't save. Try again.");
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
            barcode ? (
              <View style={styles.metaChip}>
                <AppText variant="label" color={colors.text} numberOfLines={1}>
                  Barcode {barcode}
                </AppText>
              </View>
            ) : undefined
          }
          style={styles.header}
        />

        <Animated.View entering={enterUp(0)}>
          <AppTextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (issue) setIssue(null);
            }}
            placeholder="Food name"
            autoCorrect={false}
            maxLength={CUSTOM_FOOD_LIMITS.nameChars}
            accessibilityLabel="Food name"
          />
        </Animated.View>

        <Animated.View entering={enterUp(1)}>
          <SectionLabel>Copy from the label</SectionLabel>
          <View style={styles.basisRow}>
            <Chip
              label="Per 100 g"
              selected={!perServing}
              onPress={() => chooseBasis('per100')}
            />
            <Chip
              label="Per serving"
              selected={perServing}
              onPress={() => chooseBasis('serving')}
            />
          </View>
        </Animated.View>

        <Animated.View entering={enterUp(2)} style={[styles.row, styles.servingGap]}>
          <View style={styles.fieldInfo}>
            <AppText variant="body">Serving size</AppText>
            <AppText variant="caption" color={colors.textDim}>
              {perServing ? 'grams in one serving' : 'optional, grams in one serving'}
            </AppText>
          </View>
          <AppTextInput
            value={servingInput}
            onChangeText={(t) => {
              setServingInput(t);
              if (issue) setIssue(null);
            }}
            placeholder={perServing ? '45' : ''}
            keyboardType="decimal-pad"
            autoCorrect={false}
            style={styles.amount}
            accessibilityLabel="Serving size in grams"
          />
        </Animated.View>

        <Animated.View entering={enterUp(3)} style={styles.caloriesCard}>
          <View style={styles.caloriesRow}>
            <View style={styles.fieldInfo}>
              <AppText variant="body">Calories</AppText>
              <AppText variant="caption" color={colors.textDim}>
                kcal {amountCaption}
              </AppText>
            </View>
            <AppTextInput
              value={amounts.kcal}
              onChangeText={(t) => setAmount('kcal', t)}
              placeholder="0"
              keyboardType="decimal-pad"
              autoCorrect={false}
              style={styles.amount}
              accessibilityLabel={`Calories ${amountCaption}`}
            />
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

        <Animated.View entering={enterUp(4)}>
          <SectionLabel>Macros</SectionLabel>
        </Animated.View>

        <View style={styles.rowStack}>
          {MACRO_FIELDS.map((field, i) => (
            <Animated.View key={field.key} entering={enterUp(5 + i)} style={styles.row}>
              <View style={styles.fieldInfo}>
                <View style={styles.fieldLabelRow}>
                  <View style={[styles.dot, { backgroundColor: field.color }]} />
                  <AppText variant="body">{field.label}</AppText>
                </View>
                <AppText variant="caption" color={colors.textDim}>
                  grams {amountCaption}
                </AppText>
              </View>
              <AppTextInput
                value={amounts[field.key]}
                onChangeText={(t) => setAmount(field.key, t)}
                placeholder="0"
                keyboardType="decimal-pad"
                autoCorrect={false}
                style={styles.amount}
                accessibilityLabel={`${field.label} in grams ${amountCaption}`}
              />
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      <Animated.View entering={enterUp(8)} style={styles.pinned}>
        {issue ? (
          <AppText variant="caption" color={colors.error} center style={styles.error}>
            {issue}
          </AppText>
        ) : null}
        <Button label="Save food" onPress={() => void save()} loading={saving} />
      </Animated.View>
    </Screen>
  );
}
