import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GymEquipmentItem } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import type { GymEquipmentCategory } from '@gym/shared';
import { AppText, Chip, PressableScale } from '../../../components/ui';

const CATEGORY_LABELS: Record<GymEquipmentCategory, string> = {
  free_weights: 'Free Weights',
  cardio: 'Cardio',
  machines: 'Machines',
  functional: 'Turf & Functional',
  recovery: 'Recovery',
};

const CATEGORY_ICONS: Record<GymEquipmentCategory, keyof typeof Ionicons.glyphMap> = {
  free_weights: 'barbell',
  cardio: 'heart',
  machines: 'hardware-chip',
  functional: 'fitness',
  recovery: 'sparkles',
};

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  categoriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  grid: { gap: spacing.sm },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: touch.min,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: { flex: 1, gap: 2 },
  countBadge: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
});

export function GymEquipmentList({ equipment }: { equipment: GymEquipmentItem[] }) {
  const [selectedCat, setSelectedCat] = useState<GymEquipmentCategory | 'all'>('all');

  const categories: (GymEquipmentCategory | 'all')[] = [
    'all',
    'free_weights',
    'cardio',
    'machines',
    'functional',
    'recovery',
  ];

  const filtered =
    selectedCat === 'all'
      ? equipment
      : equipment.filter((eq) => eq.category === selectedCat);

  return (
    <View style={styles.container}>
      {/* Category filter pills */}
      <View style={styles.categoriesRow}>
        {categories.map((cat) => {
          const isSelected = selectedCat === cat;
          const label = cat === 'all' ? 'All Equipment' : CATEGORY_LABELS[cat];
          return (
            <Chip
              key={cat}
              label={label}
              selected={isSelected}
              onPress={() => setSelectedCat(cat)}
            />
          );
        })}
      </View>

      {/* Equipment grid */}
      <View style={styles.grid}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="body" color={colors.textDim}>
              No equipment listed under this category.
            </AppText>
          </View>
        ) : (
          filtered.map((item) => {
            const iconName = CATEGORY_ICONS[item.category] ?? 'barbell';
            return (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.iconBox}>
                  <Ionicons name={iconName} size={20} color={colors.accent} />
                </View>
                <View style={styles.itemInfo}>
                  <AppText variant="bodyBold" color={colors.text}>
                    {item.name}
                  </AppText>
                  {item.description ? (
                    <AppText variant="caption" color={colors.textDim}>
                      {item.description}
                    </AppText>
                  ) : null}
                </View>
                {item.count ? (
                  <View style={styles.countBadge}>
                    <AppText variant="label" color={colors.text}>
                      x{item.count}
                    </AppText>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}
