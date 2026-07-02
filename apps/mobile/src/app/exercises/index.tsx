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
  Divider,
  enterDown,
  enterUp,
} from '../../components/ui';
import { pushPath } from '../../features/training/nav';
import { useSession } from '../../features/training/session';
import { MUSCLE_GROUPS, searchExercises } from '../../lib/exercises';

/**
 * Exercise library — 873 bundled exercises, fully offline.
 * ?select=1 → picker mode: tapping adds to the active session and returns.
 */

/** Breathing room above the header — matches Screen's TOP_AIR so the back
 * button never kisses the viewport edge even when insets are 0 (web). */
const TOP_AIR = 16;
/** Keep phone-first line lengths on wide viewports — same cap as Screen. */
const MAX_CONTENT_WIDTH = 640;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  /** Center the content column on wide viewports (web/tablet). FlashList's
   * contentContainerStyle only supports padding, so the cap goes on the
   * header, the chip strip, and each row/separator instead. */
  contentCap: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  header: { paddingHorizontal: 20 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pill search field: the wrap carries the surface/border, the AppTextInput
  // inside goes transparent (it still kills the web focus ring internally).
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    height: touch.primary,
    marginTop: spacing.md,
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
  chipsRow: { gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: 20 },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 20,
    minHeight: 72,
  },
  // The bundled exercise photos have white backgrounds — a white rounded
  // chip makes them read as intentional icon tiles, not pasted images.
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.onAccent, // pure white, matching the image bg
  },
  rowText: { flex: 1 },
  separatorPad: { paddingHorizontal: 20 },
  emptyWrap: { alignItems: 'center', paddingTop: spacing.xxl },
});

/** Hairline between rows, inset to the content gutters and width-capped so it
 * tracks the centered column on wide viewports. */
function RowSeparator() {
  return (
    <View style={[styles.contentCap, styles.separatorPad]}>
      <Divider />
    </View>
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        selectMode ? `Add ${exercise.name} to workout` : `Open ${exercise.name}`
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.contentCap,
        styles.row,
        pressed && { backgroundColor: colors.surface },
      ]}
    >
      <Image
        source={exercise.imageUrls[0] ? { uri: exercise.imageUrls[0] } : undefined}
        style={styles.thumb}
        contentFit="contain"
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
  );
}

export default function ExerciseLibraryScreen() {
  const insets = useSafeAreaInsets();
  const { select } = useLocalSearchParams<{ select?: string }>();
  const selectMode = select === '1';
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const results = useMemo(
    () =>
      searchExercises({
        query: query.trim() ? query : undefined,
        muscleGroup: muscle ?? undefined,
      }),
    [query, muscle],
  );

  const handlePick = (exercise: Exercise): void => {
    if (selectMode) {
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
        <Animated.View entering={enterDown(0)} style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <View>
            <AppText variant="heading">{selectMode ? 'Add exercise' : 'Exercises'}</AppText>
          </View>
        </Animated.View>
        <Animated.View
          entering={enterDown(1)}
          style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}
        >
          <Ionicons name="search" size={18} color={colors.textDim} />
          <AppTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${searchExercises({}).length} exercises`}
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
              hitSlop={12}
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

      {/* FlashList is virtualized — animate the container only, never the rows. */}
      <Animated.View entering={enterUp(1)} style={styles.list}>
        <FlashList
          data={results}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <ExerciseRow exercise={item} selectMode={selectMode} onPress={() => handlePick(item)} />
          )}
          ItemSeparatorComponent={RowSeparator}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <AppText variant="body" color={colors.textDim}>
                No exercises match.
              </AppText>
            </View>
          }
        />
      </Animated.View>
    </View>
    </KeyboardAvoidingView>
  );
}
