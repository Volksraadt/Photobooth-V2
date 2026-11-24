import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SystemScreen } from './system-screen';

type Props = {
  /** Changing the key clears the error (e.g. when the flow moves to another page). */
  resetKey: string;
  onError: (error: Error) => void;
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
};

type State = { error: Error | null; resetKey: string };

/** Render crash → report to the flow (→ Error page). Never leaves the screen blank. */
export class KioskErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kiosk] render error', error, info.componentStack);
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

/**
 * Outermost guard (audit S3): anything outside the page boundary that crashes (admin panel,
 * PIN pad, device screens, app shell) shows a system screen and reloads, never a white screen.
 * Session files are on the agent's disk, so a reload loses nothing that was stored.
 */
export class RootErrorBoundary extends Component<
  { children: ReactNode; reloadInSec?: number },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kiosk] fatal render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <SystemScreen
        title="Terjadi kesalahan"
        message="Booth memuat ulang. Jika berulang, hubungi petugas booth."
        retryInSec={this.props.reloadInSec ?? 15}
        onRetry={reload}
      />
    );
  }
}

const reload = () => window.location.reload();

/**
 * Guard for an overlay (admin panel, PIN pad): its crash closes it and leaves the booth page
 * running underneath, instead of taking the whole kiosk down.
 */
export class OverlayErrorBoundary extends Component<
  { children: ReactNode; onCrash: (error: Error) => void },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kiosk] overlay render error', error, info.componentStack);
    this.props.onCrash(error);
  }

  override render(): ReactNode {
    return this.state.error ? null : this.props.children;
  }
}
