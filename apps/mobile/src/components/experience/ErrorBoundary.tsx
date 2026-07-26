import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { RecoveryScreen } from './RecoveryScreen';

/**
 * React error boundary — the app's last line of defence.
 *
 * Without one, a single component that throws during render unmounts the WHOLE
 * tree and leaves a blank canvas with no way back: the member has to force-quit
 * the app. This catches the throw, shows a plain recovery screen and remounts a
 * fresh copy of the subtree when they tap "Try again" (the `attempt` key is
 * what makes it a genuine remount rather than a re-render of the same broken
 * instances).
 *
 * Everything here is defensive on purpose. The fallback uses only React Native
 * primitives (see RecoveryScreen), the crash log is wrapped, and the retry hook
 * is wrapped, so the recovery path itself has nothing left that can throw.
 *
 * Boundaries are cheap and they are best nested: an inner one keeps a crash
 * local to the screen that caused it, the root one catches whatever escapes.
 */

interface Props {
  children: ReactNode;
  /** Where this boundary sits. Used for the crash log only, never shown. */
  area?: string;
  /** Optional cleanup to run before the subtree is remounted. */
  onRetry?: () => void;
}

interface State {
  crashed: boolean;
  /** Bumped on every retry so the children mount fresh. */
  attempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false, attempt: 0 };

  static getDerivedStateFromError(): Pick<State, 'crashed'> {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      console.error(`[${this.props.area ?? 'app'}] recovered from a crash`, error, info.componentStack);
    } catch {
      // Logging must never be the reason a recovery screen fails to appear.
    }
  }

  private readonly retry = (): void => {
    try {
      this.props.onRetry?.();
    } catch {
      // A failing cleanup hook must not block the remount.
    }
    this.setState((s) => ({ crashed: false, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.crashed) {
      return (
        <RecoveryScreen
          title="Something went wrong"
          body="This part of the app stopped working. Nothing you have logged is lost. Try again, and if it keeps happening, close the app and open it again."
          actionLabel="Try again"
          onAction={this.retry}
        />
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
