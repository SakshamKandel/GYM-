import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GYM_AMENITIES, GYM_CATEGORIES } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, Button, Chip, PressableScale, SectionLabel } from '../../../components/ui';
import { amenityLabel } from '../amenities';

const RADIUS_OPTIONS = [1, 3, 5, 10, 20];

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.gutter,
    gap: spacing.lg,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});

export interface GymFilterState {
  radiusKm: number | null;
  category: string | null;
  amenities: string[];
  openNow: boolean;
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
  const [radiusKm, setRadiusKm] = useState<number | null>(initialState.radiusKm);
  const [category, setCategory] = useState<string | null>(initialState.category);
  const [amenities, setAmenities] = useState<string[]>(initialState.amenities);
  const [openNow, setOpenNow] = useState<boolean>(initialState.openNow);

  if (!visible) return null;

  function toggleAmenity(a: string) {
    if (amenities.includes(a)) {
      setAmenities(amenities.filter((item) => item !== a));
    } else {
      setAmenities([...amenities, a]);
    }
  }

  function handleReset() {
    setRadiusKm(null);
    setCategory(null);
    setAmenities([]);
    setOpenNow(false);
  }

  function handleApply() {
    onApply({ radiusKm, category, amenities, openNow });
    onClose();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <AppText variant="title">Filter Nearby Gyms</AppText>
            <PressableScale accessibilityRole="button" accessibilityLabel="Close filter" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </PressableScale>
          </View>

          <ScrollView contentContainerStyle={{ gap: spacing.lg }}>
            {/* Open Now toggle */}
            <View>
              <SectionLabel>Status</SectionLabel>
              <Chip label="Open Now Only" selected={openNow} onPress={() => setOpenNow(!openNow)} />
            </View>

            {/* Distance radius */}
            <View>
              <SectionLabel>Distance Radius</SectionLabel>
              <View style={styles.chipRow}>
                <Chip label="Any Distance" selected={radiusKm === null} onPress={() => setRadiusKm(null)} />
                {RADIUS_OPTIONS.map((r) => (
                  <Chip key={r} label={`Within ${r} km`} selected={radiusKm === r} onPress={() => setRadiusKm(r)} />
                ))}
              </View>
            </View>

            {/* Category */}
            <View>
              <SectionLabel>Category</SectionLabel>
              <View style={styles.chipRow}>
                <Chip label="All Categories" selected={category === null} onPress={() => setCategory(null)} />
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

            {/* Amenities */}
            <View>
              <SectionLabel>Amenities & Facilities</SectionLabel>
              <View style={styles.chipRow}>
                {GYM_AMENITIES.map((a) => {
                  const active = amenities.includes(a);
                  return <Chip key={a} label={amenityLabel(a)} selected={active} onPress={() => toggleAmenity(a)} />;
                })}
              </View>
            </View>
          </ScrollView>

          <View style={styles.actionsRow}>
            <View style={{ flex: 1 }}>
              <Button label="Reset All" variant="secondary" onPress={handleReset} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Apply Filters" variant="primary" onPress={handleApply} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
