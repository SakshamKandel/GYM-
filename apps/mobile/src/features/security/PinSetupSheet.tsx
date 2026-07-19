import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, Sheet } from '../../components/ui';
import { hashPin, isValidPin } from './pin';

/**
 * PIN app-lock setup (Pack P) — a two-step (enter, confirm) 4-8 digit PIN
 * sheet. Purely local: on success it calls `onSet` with the SHA-256 digest
 * (see pin.ts) for the caller to persist via `useSecurity.setPinHash` — this
 * component never touches the store directly, so it's reusable from both
 * the "set a PIN" and "change PIN" entry points in Settings.
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  onSet: (hash: string) => void;
}

export function PinSetupSheet({ visible, onClose, onSet }: Props) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [first, setFirst] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset(): void {
    setStep('enter');
    setFirst('');
    setDraft('');
    setError(null);
    setBusy(false);
  }

  function close(): void {
    reset();
    onClose();
  }

  function submitFirst(): void {
    if (!isValidPin(draft)) {
      setError('Enter 4 to 8 digits.');
      return;
    }
    setFirst(draft);
    setDraft('');
    setError(null);
    setStep('confirm');
  }

  async function submitConfirm(): Promise<void> {
    if (draft !== first) {
      setError("PINs didn't match — try again.");
      setDraft('');
      return;
    }
    setBusy(true);
    try {
      const hash = await hashPin(first);
      onSet(hash);
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={close} title={step === 'enter' ? 'Set a PIN' : 'Confirm PIN'}>
      <View style={styles.body}>
        <AppText variant="body" color={colors.textDim}>
          {step === 'enter'
            ? 'Choose a 4-8 digit PIN to unlock the app when fingerprint/face unlock isn’t available.'
            : 'Enter it once more to confirm.'}
        </AppText>
        <AppTextInput
          value={draft}
          onChangeText={(v) => {
            setDraft(v.replace(/\D/g, '').slice(0, 8));
            setError(null);
          }}
          placeholder="Enter PIN"
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          textAlign="center"
          maxLength={8}
          onSubmitEditing={() => (step === 'enter' ? submitFirst() : void submitConfirm())}
          editable={!busy}
          accessibilityLabel={step === 'enter' ? 'New PIN' : 'Confirm PIN'}
          style={styles.input}
        />
        {error ? (
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        ) : null}
        <Button
          label={busy ? 'Saving…' : step === 'enter' ? 'Continue' : 'Confirm'}
          onPress={() => (step === 'enter' ? submitFirst() : void submitConfirm())}
          disabled={busy || draft.length < 4}
          loading={busy}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  input: { fontSize: 22, letterSpacing: 8 },
});
