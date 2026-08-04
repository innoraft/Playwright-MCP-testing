import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password states
  const [view, setView] = useState('login'); // 'login' | 'forgot'
  const [forgotUsername, setForgotUsername] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!forgotUsername.trim()) {
      setError('Username is required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSuccessMsg(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchView = (v) => {
    setView(v);
    setError('');
    setSuccessMsg('');
  };

  return (
    <div className="login-wrapper container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <div className="sidebar-logo-icon text-center" style={{ width: 48, height: 48, fontSize: 24 }}>⚡</div>
          </div>
          <h1 className="login-title text-center">AI testing</h1>
          <p className="login-subtitle text-center">
            {view === 'login' && 'Sign in to your account'}
            {view === 'forgot' && 'Request a password reset'}
          </p>
        </div>

        {error && (
          <div className="login-error">
            <span>❌</span> {error}
          </div>
        )}

        {successMsg && (
          <div className="login-success">
            <span>✅</span> {successMsg}
          </div>
        )}

        {/* ── Login Form ── */}
        {view === 'login' && (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary login-btn"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="login-links">
              <button type="button" className="login-link-btn" onClick={() => switchView('forgot')}>
                Forgot your password?
              </button>
            </div>
          </form>
        )}

        {/* ── Forgot Password Form ── */}
        {view === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="login-form">
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter your username"
                value={forgotUsername}
                onChange={(e) => setForgotUsername(e.target.value)}
                autoFocus
              />
            </div>

            <p className="login-help-text">
              Your administrator will be notified and will set a new password for you.
            </p>

            <button
              type="submit"
              className="btn btn-primary login-btn"
              disabled={loading}
            >
              {loading ? 'Submitting...' : 'Request Password Reset'}
            </button>

            <div className="login-links">
              <button type="button" className="login-link-btn" onClick={() => switchView('login')}>
                ← Back to Sign In
              </button>
            </div>
          </form>
        )}

        <div className="login-footer">
          <p>Contact your administrator for account access</p>
        </div>
      </div>
    </div>
  );
}
