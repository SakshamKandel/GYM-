import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import type { FoodItem } from '@gym/shared';
import { AppText } from '../../components/ui/AppText';
import { IconChip } from '../../components/ui/IconChip';
import { PressableScale } from '../../components/ui/PressableScale';
import { Tag } from '../../components/ui/Tag';
import { sourceTagLabel } from './logic';

/**
 * Search/recents result row — a rounded charcoal tile in the block language
 * (brief §11c): icon-chip anchor, name + brand/macros, kcal per 100 g in
 * Oswald on the right rail. Rows in a stack are separated by gaps, never
 * hairline dividers.
 */

interface Props {
  item: FoodItem;
  onPress: (item: FoodItem) => void;
}

/** Presentational anchor: where a food item comes from, as an icon. */
const SOURCE_ICONS: Record<FoodItem['source'], ComponentProps<typeof Ionicons>['name']> = {
  off: 'barcode-outline',
  usda: 'library-outline',
  custom: 'create-outline',
  seed: 'nutrition-outline',
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  info: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flexShrink: 1 },
  kcalCol: { alignItems: 'flex-end', flexShrink: 0, gap: 2 },
  kcal: { fontFamily: type.display, fontSize: 18, color: colors.text },
});

export function FoodRow({ item, onPress }: Props) {
  const sub = `${item.brand ? `${item.brand} · ` : ''}${Math.round(item.kcalPer100)} kcal/100g`;
  const macros = `P ${Math.round(item.proteinPer100)} · C ${Math.round(item.carbsPer100)} · F ${Math.round(item.fatPer100)}`;
  const tag = sourceTagLabel(item.source);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${sub}`}
      onPress={() => onPress(item)}
      style={styles.row}
    >
      <IconChip icon={SOURCE_ICONS[item.source]} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <AppText variant="bodyBold" numberOfLines={1} style={styles.name}>
            {item.name}
          </AppText>
          {tag !== null ? <Tag label={tag} variant="dim" /> : null}
        </View>
        <AppText variant="caption" numberOfLines={1} tabular>
          {item.brand ? `${item.brand} · ${macros}` : macros}
        </AppText>
      </View>
      <View style={styles.kcalCol}>
        <AppText style={styles.kcal} tabular>
          {Math.round(item.kcalPer100)}
        </AppText>
        <AppText variant="caption" color={colors.textFaint} tabular={false}>
          kcal/100g
        </AppText>
      </View>
    </PressableScale>
  );
}
