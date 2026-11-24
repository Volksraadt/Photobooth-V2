import { Component, type ErrorInfo, type ReactNode } from 'react';

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
