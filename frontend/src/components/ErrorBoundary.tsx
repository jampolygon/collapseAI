import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Plain-language message shown instead of the broken screen. */
  message: string;
  children: ReactNode;
}

// Without this, one failed screen (for example the map's code missing offline) blanks the whole app.
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen failed to load', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page-content">
        <div className="banner warn" role="alert">
          <span className="banner-label">Problem</span>
          <span>{this.props.message}</span>
          <button className="link" onClick={() => this.setState({ failed: false })}>Try again</button>
        </div>
      </div>
    );
  }
}
