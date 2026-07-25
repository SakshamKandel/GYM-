import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, enterFade } from '../../../../components/ui';
import type { InviteInfo, RewardsErrorCode } from '../../../../lib/api/client';
import { redeemErrorLine } from '../logic';

/**
 * "Got a code from a friend?" — the other half of the shareable code. Only
 * rendered when the server says this member can still use one
 * (`invite.canRedeem`), so the app never offers something that would be turned
 * down. The success line quotes the terms the server just granted rather than
 * a number typed into the app.
 */

interface Props {
  invite: InviteInfo;
  onRedeem: (code: string) => Promise<RewardsErrorCode | null>;
  /** Lets the screen keep this section mounted once the code is in. */
  onRedeemed: () => void;
  onReload: () => void;
}

export function RedeemCodeSection({ invite, onRedeem, onRedeemed, onReload }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleRedeem(): Promise<void> {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onRedeem(code);
    setBusy(false);
    if (failure === null) {
      setCode('');
      setDone(true);
      onRedeemed();
      onReload();
    } else {
      setError(redeemErrorLine(failure, invite.redeemWindowDays));
    }
  }

  if (done) {
    return (
      <View style={styles.card} accessibilityLiveRegion="polite">
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <AppText variant="body" color={colors.success} style={styles.doneText}>
            Code accepted. You have {invite.discountPct}% off for the next{' '}
            {invite.rewardDays} days, and so does your friend.
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <AppText variant="label" color={colors.textDim}>
        Got a code from a friend?
      </AppText>
      <AppText variant="caption" color={colors.textFaint}>
        Enter it in your first {invite.redeemWindowDays} days on the app. You
        both get {invite.discountPct}% off a membership, and it lasts{' '}
        {invite.rewardDays} days.
      </AppText>
      <AppTextInput
        value={code}
        onChangeText={setCode}
        placeholder="Paste their code"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void handleRedeem()}
        accessibilityLabel="Your friend's invite code"
        style={styles.input}
      />
      <Button
        label={busy ? 'Checking…' : 'Use code'}
        variant="secondary"
        onPress={() => void handleRedeem()}
        disabled={!code.trim() || busy}
        loading={busy}
      />
      {error ? (
        <Animated.View entering={enterFade(0)} accessibilityLiveRegion="polite">
          <AppText variant="body" color={colors.error}>
            {error}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
  },
  doneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  doneText: { flex: 1 },
});
