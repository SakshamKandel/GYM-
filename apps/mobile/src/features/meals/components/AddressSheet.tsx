import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, PressableScale, Tag } from '../../../components/ui';
import { deleteAddress, saveAddress, searchGeo, toMealsError, type GeoResult, type MealAddress } from '../api';
import { mealErrorMessage } from '../logic';

/**
 * Address book CRUD + picker, shared by the one-time checkout and the
 * subscription setup flow (plan §6: "address book CRUD + default"). Lives as
 * one sheet body so both flows get the same list-or-add-new UX without
 * duplicating the form.
 */

const styles = StyleSheet.create({
  scroll: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: touch.min,
  },
  rowSelected: { backgroundColor: colors.blockRed },
  rowMain: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deleteBtn: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  addForm: { gap: spacing.sm, marginTop: spacing.sm },
  formRow: { flexDirection: 'row', gap: spacing.sm },
  formField: { flex: 1 },
  errorText: { marginTop: spacing.xs },
  addToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
  },
  geoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
  },
  pinnedText: { flex: 1 },
  geoResults: { gap: spacing.xs },
  geoResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
    paddingVertical: spacing.xs,
  },
  geoResultText: { flex: 1 },
});

interface Props {
  token: string;
  addresses: MealAddress[];
  selectedId: string | null;
  onSelect: (address: MealAddress) => void;
  onChanged: () => void;
}

