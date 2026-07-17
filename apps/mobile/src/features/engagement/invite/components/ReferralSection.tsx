import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  AppTextInput,
  Button,
  Card,
  enterFade,
  layoutSpring,
} from '../../../../components/ui';
import type { Referral, RewardsErrorCode } from '../../../../lib/api/client';
import { avatarLetter, referralErrorLine, referralStatusLabel } from '../logic';

/**
 * Invite-friends section — cream hero explainer, the email form, and the
 * sent-invite status list. Lifted from the retired Buddy tab; now the body
 * of the dedicated /invite screen (reached from Settings).
 *
 * An 'already_enrolled' response renders as a quiet informational line (the
 * person simply isn't eligible — nothing went wrong); every other failure
 * renders as an error line. Both are polite live regions for screen readers.
 */

interface Props {
  referrals: Referral[];
  onRefer: (email: string) => Promise<RewardsErrorCode | null>;
  onReload: () => void;
}

export function ReferralSection({ referrals, onRefer, onReload }: Props) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleRefer() {
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    setInfo(null);
    setSuccess(false);
    const code = await onRefer(email);
    setSending(false);
    if (code === null) {
      setEmail('');
      setSuccess(true);
      onReload();
    } else if (code === 'already_enrolled') {
      // Informational, not an error — they just can't be invited.
      setInfo(referralErrorLine(code));
    } else {
      setError(referralErrorLine(code));
    }
  }

  const joinedCount = referrals.filter(
    (r) => r.status === 'joined' || r.status === 'rewarded',
  ).length;

  return (
    <View>
      {/* Cream counterpoint block — the screen's one cream card. */}
      <Card variant="cream" style={styles.referralCream}>
        <Ionicons name="gift-outline" size={28} color={colors.onBlock} />
        <View style={styles.referralHeroText}>
          <AppText variant="title" color={colors.onBlock}>
            Invite friends, earn discounts
          </AppText>
          <AppText variant="body" color={colors.creamDim}>
            For every friend who joins, you both get a subscription discount.
            {joinedCount > 0
              ? ` ${joinedCount} friend${joinedCount > 1 ? 's' : ''} joined so far!`
              : ''}
          </AppText>
        </View>
      </Card>

      <View style={styles.formCard}>
        <AppTextInput
          value={email}
          onChangeText={setEmail}
          placeholder="friend@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={handleRefer}
          accessibilityLabel="Friend's email address"
          style={styles.textInput}
        />
        <Button
          label={sending ? 'Sending…' : 'Send invite'}
          variant="primary"
          onPress={handleRefer}
          disabled={!email.trim() || sending}
          loading={sending}
          style={styles.formBtn}
        />
        {success ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="body" color={colors.success} style={styles.formMsg}>
              Invite sent! You&apos;ll get a discount when they join.
            </AppText>
          </Animated.View>
        ) : null}
        {info ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="body" color={colors.warning} style={styles.formMsg}>
              {info}
            </AppText>
          </Animated.View>
        ) : null}
        {error ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="body" color={colors.error} style={styles.formMsg}>
              {error}
            </AppText>
          </Animated.View>
        ) : null}
      </View>

      {referrals.length > 0 ? (
        <View style={styles.referralList}>
          {referrals.map((ref, i) => (
            <Animated.View
              key={ref.id}
              entering={enterFade(i)}
              layout={layoutSpring}
              style={styles.referralRow}
            >
              <View style={styles.avatar}>
                <AppText variant="title" color={colors.textDim}>
                  {avatarLetter(ref.inviteeEmail)}
                </AppText>
              </View>
              <View style={styles.rowInfo}>
                <AppText variant="body" numberOfLines={1}>
                  {ref.inviteeEmail}
                </AppText>
                <AppText
                  variant="caption"
                  color={
                    ref.status === 'rewarded'
                      ? colors.success
                      : ref.status === 'joined'
                        ? colors.accent
                        : colors.textDim
                  }
                >
                  {referralStatusLabel(ref.status)}
                </AppText>
              </View>
              {ref.status === 'joined' || ref.status === 'rewarded' ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              ) : (
                <Ionicons name="hourglass-outline" size={22} color={colors.textFaint} />
              )}
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Cream hero + charcoal form module — block language, no borders.
  referralCream: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  referralHeroText: { flex: 1, gap: spacing.xs },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  textInput: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
  },
  formBtn: { marginTop: spacing.xs },
  formMsg: { marginTop: spacing.xs },
  referralList: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  referralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
});
