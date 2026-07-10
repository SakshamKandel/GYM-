import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import type { Exercise } from '@gym/shared';
import { colors, radius, spacing, touch } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Chip,
  enterDown,
  enterFade,
  enterUp,
  IconChip,
  PressableScale,
} from '../../components/ui';
import { useRecentExercises, type RecentExercise } from '../../features/training/hooks';
import { pushPath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { MUSCLE_GROUPS, searchExercises } from '../../lib/exercises';

/**
 * Exercise library — 873 bundled exercises, fully offline.
 * ?select=1 → picker mode: tapping adds to the active session and returns.
 *
 * Revamp (REVAMP-BRIEF): eyebrow + big Oswald title, pill search, pill filter
 * chips, and charcoal block rows (no hairline dividers — rounded rows with a
 * gap, separation by fill contrast).
 */

/** Breathing room above the header — matches Screen's TOP_AIR so the back
 * button never kisses the viewport edge even when insets are 0 (web). */
const TOP_AIR = 16;
/** Keep phone-first line lengths on wide viewports — same cap as Screen. */
const MAX_CONTENT_WIDTH = 640;
/** Tiles in the Recent strip (browse and picker modes). */
const RECENT_LIMIT = 8;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  /** Center the content column on wide viewports (web/tablet). FlashList's
   * contentContainerStyle only supports padding, so the cap goes on the
   * header, the chip strip, and each row wrapper instead. */
  contentCap: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  header: { paddingHorizontal: spacing.gutter },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Header block (brief §5): eyebrow → huge Oswald title.
  title: {
    textTransform: 'uppercase',
    lineHeight: 44,
    marginTop: spacing.xs,
  },
  // Pill search field: the wrap carries the surface, the AppTextInput inside
  // goes transparent (it still kills the web focus ring internally). Pills may
  // carry strokes — the no-border law is for cards.
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    height: touch.primary,
    marginTop: spacing.lg,
  },
  searchWrapFocused: { borderColor: colors.accent },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  chipsRow: { gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.gutter },
  recentLabel: { paddingHorizontal: spacing.gutter, marginBottom: spacing.sm },
  recentStrip: { gap: spacing.sm, paddingHorizontal: spacing.gutter, paddingBottom: spacing.md },
  recentTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touch.min,
  },
  // Same quiet-placeholder treatment as the row thumbs, just smaller.
  recentThumb: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  recentName: { maxWidth: 140 },
  list: { flex: 1 },
  /** Gutter for each block row — margins can't live on contentCap (width%). */
  rowPad: { paddingHorizontal: spacing.gutter },
  // Charcoal block row (brief §11c): rounded surface fill, no borders; rows in
  // a stack separate with a gap instead of Divider hairlines.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 72,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowGap: { height: spacing.sm },
  // Thumbs sit in a rounded frame on a quiet surfaceRaised placeholder (no
  // white flash while the CDN photo streams in); the photo's own white
  // background covers the tile once loaded, so it reads as a deliberate
  // light tile inside the charcoal row.
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  rowText: { flex: 1 },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { marginTop: spacing.sm },
});

/** Gap between block rows — replaces the old Divider hairline. */
function RowGap() {
  return <View style={styles.rowGap} />;
}

