import React from 'react';

// Top-level safety net: if any page throws during render (e.g. an unexpected
// null from a failed API call), show a friendly fallback instead of a blank
// white screen. Uses plain anchors so it works even without router context.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Developer-facing log only — never shown to the user.
    console.error('UI ErrorBoundary caught a render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', color: '#e2e8f0', textAlign: 'center', padding: '24px'
        }}>
          <div style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 56, fontWeight: 800, color: '#f87171' }}>500</div>
            <h1 style={{ margin: '8px 0' }}>Something went wrong</h1>
            <p style={{ color: '#94a3b8' }}>
              FlowGuard hit an unexpected error while rendering this view. Your data is safe —
              try reloading, or head back to the command center.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
              <button
                onClick={() => window.location.reload()}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer' }}
              >
                Reload
              </button>
              <a
                href="/dashboard"
                style={{ padding: '10px 18px', borderRadius: 8, background: '#2563eb', color: '#fff', textDecoration: 'none' }}
              >
                Back to Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
