/**
 * The last line before a blank page.
 *
 * React unmounts the whole tree when a render throws. Without a boundary that
 * means a white screen and a message in a console the user will never open —
 * and for a tool whose state lives only in the tab, it also means their work is
 * gone with no indication that it ever existed.
 *
 * So the boundary does one thing beyond apologising: it offers the project
 * back. The state that failed to *render* is almost always still valid, and
 * handing it over as a file is the difference between an annoyance and a lost
 * afternoon.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BRAND } from '../config/branding.js';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Produces the current project as text, if it can. Called *inside* the
   * failure path, so it is wrapped: a rescue that throws is worse than none.
   */
  rescue?: () => string;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged, not sent. There is no telemetry in this tool and adding some as
    // part of an error handler would be a surprising place to acquire it.
    console.error('Psychrometric Studio failed to render.', error, info);
    this.setState({ info: info.componentStack ?? null });
  }

  private download = (): void => {
    try {
      const text = this.props.rescue?.();
      if (!text) return;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'psychrometric-studio-recovered.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      requestAnimationFrame(() => URL.revokeObjectURL(url));
    } catch (error) {
      console.error('The project could not be recovered either.', error);
    }
  };

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash-body">
          <h1>{BRAND.appName} stopped</h1>
          <p>
            Something in the interface failed to draw. This is a bug in the tool,
            not something you did.
          </p>
          <p className="crash-message">{error.message}</p>

          {this.props.rescue && (
            <>
              <p>
                Your project is probably intact — it failed to draw, not to
                solve. Download it before reloading.
              </p>
              <button type="button" className="primary" onClick={this.download}>
                Download the project
              </button>
            </>
          )}

          <button type="button" onClick={() => window.location.reload()}>
            Reload the tool
          </button>

          {info && (
            <details>
              <summary>Technical detail</summary>
              <pre>{info}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
