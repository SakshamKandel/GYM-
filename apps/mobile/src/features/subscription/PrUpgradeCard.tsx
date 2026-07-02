import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import type { UnitPref } from '@gym/shared';
import { displayWeight } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, IconChip, Tag, enterFade } from '../../components/ui';

/**
 * The PR-moment upgrade card — the non-scummy conversion beat.
 *
 * Shown right after the PR celebration on the workout-complete screen to
 * users below Gold. It quotes the user's OWN fresh PR back to them and, while
 * they're euphoric, shows what Gold's adaptive engine does with that progress:
 * targets that react to their trend, Greece's plan progression, next-lift
 * prediction. Honest and short — value, not shame. The single red primary is
 * "See GM Method"; a quiet ghost dismiss hides it locally.
 *
 * Reserve red for the one primary here; no floating entrance, no haptics.
 */

interface TopPr {
  exerciseName: string;
  weightKg: number;
  reps: number;
  e1rm: number;
}

interface Props {
  topPr: TopPr;
  unit: UnitPref;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
    marginTop: spacing.xl,
    alignItems: 'flex-start',
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  headText: { flex: 1, gap: 4 },
  buttonRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  primary: { flex: 1 },
});

/** Trims a trailing .0 so "80.0" reads as "80" but "82.5" stays intact. */
function formatWeight(value: number): string {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function PrUpgradeCard({ topPr, unit }: Props) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const weight = formatWeight(displayWeight(topPr.weightKg, unit));

  return (
    <Animated.View entering={enterFade()} style={styles.card}>
      <View style={styles.headRow}>
        <IconChip icon="trophy" color={colors.surfaceRaised} iconColor={colors.accent} />
        <View style={styles.headText}>
          <Tag label="PR" variant="outline" />
          <AppText variant="title">
            {`New ${topPr.exerciseName} PR: ${weight} ${unit}`}
          </AppText>
        </View>
      </View>

      <AppText variant="body" color={colors.textDim}>
        Gold predicts your next lift and adapts your targets to this progress —
        Greece&apos;s plan levels up with every week you train.
      </AppText>

      <View style={styles.buttonRow}>
        <View style={styles.primary}>
          <Button
            label="See GM Method"
            // typed-routes catches up once the /subscribe route file is generated
            onPress={() => router.push('/subscribe' as Href)}
          />
        </View>
        <Button label="Maybe later" variant="ghost" onPress={() => setHidden(true)} />
      </View>
    </Animated.View>
  );
}
