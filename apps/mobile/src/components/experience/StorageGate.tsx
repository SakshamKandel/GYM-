import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getRepo } from '../../lib/repo';
import { RecoveryScreen } from './RecoveryScreen';

/**
 * Says something when the on-device database cannot be opened.
 *
 * The local store is created once per app run and the result is held for the
 * rest of it, so a single failed initialisation used to poison every read and
 * every write until the app was force-quit, silently: screens sat on empty
 * lists, logged sets vanished, and nothing anywhere said why. The store now
 * retries internally before giving up (lib/repo/sqlite.ts); this is the surface
 * for the case where it still could not open.
 *
 * The check is deliberately NOT a startup gate. Children render immediately and
 * the probe runs alongside them, so a healthy phone pays nothing for this. Only
 * a genuine failure takes the screen over, because at that point the app cannot
 * honestly show anything else.
 */
export function StorageGate({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const aliveRef = useRef(true);

  const probe = useCallback(() => {
    void getRepo().then(
      () => {
        if (aliveRef.current) setFailed(false);
      },
      () => {
        if (aliveRef.current) setFailed(true);
      },
    );
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    probe();
    return () => {
      aliveRef.current = false;
    };
  }, [probe]);

  if (!failed) return <>{children}</>;

  return (
    <RecoveryScreen
      title="We can't open your training data"
      body={
        attempt === 0
          ? "Anything you log right now might not be saved. Try again, and if that doesn't help, close the app fully and open it again."
          : "It's still not working. Close the app fully and open it again. Your saved training is safe on this phone."
      }
      actionLabel="Try again"
      onAction={() => {
        setAttempt((n) => n + 1);
        probe();
      }}
    />
  );
}
