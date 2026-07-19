import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, touch } from '@gym/ui-tokens';
import { PressableScale } from '../../../components/ui';

/**
 * Floating Save/Share icon pair over the gallery on the gym detail page
 * (Pack M — fixes B15's dead-end). Mirrors the existing floating back
 * button's treatment (44dp dark-glass circle) so the three float as one
 * family. Save is optimistic — the parent owns the toggled/loading state so
 * a re-render never flickers the icon back before the request settles.
 */

interface Props {
  onShare: () => void;
  /** Omit entirely when signed out — favoriting requires an account. */
  favorite?: { active: boolean; busy: boolean; onToggle: () => void; gymName: string };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  btn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: 'rgba(11,12,13,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function GymDetailTopActions({ onShare, favorite }: Props) {
  return (
    <View style={styles.row}>
      {favorite ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            favorite.active ? `Remove ${favorite.gymName} from saved gyms` : `Save ${favorite.gymName}`
          }
          accessibilityState={{ selected: favorite.active, disabled: favorite.busy }}
          disabled={favorite.busy}
          onPress={favorite.onToggle}
          style={styles.btn}
        >
          <Ionicons
            name={favorite.active ? 'heart' : 'heart-outline'}
            size={22}
            color={favorite.active ? colors.accent : colors.text}
          />
        </PressableScale>
      ) : null}
      <PressableScale accessibilityRole="button" accessibilityLabel="Share this gym" onPress={onShare} style={styles.btn}>
        <Ionicons name="share-outline" size={20} color={colors.text} />
      </PressableScale>
    </View>
  );
}
