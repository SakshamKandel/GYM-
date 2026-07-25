import { Image } from 'expo-image';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  Chip,
  enterUp,
  PressableScale,
  SectionLabel,
  Tag,
} from '../../components/ui';
import {
  getClientBody,
  getClientCheckIns,
  getClientNutrition,
  getClientOverview,
  getClientPhotos,
  getClientPrs,
  getClientWeight,
  getClientWorkoutsLog,
  toStaffError,
  type ClientBody,
  type ClientCheckIn,
  type ClientNutrition,
  type ClientOverview,
  type ClientPhoto,
  type ClientPrs,
  type ClientWeight,
  type ClientWorkoutsLog,
  type StaffErrorCode,
} from './api';

/**
 * Coach console · client screen — the read panels.
 *
 * Everything a coach needs to look at before they write anything: the headline
 * numbers, the training log, food, body, bodyweight trend, records, check-in
 * history and progress photos. All of it was already built and served, and the
 * phone read none of it — the progress-photos route in particular had no
 * caller anywhere, so a coach could be sent photos by a client and never see
 * them unless they opened a laptop.
 *
 * One panel loads at a time, on the tap that opens it, and its result is kept
 * for the rest of the visit. That keeps a screen already full of controls
 * quiet, and keeps the photo route (rate limited per coach) to one call.
 *
 * Every route re-checks the assignment server-side, so a coaching relationship
 * that ended mid-visit reads as "no longer assigned" rather than showing
 * someone else's logs.
 */

type PanelKey =
  | 'overview'
  | 'training'
  | 'food'
  | 'body'
  | 'weight'
  | 'prs'
  | 'checkins'
  | 'photos';

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'training', label: 'Training' },
  { key: 'food', label: 'Food' },
  { key: 'body', label: 'Body' },
  { key: 'weight', label: 'Weight' },
  { key: 'prs', label: 'Records' },
  { key: 'checkins', label: 'Check-ins' },
  { key: 'photos', label: 'Photos' },
];

function errorLine(code: StaffErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return 'This client is no longer assigned to you.';
    case 'not_found':
      return "This client's account no longer exists.";
    case 'rate_limited':
      return 'Too many photo loads in a row. Wait a moment and try again.';
    case 'not_configured':
      return "Photos aren't set up on this server yet.";
    default:
      return "Couldn't reach the server. Check your connection and retry.";
  }
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM-DD' or a full stamp → "12 Mar 2026". Empty input → "—". */
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const parts = iso.slice(0, 10).split('-');
  const y = Number.parseInt(parts[0] ?? '', 10);
  const m = Number.parseInt(parts[1] ?? '', 10);
  const d = Number.parseInt(parts[2] ?? '', 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return '—';
  return `${d} ${MONTHS[m - 1] ?? m} ${y}`;
}

