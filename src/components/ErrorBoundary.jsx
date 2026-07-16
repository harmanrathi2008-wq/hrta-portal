import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an exception:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRecovery = () => {
    // Clear storage/cache and refresh to restore normal flow
    try {
      const examId = window.location.pathname.split('/exam/')[1]?.split('/')[0];
      if (examId) {
        const userId = sessionStorage.getItem("userId");
        localStorage.removeItem(`exam_responses_${examId}_${userId}`);
        localStorage.removeItem(`exam_status_${examId}_${userId}`);
      }
    } catch (e) {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at center, #1a1b2f 0%, #0f101d 100%)',
          fontFamily: "'Outfit', 'Inter', sans-serif",
          color: '#ffffff',
          padding: '24px'
        }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '24px',
            padding: '48px 32px',
            maxWidth: '540px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px'
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>

            <h2 style={{
              fontSize: '24px',
              fontWeight: '700',
              marginBottom: '12px',
              letterSpacing: '-0.02em',
              background: 'linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Something Went Wrong
            </h2>

            <p style={{
              fontSize: '15px',
              color: 'rgba(255, 255, 255, 0.6)',
              lineHeight: '1.6',
              marginBottom: '28px'
            }}>
              An unexpected system crash was intercepted. Your progress has been saved in local cache. You can attempt to restore access safely below.
            </p>

            {this.state.error && (
              <div style={{
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'left',
                fontSize: '13px',
                fontFamily: 'monospace',
                color: '#f87171',
                overflowX: 'auto',
                marginBottom: '32px',
                maxHeight: '120px'
              }}>
                <strong>Error:</strong> {this.state.error.toString()}
              </div>
            )}

            <button
              onClick={this.handleRecovery}
              style={{
                width: '100%',
                padding: '14px 28px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                border: 'none',
                fontWeight: '600',
                fontSize: '15px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 8px 16px rgba(99, 102, 241, 0.25)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 12px 24px rgba(99, 102, 241, 0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 8px 16px rgba(99, 102, 241, 0.25)';
              }}
            >
              Attempt Recovery
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
