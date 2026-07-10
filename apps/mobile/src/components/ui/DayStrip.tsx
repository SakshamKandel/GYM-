import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { addDays, dayLabel, todayIso } from '../../lib/dates';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Horizontal day selector (revamp): pill-shaped day cells; the selected day
 * is a solid signal-red pill with BLACK text (block language). A red dot
 * marks days with activity — it flips to black on the selected red pill.
 */
interface Props {
  selected: string; // ISO date
  onSelect: (date: string) => void;
  /** ISO dates that get the activity dot. */
  markedDates?: Set<string>;
  daysBack?: number;
  daysForward?: number;
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  cell: {
    width: 56,
    height: 84,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  cellSelected: { backgroundColor: colors.accent },
  dotSlot: { height: 8, justifyContent: 'center' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  dotSelected: { backgroundColor: colors.onBlock },
});

export function DayStrip({
  selected,
  onSelect,
  markedDates,
  daysBack = 14,
  daysForward = 3,
}: Props) {
  const today = todayIso();
  const dates: string[] = [];
  for (let i = -daysBack; i <= daysForward; i++) dates.push(addDays(today, i));

  // contentOffset is a no-op on react-native-web — scroll to today via ref.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: false }),
      0,
    );
    return () => clearTimeout(t);
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {dates.map((date) => {
        const isSelected = date === selected;
        const isToday = date === today;
        return (
          <PressableScale
            key={date}
            accessibilityRole="button"
            accessibilityLabel={`${dayLabel(date)} ${date}${isToday ? ', today' : ''}`}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(date)}
            style={[styles.cell, isSelected && styles.cellSelected]}
          >
            <View style={styles.dotSlot}>
              {markedDates?.has(date) ? (
                <View style={[styles.dot, isSelected && styles.dotSelected]} />
              ) : null}
            </View>
            <AppText
              variant="display"
              color={isSelected ? colors.onBlock : colors.text}
              style={{ fontSize: 26, lineHeight: 32 }}
              tabular
            >
              {date.slice(8)}
            </AppText>
            <AppText
              variant="caption"
              color={
                isSelected
                  ? colors.onBlock
                  : isToday
                    ? colors.accent
                    : colors.textDim
              }
            >
              {dayLabel(date).charAt(0) + dayLabel(date).slice(1).toLowerCase()}
            </AppText>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
