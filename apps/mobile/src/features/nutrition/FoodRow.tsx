import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@gym/ui-tokens';
import type { FoodItem } from '@gym/shared';
import { AppText } from '../../components/ui/AppText';
import { PressableScale } from '../../components/ui/PressableScale';
import { Tag } from '../../components/ui/Tag';
import { sourceTagLabel } from './logic';

/** Search/recents result row: name, brand · kcal/100g, macro caption, source tag. */

interface Props {
  item: FoodItem;
  onPress: (item: FoodItem) => void;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  info: { flex: 1, gap: 1 },
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
      <View style={styles.info}>
        <AppText variant="bodyBold" numberOfLines={1}>
          {item.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {sub}
        </AppText>
        <AppText variant="caption" color={colors.textFaint} tabular>
          {macros}
        </AppText>
      </View>
      {tag !== null ? <Tag label={tag} variant="dim" /> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </PressableScale>
  );
}
