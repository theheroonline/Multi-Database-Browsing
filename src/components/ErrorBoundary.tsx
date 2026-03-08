import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "../lib/errorLog";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(error, {
      source: "react.error-boundary",
      message: "React component rendering failed",
      detail: errorInfo.componentStack
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mdb-fatal-error">
          <div className="mdb-fatal-error-card">
            <h2>Application crashed</h2>
            <p>An unrecoverable rendering error occurred. Open the error log from the sidebar after refresh.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}