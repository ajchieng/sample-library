import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time errors anywhere below it and shows a recovery screen
 * instead of a blank window. Must be a class component — React only supports
 * error boundaries via the class lifecycle (`getDerivedStateFromError` /
 * `componentDidCatch`).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the crash in the console/devtools for debugging; there's no
    // remote logging (the app is local-first).
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app">
        <div className="empty-state">
          <p className="empty-title">Something went wrong</p>
          <p className="empty-sub">
            The interface hit an unexpected error. Your library and audio files
            are untouched — reloading usually fixes it.
          </p>
          <p className="empty-code">{error.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
