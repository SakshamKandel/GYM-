import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@gym/ui-tokens';
import { AppText, AppTextInput, Button, Sheet } from '../../components/ui';
import { BASE_URL, fetchWithTimeout } from '../../lib/api/client';
import { useAuth } from '../../state/auth';

/**
 * Staff step-up re-authentication (plan §3 item 14).
 *
 * Destructive admin actions (role grant/revoke/offboard, tier override) route
 * through {@link useReauth}'s `guard`. When the caller re-entered their password
 * within the last {@link REAUTH_TTL_MS}, the action runs immediately; otherwise
 * the {@link ReauthSheet} prompts for the password first and runs the action
 * only after POST /api/staff/reauth confirms it.
 *
 * The freshness flag lives ONLY in module memory — never persisted, never a
 * server session (5-minute TTL, cleared on app restart). It's an ADDITIONAL
 * friction gate; the web routes stay independently permission-guarded, so a
 * bypassed client check still can't perform the mutation.
 *
 * Password re-entry only — no biometrics, no native deps. TOTP-based 2FA for
 * roles.grant holders is a deferred follow-up (plan §3 item 14).
 */

const REAUTH_TTL_MS = 5 * 60 * 1000;

/**
 * The last successful step-up, scoped to the token it was proven against. A
 * sign-out or account switch changes the token, so freshness never carries into
 * a different session. In memory only — a cold app start always re-prompts.
 */
let lastReauth: { token: string; at: number } | null = null;

function isReauthFresh(token: string): boolean {
  return (
    lastReauth !== null &&
    lastReauth.token === token &&
    Date.now() - lastReauth.at < REAUTH_TTL_MS
  );
}

function markReauthed(token: string): void {
  lastReauth = { token, at: Date.now() };
}

/** Typed outcomes of the re-auth POST — kept local so this gate is standalone. */
type ReauthError = 'bad_password' | 'no_password' | 'unauthorized' | 'rate_limited' | 'network';

class ReauthApiError extends Error {
  readonly code: ReauthError;
  constructor(code: ReauthError) {
    super(code);
    this.name = 'ReauthApiError';
    this.code = code;
  }
}

/**
 * POST /api/staff/reauth with the caller's password. Resolves on a verified
 * step-up; throws {@link ReauthApiError} otherwise. Uses the shared
 * fetchWithTimeout so a hung connection can't wedge the sheet (defect class H1).
 */
async function verifyReauth(token: string, password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}/api/staff/reauth`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password }),
      },
      15_000,
    );
  } catch {
    throw new ReauthApiError('network');
  }

  if (res.ok) return;

  let bodyError: string | undefined;
  try {
    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object') {
      const err = (body as { error?: unknown }).error;
      if (typeof err === 'string') bodyError = err;
    }
  } catch {
    // Non-JSON error body — fall back to the status code below.
  }

  if (bodyError === 'no_password') throw new ReauthApiError('no_password');
  if (res.status === 401) {
    // The route returns 401 for a wrong password (bad_credentials) AND for a
    // missing session (unauthorized) — the body distinguishes them.
    throw new ReauthApiError(bodyError === 'unauthorized' ? 'unauthorized' : 'bad_password');
  }
  if (res.status === 403) throw new ReauthApiError('unauthorized');
  if (res.status === 429) throw new ReauthApiError('rate_limited');
  throw new ReauthApiError('network');
}

function failLine(code: ReauthError): string {
  switch (code) {
    case 'bad_password':
      return "That password isn't right. Try again.";
    case 'no_password':
      return 'This account signs in with Google and has no password to confirm. Set a password first.';
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'rate_limited':
      return 'Too many attempts — wait a minute and try again.';
    default:
      return "Couldn't reach the server. Try again.";
  }
}

/** A deferred destructive action awaiting a fresh step-up. */
type PendingAction = () => void | Promise<void>;

export interface ReauthController {
  /**
   * Run `action` now when the step-up is fresh; otherwise open the sheet, prompt
   * for the password, and run `action` only after a successful re-auth. A
   * cancelled prompt never runs the action.
   */
  guard: (action: PendingAction) => void;

  // ── Internal sheet state (consumed by ReauthSheet) ──
  readonly visible: boolean;
  readonly password: string;
  readonly busy: boolean;
  readonly error: string | null;
  setPassword: (value: string) => void;
  cancel: () => void;
  submit: () => void;
}

/**
 * Hook powering a step-up gate. Pair it with a single {@link ReauthSheet} in the
 * same screen:
 *
 *   const reauth = useReauth();
 *   // ...
 *   <Button onPress={() => reauth.guard(() => void doDestructiveThing())} />
 *   <ReauthSheet controller={reauth} />
 */
export function useReauth(): ReauthController {
  const token = useAuth((s) => s.token);
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingAction | null>(null);

  const guard = useCallback(
    (action: PendingAction) => {
      // Signed out: the destructive action's own token guard will no-op, so
      // there's nothing to step up against — just let it through.
      if (!token || isReauthFresh(token)) {
        void action();
        return;
      }
      pendingRef.current = action;
      setPassword('');
      setError(null);
      setBusy(false);
      setVisible(true);
    },
    [token],
  );

  const cancel = useCallback(() => {
    if (busy) return;
    pendingRef.current = null;
    setVisible(false);
    setPassword('');
    setError(null);
  }, [busy]);

  const submit = useCallback(() => {
    void (async () => {
      if (!token || busy) return;
      if (!password) {
        setError('Enter your password to continue.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await verifyReauth(token, password);
        markReauthed(token);
        const action = pendingRef.current;
        pendingRef.current = null;
        setVisible(false);
        setPassword('');
        setBusy(false);
        if (action) void action();
      } catch (e) {
        const code = e instanceof ReauthApiError ? e.code : 'network';
        setError(failLine(code));
        setBusy(false);
      }
    })();
  }, [token, password, busy]);

  return { guard, visible, password, busy, error, setPassword, cancel, submit };
}

/**
 * The password step-up sheet. Controlled entirely by a {@link ReauthController}
 * from {@link useReauth}; render exactly one per screen. a11y: labelled secure
 * field, ≥48dp targets (Button/Sheet primitives), body copy ≥16px, tokens only.
 */
export function ReauthSheet({ controller }: { controller: ReauthController }) {
  const { visible, password, busy, error, setPassword, cancel, submit } = controller;
  return (
    <Sheet visible={visible} onClose={cancel} title="Confirm it's you">
      <View style={styles.body}>
        <AppText variant="body" color={colors.textDim}>
          Re-enter your password to continue with this action. You won't be asked
          again for a few minutes.
        </AppText>

        <AppTextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          accessibilityLabel="Your account password"
        />

        {error ? (
          <AppText variant="caption" color={colors.error}>
            {error}
          </AppText>
        ) : null}

        <View style={styles.buttons}>
          <Button
            label="Cancel"
            variant="secondary"
            style={styles.btn}
            onPress={cancel}
            disabled={busy}
          />
          <Button
            label={busy ? 'Confirming…' : 'Confirm'}
            style={styles.btn}
            onPress={submit}
            disabled={busy || !password}
            loading={busy}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  btn: { flex: 1 },
});