function RecentTile({
  item,
  onPress,
  selectMode,
}: {
  item: RecentExercise;
  onPress: () => void;
  selectMode: boolean;
}) {
  const { exercise, daysAgo } = item;
  const caption =
    daysAgo === null ? null : daysAgo === 0 ? 'today' : `${daysAgo} d ago`;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        selectMode ? `Add ${exercise.name} to workout` : `Open ${exercise.name}`
      }
      onPress={onPress}
      style={styles.recentTile}
    >
      <Image
        source={exercise.imageUrls[0] ? { uri: exercise.imageUrls[0] } : undefined}
        style={styles.recentThumb}
        contentFit="cover"
        transition={100}
      />
      <View>
        <AppText variant="bodyBold" numberOfLines={1} style={styles.recentName}>
          {exercise.name}
        </AppText>
        {caption ? (
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {caption}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

function ExerciseRow({
  exercise,
  onPress,
  selectMode,
}: {
  exercise: Exercise;
  onPress: () => void;
  selectMode: boolean;
}) {
  return (
    <View style={[styles.contentCap, styles.rowPad]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          selectMode ? `Add ${exercise.name} to workout` : `Open ${exercise.name}`
        }
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Image
          source={exercise.imageUrls[0] ? { uri: exercise.imageUrls[0] } : undefined}
          style={styles.thumb}
          contentFit="cover"
          transition={100}
          recyclingKey={exercise.id}
        />
        <View style={styles.rowText}>
          <AppText variant="bodyBold" numberOfLines={1}>
            {exercise.name}
          </AppText>
          <AppText variant="caption" color={colors.textDim} numberOfLines={1}>
            {`${exercise.muscleGroup} · ${exercise.equipment ?? 'bodyweight'}`}
          </AppText>
        </View>
        <Ionicons
          name={selectMode ? 'add' : 'chevron-forward'}
          size={20}
          color={colors.textFaint}
        />
      </Pressable>
    </View>
  );
}

export default function ExerciseLibraryScreen() {
  const insets = useSafeAreaInsets();
  const { select, muscle: muscleQuery } = useLocalSearchParams<{ select?: string; muscle?: string }>();
  const selectMode = select === '1';
  const [query, setQuery] = useState('');
  const requestedMuscle =
    typeof muscleQuery === 'string' && MUSCLE_GROUPS.some((group) => group === muscleQuery)
      ? muscleQuery
      : null;
  const [muscle, setMuscle] = useState<string | null>(requestedMuscle);
  const [searchFocused, setSearchFocused] = useState(false);
  const recent = useRecentExercises(RECENT_LIMIT);
  const showRecent = query.trim().length === 0 && muscle === null && recent.length > 0;
  const totalCount = useMemo(() => searchExercises({}).length, []);

  const results = useMemo(
    () =>
      searchExercises({
        query: query.trim() ? query : undefined,
        muscleGroup: muscle ?? undefined,
      }),
    [query, muscle],
  );

  const handlePick = (exercise: Exercise): void => {
    // Picker taps only "add and pop back" while a session is live — addExercise
    // no-ops when idle (e.g. the session ended behind this screen), and popping
    // back then would fake success. Fall through to the detail screen instead.
    if (selectMode && useSession.getState().status === 'active') {
      useSession.getState().addExercise(exercise.id);
      router.back();
    } else {
      pushPath(`/exercises/${exercise.id}`);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <View style={[styles.root, { paddingTop: insets.top + TOP_AIR }]}>
      <View style={[styles.contentCap, styles.header]}>
        <Animated.View entering={enterDown(0)}>
          <View style={styles.topRow}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              style={styles.backBtn}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </PressableScale>
          </View>
          <AppText variant="label">
            {selectMode ? 'Tap to add to your workout' : `Library · ${totalCount} exercises`}
          </AppText>
          <AppText variant="display" style={styles.title}>
            {selectMode ? 'Add exercise' : 'Exercises'}
          </AppText>
        </Animated.View>
        <Animated.View
          entering={enterDown(1)}
          style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}
        >
          <Ionicons name="search" size={18} color={colors.textDim} />
          <AppTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${totalCount} exercises`}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search exercises"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={16}
            >
              <Ionicons name="close-circle" size={18} color={colors.textDim} />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>

      <Animated.View entering={enterUp(0)} style={styles.contentCap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {MUSCLE_GROUPS.map((m) => (
            <Chip
              key={m}
              label={m}
              selected={muscle === m}
              onPress={() => setMuscle(muscle === m ? null : m)}
            />
          ))}
        </ScrollView>
      </Animated.View>

      {showRecent ? (
        <Animated.View entering={enterFade(0)} style={styles.contentCap}>
          <View style={styles.recentLabel}>
            <AppText variant="label">Recent</AppText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentStrip}
            keyboardShouldPersistTaps="handled"
          >
            {recent.map((r) => (
              <RecentTile
                key={r.exercise.id}
                item={r}
                selectMode={selectMode}
                onPress={() => handlePick(r.exercise)}
              />
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      {/* FlashList is virtualized — animate the container only, never the rows. */}
      <Animated.View entering={enterUp(1)} style={styles.list}>
        <FlashList
          data={results}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <ExerciseRow exercise={item} selectMode={selectMode} onPress={() => handlePick(item)} />
          )}
          ItemSeparatorComponent={RowGap}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          ListEmptyComponent={
            <Animated.View entering={enterFade(0)} style={styles.emptyWrap}>
              <IconChip icon="search" color={colors.surface} iconColor={colors.textFaint} size={52} />
              <AppText variant="bodyBold" center style={styles.emptyTitle}>
                No matches
              </AppText>
              <AppText variant="body" color={colors.textDim} center>
                Try a different name or muscle group.
              </AppText>
            </Animated.View>
          }
        />
      </Animated.View>
    </View>
    </KeyboardAvoidingView>
  );
}
