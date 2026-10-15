import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors so a crash shows a readable message instead of a
 * blank (black) screen. Uses inline styles deliberately — it must render even
 * if the stylesheet or other assets failed to load.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the details in the console for debugging.
    console.error('StudyBoard crashed:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#070b1a',
          color: '#e9ecfc',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: '36rem',
            padding: '1.75rem',
            borderRadius: '1.25rem',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(20,24,46,0.7)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: '0.75rem', color: '#b2b8d6', fontSize: '0.95rem' }}>
            The app hit an error while starting. The details are in the browser console.
          </p>
          <pre
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              borderRadius: '0.75rem',
              background: 'rgba(0,0,0,0.35)',
              color: '#ff9aa8',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.25rem',
              padding: '0.6rem 1.2rem',
              borderRadius: '9999px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#5865f2',
              color: '#fff',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