export function AddressSheet({ token, addresses, selectedId, onSelect, onChanged }: Props) {
  const [adding, setAdding] = useState(addresses.length === 0);
  const [line, setLine] = useState('');
  const [area, setArea] = useState('');
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Address geocoding (courtesy, optional): a member can pin the address text
  // to a lat/lng before saving so gyms/meals distance + delivery-area features
  // have coordinates to work with — the address still saves fine without one.
  const [geoResults, setGeoResults] = useState<GeoResult[] | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<GeoResult | null>(null);

  function clearGeoState(): void {
    setGeoResults(null);
    setGeoError(null);
    setPinned(null);
  }

  function updateLine(v: string): void {
    setLine(v);
    clearGeoState();
  }

  function updateArea(v: string): void {
    setArea(v);
    clearGeoState();
  }

  function findLocation(): void {
    if (!line.trim() || geoLoading) return;
    setGeoLoading(true);
    setGeoError(null);
    setGeoResults(null);
    void (async () => {
      try {
        const q = [line.trim(), area.trim()].filter(Boolean).join(', ');
        const results = await searchGeo(token, q);
        if (results.length === 0) {
          setGeoError('No matching location found — you can still save the address without a pin.');
        }
        setGeoResults(results);
      } catch (err) {
        setGeoError(mealErrorMessage(toMealsError(err).code));
      } finally {
        setGeoLoading(false);
      }
    })();
  }

  function resetForm(): void {
    setLine('');
    setArea('');
    setPhone('');
    setLabel('');
    clearGeoState();
  }

  function submitNew(): void {
    if (saving || !line.trim() || !phone.trim()) return;
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        const created = await saveAddress(token, {
          line: line.trim(),
          area: area.trim() || undefined,
          phone: phone.trim(),
          label: label.trim() || undefined,
          lat: pinned?.lat,
          lng: pinned?.lng,
          isDefault: addresses.length === 0,
        });
        resetForm();
        setAdding(false);
        onChanged();
        onSelect(created);
      } catch (err) {
        setError(mealErrorMessage(toMealsError(err).code));
      } finally {
        setSaving(false);
      }
    })();
  }

  function remove(id: string): void {
    void (async () => {
      try {
        await deleteAddress(token, id);
        onChanged();
      } catch {
        // Best-effort — the list still reflects the pre-delete state on failure.
      }
    })();
  }

  return (
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      {addresses.map((a) => {
        const isSelected = a.id === selectedId;
        return (
          <PressableScale
            key={a.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${a.label || a.line}, ${a.line}${a.area ? `, ${a.area}` : ''}. ${a.phone}${a.isDefault ? '. Default' : ''}`}
            onPress={() => onSelect(a)}
            style={[styles.row, isSelected && styles.rowSelected]}
          >
            <View style={styles.rowMain}>
              <View style={styles.rowTop}>
                <AppText variant="bodyBold" color={isSelected ? colors.onBlock : colors.text} numberOfLines={1}>
                  {a.label || a.line}
                </AppText>
                {a.isDefault ? <Tag label="Default" variant={isSelected ? 'onBlock' : 'dim'} /> : null}
              </View>
              <AppText variant="caption" color={isSelected ? colors.onBlock : colors.textDim} numberOfLines={2}>
                {[a.line, a.area].filter(Boolean).join(', ')} · {a.phone}
              </AppText>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Delete address ${a.label || a.line}`}
              onPress={() => remove(a.id)}
              style={styles.deleteBtn}
            >
              <Ionicons name="trash-outline" size={18} color={isSelected ? colors.onBlock : colors.textDim} />
            </PressableScale>
          </PressableScale>
        );
      })}

      {!adding ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add a new address"
          onPress={() => setAdding(true)}
          style={styles.addToggle}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
          <AppText variant="bodyBold" color={colors.accent}>
            Add a new address
          </AppText>
        </PressableScale>
      ) : (
        <View style={styles.addForm}>
          <AppTextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Label (Home, Office…)"
            accessibilityLabel="Address label"
          />
          <AppTextInput
            value={line}
            onChangeText={updateLine}
            placeholder="Street address"
            accessibilityLabel="Street address"
          />
          <View style={styles.formRow}>
            <AppTextInput
              value={area}
              onChangeText={updateArea}
              placeholder="Area / landmark"
              accessibilityLabel="Area or landmark"
              style={styles.formField}
            />
            <AppTextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone"
              keyboardType="phone-pad"
              accessibilityLabel="Delivery phone number"
              style={styles.formField}
            />
          </View>

          {pinned ? (
            <View style={styles.pinnedRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <AppText variant="caption" color={colors.textDim} style={styles.pinnedText} numberOfLines={2}>
                Pin location: {pinned.label}
              </AppText>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Change pinned location"
                onPress={() => {
                  setPinned(null);
                  setGeoResults(null);
                }}
              >
                <AppText variant="caption" color={colors.accent}>
                  Change
                </AppText>
              </PressableScale>
            </View>
          ) : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Pin this address on the map"
              onPress={findLocation}
              disabled={!line.trim() || geoLoading}
              style={styles.geoToggle}
            >
              <Ionicons name="locate-outline" size={18} color={line.trim() ? colors.accent : colors.textFaint} />
              <AppText variant="label" color={line.trim() ? colors.accent : colors.textFaint}>
                {geoLoading ? 'Finding…' : 'Pin this address on the map'}
              </AppText>
            </PressableScale>
          )}

          {geoError ? (
            <AppText variant="caption" color={colors.error}>
              {geoError}
            </AppText>
          ) : null}

          {geoResults && geoResults.length > 0 ? (
            <View style={styles.geoResults}>
              <AppText variant="caption" color={colors.textDim}>
                Choose the closest match:
              </AppText>
              {geoResults.map((r, i) => (
                <PressableScale
                  key={`${r.lat}-${r.lng}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Use location ${r.label}`}
                  onPress={() => {
                    setPinned(r);
                    setGeoResults(null);
                  }}
                  style={styles.geoResultRow}
                >
                  <Ionicons name="location-outline" size={16} color={colors.textDim} />
                  <AppText variant="caption" numberOfLines={2} style={styles.geoResultText}>
                    {r.label}
                  </AppText>
                </PressableScale>
              ))}
            </View>
          ) : null}

          {error ? (
            <AppText variant="caption" color={colors.error} style={styles.errorText}>
              {error}
            </AppText>
          ) : null}
          <Button
            label="Save address"
            onPress={submitNew}
            disabled={!line.trim() || !phone.trim()}
            loading={saving}
          />
        </View>
      )}
    </ScrollView>
  );
}
