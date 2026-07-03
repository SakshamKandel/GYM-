import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText } from '../../../components/ui';
import type { CoachMessage } from '../../../lib/api/client';

/**
 * One chat bubble. User messages sit right-aligned in a solid red bubble;
 * coach messages sit left-aligned in a surface bubble with a small Newie
 * (mascot) avatar so a reply reads as "from Greece", not the system.
 */

const NEWIE = require('../../../../assets/images/newie.png');

interface Props {
  message: CoachMessage;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginVertical: 4,
  },
  rowUser: { justifyContent: 'flex-end' },
  rowCoach: { justifyContent: 'flex-start' },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  userBubble: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  coachBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
});

export function MessageBubble({ message }: Props) {
  const isUser = message.sender === 'user';
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowCoach]}>
      {!isUser ? (
        <Image
          source={NEWIE}
          style={styles.avatar}
          contentFit="cover"
          accessibilityLabel="Greece"
        />
      ) : null}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.coachBubble]}>
        <AppText color={isUser ? colors.onAccent : colors.text}>{message.body}</AppText>
      </View>
    </View>
  );
}