/** "82.5 kg" — canonical kg, one decimal at most. */
function kg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} kg`;
}

/** Whole numbers with thousands separators, for volume and calories. */
function whole(value: number): string {
  return Math.round(value).toLocaleString();
}

/** Which meal a logged food belongs to, in the words the member sees. */
const MEAL_LABEL: Record<'breakfast' | 'lunch' | 'dinner' | 'snacks', string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="title" tabular numberOfLines={1}>
        {value}
      </AppText>
      {hint ? (
        <AppText variant="caption" color={colors.textFaint} numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <AppText variant="caption" color={colors.textFaint} style={styles.empty}>
      {text}
    </AppText>
  );
}

/**
 * Loads one panel's data on demand and hands it to `render`. Keeps the result
 * for the rest of the visit, and turns a failure into a tappable retry line
 * instead of an empty panel that looks like "this client has nothing".
 */
function Panel<T>({
  load,
  render,
}: {
  load: () => Promise<T>;
  render: (data: T) => ReactNode;
}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      setError(errorLine(toStaffError(err).code));
    } finally {
      setLoading(false);
    }
    // `load` is rebuilt on every render of the parent; re-running on identity
    // alone would fetch forever. The panel key remounts this component when
    // the coach switches panels, which is the only time a refetch is wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  if (loading) {
    return (
      <View style={styles.panelQuiet}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Retry loading this panel"
        onPress={() => void run()}
        style={styles.panelQuiet}
      >
        <AppText variant="caption" color={colors.textDim}>
          {error} Tap to retry.
        </AppText>
      </PressableScale>
    );
  }
  if (data === null) return null;
  return <>{render(data)}</>;
}

export function ClientReadPanels({
  userId,
  token,
}: {
  userId: string;
  token: string | null;
}) {
  const [panel, setPanel] = useState<PanelKey>('overview');

  if (!token || !userId) return null;
  // Captured once so every panel's loader closes over a plain string rather
  // than the nullable prop.
  const auth = token;

  return (
    <>
      <SectionLabel>Client data</SectionLabel>
      <View style={styles.chipRow}>
        {PANELS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            selected={panel === p.key}
            onPress={() => setPanel(p.key)}
          />
        ))}
      </View>

      <Animated.View entering={enterUp(0)} style={styles.panelWrap}>
        {panel === 'overview' ? (
          <Panel<ClientOverview>
            key="overview"
            load={() => getClientOverview(userId, auth)}
            render={(d) => (
              <>
                <View style={styles.statGrid}>
                  <Stat
                    label="Sessions (30 days)"
                    value={String(d.training.sessionsLast30)}
                    hint={`${d.training.totalSessions} in total`}
                  />
                  <Stat label="Volume (30 days)" value={`${whole(d.training.volumeLast30Kg)} kg`} />
                  <Stat label="Records" value={String(d.training.prCount)} />
                  <Stat
                    label="Bodyweight"
                    value={
                      d.body.latestBodyweightKg !== null ? kg(d.body.latestBodyweightKg) : '—'
                    }
                    hint={
                      d.body.latestBodyweightDate
                        ? formatDay(d.body.latestBodyweightDate)
                        : 'never logged'
                    }
                  />
                  <Stat
                    label="Weekly streak"
                    value={`${d.engagement.streakWeeks} wk`}
                    hint={`best ${d.engagement.bestStreakWeeks}`}
                  />
                  <Stat
                    label="Check-ins"
                    value={String(d.body.checkInCount)}
                    hint={
                      d.body.lastCheckInDate ? formatDay(d.body.lastCheckInDate) : 'none yet'
                    }
                  />
                </View>
                <View style={styles.factList}>
                  <AppText variant="caption" color={colors.textDim}>
                    Last workout {formatDay(d.training.lastWorkoutAt)}
                  </AppText>
                  <AppText variant="caption" color={colors.textDim}>
                    Coaching since {formatDay(d.client.assignedAt)}
                  </AppText>
                  <AppText variant="caption" color={colors.textDim}>
                    Member since {formatDay(d.client.memberSince)}
                  </AppText>
                </View>
              </>
            )}
          />
        ) : null}

        {panel === 'training' ? (
          <Panel<ClientWorkoutsLog>
            key="training"
            load={() => getClientWorkoutsLog(userId, auth, 10)}
            render={(d) =>
              d.workouts.length === 0 ? (
                <Empty text="No workouts logged yet." />
              ) : (
                <View style={styles.rows}>
                  {d.workouts.map((w) => (
                    <View key={w.id} style={styles.card}>
                      <View style={styles.cardHead}>
                        <AppText variant="bodyBold" numberOfLines={1} style={styles.cardTitle}>
                          {w.name || 'Workout'}
                        </AppText>
                        <AppText variant="caption" color={colors.textFaint}>
                          {formatDay(w.date)}
                        </AppText>
                      </View>
                      {w.sets.map((s, i) => (
                        <View key={`${w.id}-${i}`} style={styles.setRow}>
                          <AppText variant="caption" color={colors.text} numberOfLines={1} style={styles.setName}>
                            {s.exerciseName}
                          </AppText>
                          <AppText variant="caption" color={colors.textDim} tabular>
                            {kg(s.weightKg)} × {s.reps}
                            {s.rpe !== null ? ` @${s.rpe}` : ''}
                          </AppText>
                          {s.isPr ? <Tag label="PR" variant="filled" /> : null}
                        </View>
                      ))}
                      {!w.ranked ? (
                        <AppText variant="caption" color={colors.warning}>
                          Flagged as not believable, so it doesn&apos;t count towards stats.
                        </AppText>
                      ) : null}
                    </View>
                  ))}
                  {d.hasMore ? (
                    <AppText variant="caption" color={colors.textFaint}>
                      Showing the 10 most recent sessions.
                    </AppText>
                  ) : null}
                </View>
              )
            }
          />
        ) : null}

        {panel === 'food' ? (
          <Panel<ClientNutrition>
            key="food"
            load={() => getClientNutrition(userId, auth)}
            render={(d) => {
              if (!d.synced || d.days.length === 0) {
                return <Empty text="This client hasn't logged any food or water yet." />;
              }
              const recent = [...d.days].reverse().slice(0, 14);
              const latest = recent[0];
              return (
                <>
                  {latest ? (
                    <View style={styles.statGrid}>
                      <Stat
                        label="Calories"
                        value={whole(latest.kcal)}
                        hint={d.targets?.kcal != null ? `target ${whole(d.targets.kcal)}` : formatDay(latest.date)}
                      />
                      <Stat
                        label="Protein"
                        value={`${whole(latest.protein)} g`}
                        hint={d.targets?.protein != null ? `target ${whole(d.targets.protein)} g` : undefined}
                      />
                      <Stat label="Carbs" value={`${whole(latest.carbs)} g`} />
                      <Stat label="Fat" value={`${whole(latest.fat)} g`} />
                    </View>
                  ) : null}
                  <AppText variant="caption" color={colors.textFaint} style={styles.panelNote}>
                    Latest day logged: {latest ? formatDay(latest.date) : '—'}
                    {latest && latest.waterMl > 0
                      ? ` · ${Math.round(latest.waterMl / 100) / 10} L water`
                      : ''}
                  </AppText>

                  {latest && latest.entries.length > 0 ? (
                    <View style={styles.card}>
                      <AppText variant="bodyBold">What they ate that day</AppText>
                      {latest.entries.map((e) => (
                        <View key={e.id} style={styles.lineRow}>
                          <AppText variant="caption" color={colors.text} style={styles.lineLabel} numberOfLines={1}>
                            {e.foodName || 'Food'}
                          </AppText>
                          <AppText variant="caption" color={colors.textDim} tabular>
                            {MEAL_LABEL[e.meal]} · {whole(e.grams)} g · {whole(e.kcal)} kcal
                          </AppText>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.rows}>
                    {recent.map((day) => (
                      <View key={day.date} style={styles.lineRow}>
                        <AppText variant="caption" color={colors.text} style={styles.lineLabel}>
                          {formatDay(day.date)}
                        </AppText>
                        <AppText variant="caption" color={colors.textDim} tabular>
                          {whole(day.kcal)} kcal · {whole(day.protein)}p · {whole(day.carbs)}c ·{' '}
                          {whole(day.fat)}f
                        </AppText>
                      </View>
                    ))}
                  </View>
                </>
              );
            }}
          />
        ) : null}

        {panel === 'body' ? (
          <Panel<ClientBody>
            key="body"
            load={() => getClientBody(userId, auth)}
            render={(d) => {
              if (!d.synced || (d.points.length === 0 && d.measurements.length === 0)) {
                return <Empty text="This client hasn't logged weight or measurements yet." />;
              }
              const latest = d.points[d.points.length - 1];
              return (
                <>
                  {latest ? (
                    <View style={styles.statGrid}>
                      <Stat label="Trend" value={kg(latest.trendKg)} hint={formatDay(latest.date)} />
                      <Stat
                        label="Change"
                        value={`${d.summary.direction === 'down' ? '−' : d.summary.direction === 'up' ? '+' : ''}${kg(
                          Math.abs(d.summary.deltaKg),
                        )}`}
                      />
                      <Stat label="Per week" value={`${kg(Math.abs(d.summary.ratePerWeekKg))}`} />
                    </View>
                  ) : null}
                  {d.measurements.length > 0 ? (
                    <View style={styles.rows}>
                      <AppText variant="caption" color={colors.textFaint} style={styles.panelNote}>
                        Measurements, newest first
                      </AppText>
                      {d.measurements.slice(0, 10).map((m) => {
                        const parts = [
                          m.waistCm !== null ? `waist ${m.waistCm} cm` : null,
                          m.chestCm !== null ? `chest ${m.chestCm} cm` : null,
                          m.armCm !== null ? `arm ${m.armCm} cm` : null,
                          m.hipCm !== null ? `hip ${m.hipCm} cm` : null,
                          m.thighCm !== null ? `thigh ${m.thighCm} cm` : null,
                        ].filter((p): p is string => p !== null);
                        return (
                          <View key={m.id} style={styles.lineRow}>
                            <AppText variant="caption" color={colors.text} style={styles.lineLabel}>
                              {formatDay(m.date)}
                            </AppText>
                            <AppText variant="caption" color={colors.textDim}>
                              {parts.length > 0 ? parts.join(' · ') : 'nothing filled in'}
                            </AppText>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </>
              );
            }}
          />
        ) : null}

        {panel === 'weight' ? (
          <Panel<ClientWeight>
            key="weight"
            load={() => getClientWeight(userId, auth)}
            render={(d) => {
              if (d.points.length === 0) {
                return <Empty text="No bodyweight logged on a check-in yet." />;
              }
              const latest = d.points[d.points.length - 1];
              return (
                <>
                  <View style={styles.statGrid}>
                    <Stat
                      label="Trend"
                      value={latest ? kg(latest.trendKg) : '—'}
                      hint={latest ? formatDay(latest.date) : undefined}
                    />
                    <Stat
                      label="Change"
                      value={`${d.summary.direction === 'down' ? '−' : d.summary.direction === 'up' ? '+' : ''}${kg(
                        Math.abs(d.summary.deltaKg),
                      )}`}
                    />
                    <Stat label="Per week" value={kg(Math.abs(d.summary.ratePerWeekKg))} />
                  </View>
                  <AppText variant="caption" color={colors.textFaint} style={styles.panelNote}>
                    Smoothed the same way the client&apos;s own Body tab does, over{' '}
                    {d.points.length} check-in{d.points.length === 1 ? '' : 's'}.
                  </AppText>
                  <View style={styles.rows}>
                    {[...d.points]
                      .reverse()
                      .slice(0, 12)
                      .map((p) => (
                        <View key={p.date} style={styles.lineRow}>
                          <AppText variant="caption" color={colors.text} style={styles.lineLabel}>
                            {formatDay(p.date)}
                          </AppText>
                          <AppText variant="caption" color={colors.textDim} tabular>
                            {kg(p.kg)} · trend {kg(p.trendKg)}
                          </AppText>
                        </View>
                      ))}
                  </View>
                </>
              );
            }}
          />
        ) : null}

        {panel === 'prs' ? (
          <Panel<ClientPrs>
            key="prs"
            load={() => getClientPrs(userId, auth)}
            render={(d) =>
              d.records.length === 0 ? (
                <Empty text="No personal records yet." />
              ) : (
                <View style={styles.rows}>
                  <AppText variant="caption" color={colors.textFaint} style={styles.panelNote}>
                    Best lift per exercise, heaviest first · {d.totalPrs} record
                    {d.totalPrs === 1 ? '' : 's'} in all
                  </AppText>
                  {d.records.map((r, i) => (
                    <View key={`${r.exerciseName}-${i}`} style={styles.lineRow}>
                      <AppText variant="caption" color={colors.text} style={styles.lineLabel} numberOfLines={1}>
                        {r.exerciseName}
                      </AppText>
                      <AppText variant="caption" color={colors.textDim} tabular>
                        {kg(r.weightKg)} × {r.reps} · est. 1 rep {kg(r.e1rm)}
                      </AppText>
                    </View>
                  ))}
                </View>
              )
            }
          />
        ) : null}

        {panel === 'checkins' ? (
          <Panel<ClientCheckIn[]>
            key="checkins"
            load={() => getClientCheckIns(userId, auth)}
            render={(d) =>
              d.length === 0 ? (
                <Empty text="No check-ins yet." />
              ) : (
                <View style={styles.rows}>
                  {d.map((c) => (
                    <View key={c.id} style={styles.card}>
                      <View style={styles.cardHead}>
                        <AppText variant="bodyBold">{formatDay(c.date)}</AppText>
                        {c.replied ? <Tag label="Answered" variant="dim" /> : null}
                      </View>
                      <AppText variant="caption" color={colors.textDim} tabular>
                        {c.bodyweightKg !== null ? `${kg(c.bodyweightKg)} · ` : ''}
                        {c.sleep !== null ? `sleep ${c.sleep}/5 · ` : ''}
                        {c.energy !== null ? `energy ${c.energy}/5 · ` : ''}
                        {c.soreness !== null ? `soreness ${c.soreness}/5` : ''}
                      </AppText>
                      {c.summary ? (
                        <AppText variant="caption" color={colors.textFaint} tabular>
                          That week: {c.summary.sessions} session
                          {c.summary.sessions === 1 ? '' : 's'} · {whole(c.summary.volumeKg)} kg ·{' '}
                          {c.summary.prCount} record{c.summary.prCount === 1 ? '' : 's'}
                        </AppText>
                      ) : null}
                      {c.note ? <AppText variant="body">{c.note}</AppText> : null}
                    </View>
                  ))}
                </View>
              )
            }
          />
        ) : null}

        {panel === 'photos' ? (
          <Panel<ClientPhoto[]>
            key="photos"
            load={() => getClientPhotos(userId, auth)}
            render={(photos) =>
              photos.length === 0 ? (
                <Empty text="This client hasn't added any progress photos." />
              ) : (
                <>
                  <AppText variant="caption" color={colors.textFaint} style={styles.panelNote}>
                    Newest first. These are your client&apos;s private photos, so keep them here.
                  </AppText>
                  <View style={styles.photoGrid}>
                    {photos.map((p) => (
                      <View key={p.id} style={styles.photoCell}>
                        <Image
                          source={{ uri: p.url }}
                          style={styles.photo}
                          contentFit="cover"
                          transition={150}
                          accessibilityLabel={`Progress photo from ${formatDay(p.takenOn)}`}
                        />
                        <AppText variant="label" color={colors.textFaint} numberOfLines={1}>
                          {formatDay(p.takenOn)}
                        </AppText>
                        {p.note ? (
                          <AppText variant="caption" color={colors.textDim} numberOfLines={2}>
                            {p.note}
                          </AppText>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              )
            }
          />
        ) : null}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  panelWrap: { marginTop: spacing.md },
  panelQuiet: {
    minHeight: touch.min,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  panelNote: { marginBottom: spacing.xs },
  empty: { paddingVertical: spacing.md },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { width: '50%', gap: 2, paddingRight: spacing.md },
  factList: { marginTop: spacing.lg, gap: 2 },
  rows: { gap: spacing.sm, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { flexShrink: 1 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setName: { flex: 1 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  lineLabel: { flexShrink: 1, minWidth: 96 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoCell: { width: '48%', gap: 2 },
  photo: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
});
