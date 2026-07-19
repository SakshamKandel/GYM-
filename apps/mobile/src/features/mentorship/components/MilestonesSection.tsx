import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, Button, IconChip, SectionLabel, Sheet } from '../../../components/ui';
import { posterDate, toIsoDate } from '../../../lib/dates';
import { successHaptic } from '../../../lib/haptics';
import { useAuth } from '../../../state/auth';
import { PrCelebration } from '../../training/components/PrCelebration';
import { useMyMilestones } from '../hooks';
import type { CoachMilestone } from '../api';

/**
 * "Coach milestones" — achievements the member's coach logged for them,
 * rendered as gap-separated charcoal rows (ribbon icon chip, title + note,
 * date + coach name on the right rail). Self-contained: fetches via
 * useMyMilestones and renders NOTHING when signed out or the list is empty,
 * so host screens can drop it in unconditionally.
 *
 * Pack L: a coach-logged milestone the member hasn't seen yet gets a
 * one-shot celebration (the same PR burst as PrCelebration/BadgeCelebration)
 * the first time it appears on this device — "seen" ids persist locally per
 * account so re-opening Progress never replays it.
 */

/** Per-account key so a device switch/sign-out never leaks another account's seen set. */
function seenStorageKey(accountId: string): string {
  return `milestone-celebration-seen:${accountId}`;
}

async function loadSeenIds(accountId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(seenStorageKey(accountId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function saveSeenIds(accountId: string, ids: ReadonlySet<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(seenStorageKey(accountId), JSON.stringify([...ids]));
  } catch {
    // Best-effort only — worst case a milestone celebrates again next visit.
  }
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 64,
  },
  main: { flex: 1, gap: 2 },
  rail: { flexShrink: 0, alignItems: 'flex-end', gap: 2 },
  celebrateStage: { alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  celebrateBurstStage: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  celebrateBurstWrap: { position: 'absolute' },
  celebrateDone: { marginTop: spacing.sm },
});

/** "THU, JUL 3" from an ISO timestamp; empty when unparseable. */
function achievedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : posterDate(toIsoDate(d));
}

export function MilestonesSection() {
  const { milestones, loaded } = useMyMilestones();
  const accountId = useAuth((s) => s.user?.id ?? null);
  const [celebrating, setCelebrating] = useState<CoachMilestone | null>(null);
  const checkedFor = useRef<string | null>(null);

  // Detect not-yet-seen milestones once per (account, list) and celebrate the
  // first one — best-effort, never blocks or re-fires while a celebration
  // from this same load is already open.
  useEffect(() => {
    if (!loaded || accountId === null || milestones.length === 0) return;
    const key = `${accountId}:${milestones.length}:${milestones[0]?.id ?? ''}`;
    if (checkedFor.current === key) return;
    checkedFor.current = key;
    void (async () => {
      const seen = await loadSeenIds(accountId);
      const unseen = milestones.filter((m) => !seen.has(m.id));
      const nextSeen = new Set(seen);
      for (const m of milestones) nextSeen.add(m.id);
      await saveSeenIds(accountId, nextSeen);
      // Never celebrate on the very first load ever (nothing was "seen"
      // yet, so every historical milestone would otherwise fire at once) —
      // only when SOME ids were already recorded and new ones landed since.
      if (seen.size > 0 && unseen.length > 0) {
        successHaptic();
        setCelebrating(unseen[0]!);
      }
    })();
  }, [loaded, accountId, milestones]);

  if (milestones.length === 0) return null;

  return (
    <View>
      <SectionLabel>Coach milestones</SectionLabel>
      <View style={styles.stack}>
        {milestones.map((m) => {
          const date = achievedLabel(m.achievedAt);
          return (
            <View
              key={m.id}
              accessible
              accessibilityLabel={`Milestone: ${m.title}${m.note ? `. ${m.note}` : ''}${
                date ? `. ${date}` : ''
              }. From coach ${m.coachName}`}
              style={styles.row}
            >
              <IconChip icon="ribbon" />
              <View style={styles.main}>
                <AppText variant="bodyBold" numberOfLines={1}>
                  {m.title}
                </AppText>
                {m.note ? (
                  <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
                    {m.note}
                  </AppText>
                ) : null}
              </View>
              <View style={styles.rail}>
                {date ? <AppText variant="label">{date}</AppText> : null}
                <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
                  {m.coachName}
                </AppText>
              </View>
            </View>
          );
        })}
      </View>

      <Sheet visible={celebrating !== null} onClose={() => setCelebrating(null)} title="Milestone">
        {celebrating ? (
          <>
            <View style={styles.celebrateStage}>
              <AppText variant="label" center>
                Your coach logged a win
              </AppText>
              <View style={styles.celebrateBurstStage}>
                <View style={styles.celebrateBurstWrap} pointerEvents="none">
                  <PrCelebration key={celebrating.id} onDone={() => {}} size={104} />
                </View>
                <IconChip icon="ribbon" size={72} color={colors.surfaceRaised} iconColor={colors.accent} />
              </View>
              <AppText variant="display" center>
                {celebrating.title}
              </AppText>
              {celebrating.note ? (
                <AppText variant="body" color={colors.textDim} center>
                  {celebrating.note}
                </AppText>
              ) : null}
            </View>
            <Button label="Nice" onPress={() => setCelebrating(null)} style={styles.celebrateDone} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
