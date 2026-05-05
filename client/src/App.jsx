import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import LLMConfig from './pages/LLMConfig';
import TestSuites from './pages/TestSuites';
import TestRunner from './pages/TestRunner';
import Reports from './pages/Reports';
import BaselineManager from './pages/BaselineManager';
import FileBrowser from './pages/FileBrowser';
import UserManagement from './pages/UserManagement';
import ChangePassword from './pages/ChangePassword';
import BestPracticesPopup from './components/BestPracticesPopup';
import './index.css';

function App() {
  const { user, isAdmin, isAuthenticated, loading, logout } = useAuth();
  const [activePage, setActivePage] = useState('test-suites');
  const [pendingReport, setPendingReport] = useState(null);
  const [showBestPractices, setShowBestPractices] = useState(false);
  const [testRunning, setTestRunning] = useState(false);

  // Redirect to allowed page when role changes
  useEffect(() => {
    if (isAuthenticated && !isAdmin && (activePage === 'llm-config' || activePage === 'users')) {
      setActivePage('test-suites');
    }
  }, [isAuthenticated, isAdmin, activePage]);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="login-wrapper">
        <div style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>Loading...</div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <Login />;
  }

  // Called by TestRunner when a run completes with a report file
  const handleNavigateToReport = (reportFile) => {
    setPendingReport(reportFile);
    setActivePage('reports');
  };

  // Clear pending report when navigating away from reports
  const handlePageChange = (page) => {
    // Guard: block navigation while a test is running
    if (testRunning && page !== 'test-runner') {
      return;
    }
    // Guard: prevent non-admin from accessing admin pages
    if (!isAdmin && (page === 'llm-config' || page === 'users')) {
      return;
    }
    if (page !== 'reports') {
      setPendingReport(null);
    }
    setActivePage(page);
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">⚡</div>
            <div>
              <div className="sidebar-logo-text">AI testing</div>
            </div>
            <span className="sidebar-logo-badge">Pro</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {/* Admin-only section */}
          {isAdmin && (
            <>
              <div className="sidebar-section-label">Administration</div>
              <button
                className={`sidebar-link ${activePage === 'llm-config' ? 'active' : ''}`}
                onClick={() => handlePageChange('llm-config')}
                disabled={testRunning}
              >
                <span className="sidebar-link-icon">🧠</span>
                LLM Config
              </button>
              <button
                className={`sidebar-link ${activePage === 'users' ? 'active' : ''}`}
                onClick={() => handlePageChange('users')}
                disabled={testRunning}
              >
                <span className="sidebar-link-icon">👤</span>
                Users
              </button>
            </>
          )}

          <div className="sidebar-section-label">Testing</div>
          <button
            className={`sidebar-link ${activePage === 'test-suites' ? 'active' : ''}`}
            onClick={() => handlePageChange('test-suites')}
            disabled={testRunning}
          >
            <span className="sidebar-link-icon">📋</span>
            Test Suites
          </button>
          <button
            className={`sidebar-link ${activePage === 'test-runner' ? 'active' : ''}`}
            onClick={() => handlePageChange('test-runner')}
          >
            <span className="sidebar-link-icon">▶️</span>
            Test Runner
          </button>
          <button
            className={`sidebar-link ${activePage === 'reports' ? 'active' : ''}`}
            onClick={() => handlePageChange('reports')}
            disabled={testRunning}
          >
            <span className="sidebar-link-icon">📊</span>
            Reports
          </button>

          <div className="sidebar-section-label">Assets</div>
          <button
            className={`sidebar-link ${activePage === 'baselines' ? 'active' : ''}`}
            onClick={() => handlePageChange('baselines')}
            disabled={testRunning}
          >
            <span className="sidebar-link-icon">🖼️</span>
            Baselines
          </button>
          <button
            className={`sidebar-link ${activePage === 'files' ? 'active' : ''}`}
            onClick={() => handlePageChange('files')}
            disabled={testRunning}
          >
            <span className="sidebar-link-icon">📂</span>
            Files & Assets
          </button>

          <div className="sidebar-section-label">Help</div>
          <button
            className="sidebar-link"
            onClick={() => setShowBestPractices(true)}
            disabled={testRunning}
          >
            <span className="sidebar-link-icon">📖</span>
            Best Practices
          </button>
        </nav>

        {/* User info + Logout */}
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar">{user.username.charAt(0).toUpperCase()}</div>
            <div className="sidebar-user-details">
              <div className="sidebar-user-name">{user.username}</div>
              <div className="sidebar-user-role">
                {isAdmin ? '🛡️ Admin' : '👤 User'}
              </div>
            </div>
          </div>
          <div className="sidebar-user-actions">
            <button
              className="sidebar-settings-btn"
              onClick={() => handlePageChange('change-password')}
              title="Change Password"
            >
              🔒
            </button>
            <button className="sidebar-logout-btn" onClick={logout} title="Sign out">
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* Best Practices Popup — first-visit auto-show + manual trigger */}
      <BestPracticesPopup manualOpen={showBestPractices} onClose={() => setShowBestPractices(false)} />

      {/* Main Content */}
      <main className="main-content">
        {activePage === 'llm-config' && isAdmin && <LLMConfig />}
        {activePage === 'users' && isAdmin && <UserManagement />}
        {activePage === 'test-suites' && <TestSuites />}
        {activePage === 'test-runner' && <TestRunner onNavigateToReport={handleNavigateToReport} onRunningChange={setTestRunning} />}
        {activePage === 'reports' && <Reports initialReport={pendingReport} />}
        {activePage === 'baselines' && <BaselineManager />}
        {activePage === 'files' && <FileBrowser />}
        {activePage === 'change-password' && <ChangePassword />}
      </main>
    </div>
  );
}

export default App;
