import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
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
import type { InviteInfo, Referral, RewardsErrorCode } from '../../../../lib/api/client';
import {
  avatarLetter,
  formatInviteCode,
  inviteShareMessage,
  referralErrorLine,
  referralOutcome,
  referralStatusLabel,
} from '../logic';

/**
 * Invite-friends section: the member's shareable code (sent by the member
 * themselves through the share sheet), the optional "save their email" path,
 * and the list of invites so far.
 *
 * Two honesty rules hold this screen together. Nothing here says an invite was
 * delivered — the app has no way to message anyone, so the member always does
 * the sending. And a row only claims a discount when the server says one
 * actually landed (`discountEarned`); a friend who already had an account is
 * recorded but earns nobody anything, and now reads that way.
 */

interface Props {
  referrals: Referral[];
  /** The member's own code and reward terms. null while the first load is in flight. */
  invite: InviteInfo | null;
  onRefer: (email: string) => Promise<RewardsErrorCode | null>;
  onReload: () => void;
}

export function ReferralSection({ referrals, invite, onRefer, onReload }: Props) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const code = invite?.code ?? null;

  async function handleShare(): Promise<void> {
    if (!invite || !code) return;
    setShareNote(null);
    try {
      await Share.share({ message: inviteShareMessage(invite, code) });
    } catch {
      // The sheet couldn't open (or isn't available here) — the code is on
      // screen either way, so say that instead of pretending it worked.
      setShareNote('Sharing didn’t open. Your code is right above.');
    }
  }

  async function handleRefer(): Promise<void> {
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    setSaved(false);
    const failure = await onRefer(email);
    setSending(false);
    if (failure === null) {
      setEmail('');
      setSaved(true);
      onReload();
    } else {
      setError(referralErrorLine(failure));
    }
  }

  const joinedCount = referrals.filter((r) => referralOutcome(r) === 'earned').length;
  const rewardLine = invite
    ? `For every friend who joins with your code, you both get ${invite.discountPct}% off a membership. The discount lasts ${invite.rewardDays} days.`
    : 'For every friend who joins with your code, you both get a membership discount.';

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
            {rewardLine}
            {joinedCount > 0
              ? ` ${joinedCount} friend${joinedCount > 1 ? 's' : ''} joined so far!`
              : ''}
          </AppText>
        </View>
      </Card>

      {/* ── Your code — the member sends this themselves ─────────── */}
      {code ? (
        <View style={styles.codeCard}>
          <AppText variant="label" color={colors.textDim}>
            Your invite code
          </AppText>
          <AppText
            variant="title"
            tabular
            style={styles.codeText}
            accessibilityLabel={`Your invite code is ${formatInviteCode(code)}`}
          >
            {formatInviteCode(code)}
          </AppText>
          <Button label="Share code" variant="primary" onPress={() => void handleShare()} />
          <AppText variant="caption" color={colors.textFaint}>
            Send it however you like. Your friend enters it in the app after
            they join.
          </AppText>
          {shareNote ? (
            <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
              <AppText variant="caption" color={colors.warning}>
                {shareNote}
              </AppText>
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      {/* ── Or save their email ──────────────────────────────────── */}
      <View style={styles.formCard}>
        <AppText variant="label" color={colors.textDim}>
          Or save their email
        </AppText>
        <AppText variant="caption" color={colors.textFaint}>
          We don’t message them. Save the address and the discount is added
          for both of you the moment they sign up with it.
        </AppText>
        <AppTextInput
          value={email}
          onChangeText={setEmail}
          placeholder="friend@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void handleRefer()}
          accessibilityLabel="Friend's email address"
          style={styles.textInput}
        />
        <Button
          label={sending ? 'Saving…' : 'Save email'}
          variant="secondary"
          onPress={() => void handleRefer()}
          disabled={!email.trim() || sending}
          loading={sending}
          style={styles.formBtn}
        />
        {saved ? (
          <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
            <AppText variant="body" color={colors.success} style={styles.formMsg}>
              Saved. Tell them to sign up with that email and you both get the
              discount.
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
          {referrals.map((ref, i) => {
            const outcome = referralOutcome(ref);
            return (
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
                    color={outcome === 'earned' ? colors.success : colors.textDim}
                  >
                    {referralStatusLabel(ref)}
                  </AppText>
                </View>
                {outcome === 'earned' ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                ) : outcome === 'waiting' ? (
                  <Ionicons name="hourglass-outline" size={22} color={colors.textFaint} />
                ) : (
                  <Ionicons
                    name="information-circle-outline"
                    size={22}
                    color={colors.textFaint}
                  />
                )}
              </Animated.View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Cream hero + charcoal modules — block language, no borders.
  referralCream: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  referralHeroText: { flex: 1, gap: spacing.xs },
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  codeText: { letterSpacing: 1.5 },
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
