import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import type { CoachMessage } from '../../../lib/api/client';
import { TypingDots } from './TypingDots';

/**
 * One chat bubble. User messages sit right-aligned in a solid red bubble;
 * coach messages sit left-aligned in a surface bubble with a small Newie
 * (mascot) avatar so a reply reads as "from Greece", not the system.
 *
 * Consecutive messages from one sender are grouped: the avatar + tail corner +
 * a quiet timestamp show only on the last of a run, and inner messages tuck in
 * tight. When a coach avatar is hidden its width is reserved so bubbles stay
 * aligned down the column.
 */

const NEWIE = require('../../../../assets/images/newie.png');

const AVATAR = 30;

interface Props {
  message: CoachMessage;
  /** First of a run from the same sender — gets the group's top spacing. */
  firstInGroup?: boolean;
  /** Last of a run — carries the tail corner, timestamp, and (coach) avatar. */
  lastInGroup?: boolean;
  /** Coach avatar renders only on the last bubble of a coach run. */
  showAvatar?: boolean;
  /** Render the animated "Greece is typing" indicator instead of body text. */
  typing?: boolean;
}

/** "3:42 PM" — local wall-clock, deterministic (no Intl dependency). */
function clockLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  rowUser: { justifyContent: 'flex-end' },
  rowCoach: { justifyContent: 'flex-start' },
  groupStart: { marginTop: spacing.sm },
  grouped: { marginTop: 2 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  avatarSpacer: { width: AVATAR },
  col: { flexShrink: 1, maxWidth: '80%' },
  colUser: { alignItems: 'flex-end' },
  colCoach: { alignItems: 'flex-start' },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  userBubble: { backgroundColor: colors.accent },
  coachBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userTail: { borderBottomRightRadius: radius.sm },
  coachTail: { borderBottomLeftRadius: radius.sm },
  time: { marginTop: 4, marginHorizontal: 4 },
});

export function MessageBubble({
  message,
  firstInGroup = true,
  lastInGroup = true,
  showAvatar = true,
  typing = false,
}: Props) {
  const isUser = message.sender === 'user';
  const time = typing ? '' : clockLabel(message.createdAt);

  return (
    <View
      style={[
        styles.row,
        isUser ? styles.rowUser : styles.rowCoach,
        firstInGroup ? styles.groupStart : styles.grouped,
      ]}
    >
      {!isUser ? (
        showAvatar ? (
          <Image
            source={NEWIE}
            style={styles.avatar}
            contentFit="cover"
            contentPosition="top"
            accessibilityLabel="Greece"
          />
        ) : (
          <View style={styles.avatarSpacer} />
        )
      ) : null}

      <View style={[styles.col, isUser ? styles.colUser : styles.colCoach]}>
        <View
          accessible={typing || undefined}
          accessibilityLabel={typing ? 'Greece is typing' : undefined}
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.coachBubble,
            lastInGroup ? (isUser ? styles.userTail : styles.coachTail) : null,
          ]}
        >
          {typing ? (
            <TypingDots />
          ) : (
            <AppText color={isUser ? colors.onAccent : colors.text}>{message.body}</AppText>
          )}
        </View>

        {lastInGroup && time ? (
          <AppText variant="label" color={colors.textFaint} style={styles.time}>
            {time}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
