import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { GYM_CATEGORIES } from '@gym/shared';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, Button, Chip, SectionLabel, Sheet } from '../../../components/ui';
import { useGymDistancesKnown } from '../location';
import { pushPath } from '../nav';

/**
 * Filters for the nearby-gyms list. Built on the shared `Sheet` so it inherits
 * drag-to-dismiss, keyboard avoidance and the bottom system-bar clearance —
 * "Reset all"/"Apply filters" used to sit under the Android 3-button bar.
 *
 * Only filters the list can actually apply live here: the list payload
 * (`gymPublicCardSchema`) carries category and distance, but NOT amenities or
 * opening hours, so an "Amenities"/"Open now" chip would have silently done
 * nothing. Those belong here again once the list card carries that data.
 *
 * Distance is the same rule, and it is a live one: the radius chips only appear
 * while the loaded list actually carries distances (features/gyms/location.ts).
 * Otherwise every gym has no distance to compare, "Within 5 km" matches the
 * whole list, and the member is left with a filter that lights up and changes
 * nothing. In that state the section says what it needs instead, and any radius
 * already chosen is dropped rather than left sitting there doing nothing.
 */

const RADIUS_OPTIONS = [1, 3, 5, 10, 20];

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  scrollContent: { gap: spacing.lg, paddingBottom: spacing.md },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  note: { gap: spacing.md, alignItems: 'flex-start' },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  action: { flex: 1 },
});

export interface GymFilterState {
  radiusKm: number | null;
  category: string | null;
}

export function GymFilterModal({
  visible,
  onClose,
  initialState,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  initialState: GymFilterState;
  onApply: (state: GymFilterState) => void;
}) {
  const distancesKnown = useGymDistancesKnown();
  const [radiusKm, setRadiusKm] = useState<number | null>(initialState.radiusKm);
  const [category, setCategory] = useState<string | null>(initialState.category);
  // A radius the list can no longer honour is cleared, so "Apply filters" can
  // never send back a distance rule that quietly matches everything.
  useEffect(() => {
    if (!distancesKnown) setRadiusKm(null);
  }, [distancesKnown]);
  const appliedRadiusKm = distancesKnown ? radiusKm : null;

  if (!visible) return null;

  function handleReset() {
    setRadiusKm(null);
    setCategory(null);
  }

  function handleApply() {
    onApply({ radiusKm: appliedRadiusKm, category });
    onClose();
  }

  function handleAddAddress() {
    onClose();
    pushPath('/addresses');
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter nearby gyms">
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Distance radius — offered only while distances are known. */}
        <View>
          <SectionLabel>Distance</SectionLabel>
          {distancesKnown ? (
            <View style={styles.chipRow}>
              <Chip label="Any distance" selected={radiusKm === null} onPress={() => setRadiusKm(null)} />
              {RADIUS_OPTIONS.map((r) => (
                <Chip key={r} label={`Within ${r} km`} selected={radiusKm === r} onPress={() => setRadiusKm(r)} />
              ))}
            </View>
          ) : (
            <View style={styles.note}>
              <AppText variant="body" color={colors.textDim}>
                We need somewhere to measure from before we can filter by distance. Pin one of your
                saved addresses on the map and gyms will show how far away they are.
              </AppText>
              <Button label="Open saved addresses" variant="secondary" onPress={handleAddAddress} />
            </View>
          )}
        </View>

        {/* Category */}
        <View>
          <SectionLabel>Category</SectionLabel>
          <View style={styles.chipRow}>
            <Chip label="All categories" selected={category === null} onPress={() => setCategory(null)} />
            {GYM_CATEGORIES.map((cat) => (
              <Chip
                key={cat}
                label={cat.replace(/_/g, ' ')}
                selected={category === cat}
                onPress={() => setCategory(cat)}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.actionsRow}>
        <View style={styles.action}>
          <Button label="Reset all" variant="secondary" onPress={handleReset} />
        </View>
        <View style={styles.action}>
          <Button label="Apply filters" variant="primary" onPress={handleApply} />
        </View>
      </View>
    </Sheet>
  );
}
