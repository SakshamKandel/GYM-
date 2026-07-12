import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Chip } from '../ui';
import { tapHaptic } from '../../lib/haptics';
import {
  MUSCLE_LABELS,
  SOURCE_MUSCLES,
  SOURCE_TO_APP_MUSCLE,
  VISUAL_ONLY_SLUGS,
} from '../../lib/muscleMap';
import { MALE_MUSCLE_MAP, MUSCLE_MAP_VIEW_BOX } from '../../lib/muscleMapData';
import type { Anatomy3DViewerProps } from './config';

/**
 * Always-available SVG fallback for devices that cannot start the WebGL
 * viewer. It keeps muscle selection and red highlighting functional offline
 * and under accessibility tooling, even though it only shows one face at a
 * time.
 */

const BODY_RATIO = 194 / 340;

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.block,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  sideChips: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hintWrap: { position: 'absolute', left: spacing.md, bottom: spacing.md },
  selectedLabel: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    alignItems: 'flex-end',
  },
});

export function Anatomy2DViewer({
  selected,
  onSelect,
  side,
  height = 420,
  overlays = true,
  onSideChange,
}: Anatomy3DViewerProps) {
  const highlighted = new Set(selected ? SOURCE_MUSCLES[selected] : []);
  const bodyHeight = height - spacing.gutter * 2;
  const bodyWidth = Math.round(bodyHeight * BODY_RATIO);

  return (
    <View style={[styles.panel, { height }]}>
      <Svg
        width={bodyWidth}
        height={bodyHeight}
        viewBox={MUSCLE_MAP_VIEW_BOX[side]}
        accessibilityLabel={
          selected
            ? `${side} body view. ${MUSCLE_LABELS[selected]} highlighted.`
            : `${side} body view.`
        }
      >
        {MALE_MUSCLE_MAP[side].flatMap((group) =>
          group.paths.map((path, index) => {
            const mappedMuscle = SOURCE_TO_APP_MUSCLE[group.slug];
            const selectable = mappedMuscle !== undefined && !VISUAL_ONLY_SLUGS.has(group.slug);
            const active = highlighted.has(group.slug);

            return (
              <Path
                key={`${group.slug}-${index}`}
                d={path}
                fill={active ? colors.accent : colors.anatomySkin}
                stroke={active ? colors.onAccent : colors.anatomyMuscle}
                strokeWidth={active ? 3.2 : 1.6}
                onPress={
                  selectable
                    ? () => {
                        tapHaptic();
                        onSelect(mappedMuscle);
                      }
                    : undefined
                }
                accessible={selectable}
                accessibilityLabel={
                  selectable ? `Select ${MUSCLE_LABELS[mappedMuscle]}` : undefined
                }
              />
            );
          }),
        )}
      </Svg>

      {onSideChange ? (
        <View style={styles.sideChips}>
          <Chip label="Front" selected={side === 'front'} onPress={() => onSideChange('front')} />
          <Chip label="Back" selected={side === 'back'} onPress={() => onSideChange('back')} />
        </View>
      ) : null}

      {overlays ? (
        <>
          <View style={styles.hintWrap} pointerEvents="none">
            <AppText variant="body" color={colors.textDim} numberOfLines={1}>
              Tap a muscle
            </AppText>
          </View>
          {selected ? (
            <View style={styles.selectedLabel} pointerEvents="none">
              <AppText variant="label" color={colors.textDim}>
                Selected
              </AppText>
              <AppText variant="title" color={colors.accent}>
                {MUSCLE_LABELS[selected]}
              </AppText>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
