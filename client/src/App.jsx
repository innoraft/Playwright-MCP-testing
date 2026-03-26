import { useState } from 'react';
import LLMConfig from './pages/LLMConfig';
import TestSuites from './pages/TestSuites';
import TestRunner from './pages/TestRunner';
import Reports from './pages/Reports';
import BaselineManager from './pages/BaselineManager';
import FileBrowser from './pages/FileBrowser';
import './index.css';

function App() {
  const [activePage, setActivePage] = useState('llm-config');
  const [pendingReport, setPendingReport] = useState(null);

  // Called by TestRunner when a run completes with a report file
  const handleNavigateToReport = (reportFile) => {
    setPendingReport(reportFile);
    setActivePage('reports');
  };

  // Clear pending report when navigating away from reports
  const handlePageChange = (page) => {
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
              <div className="sidebar-logo-text">Playwright MCP</div>
            </div>
            <span className="sidebar-logo-badge">Beta</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Administration</div>
          <button
            className={`sidebar-link ${activePage === 'llm-config' ? 'active' : ''}`}
            onClick={() => handlePageChange('llm-config')}
          >
            <span className="sidebar-link-icon">🧠</span>
            LLM Config
          </button>
          <button
            className={`sidebar-link ${activePage === 'test-suites' ? 'active' : ''}`}
            onClick={() => handlePageChange('test-suites')}
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
          >
            <span className="sidebar-link-icon">📊</span>
            Reports
          </button>

          <button
            className={`sidebar-link ${activePage === 'baselines' ? 'active' : ''}`}
            onClick={() => handlePageChange('baselines')}
          >
            <span className="sidebar-link-icon">🖼️</span>
            Baselines
          </button>
          <button
            className={`sidebar-link ${activePage === 'files' ? 'active' : ''}`}
            onClick={() => handlePageChange('files')}
          >
            <span className="sidebar-link-icon">📂</span>
            Files & Assets
          </button>
          
          <div className="sidebar-section-label">Settings</div>
          <button className="sidebar-link" disabled style={{ opacity: 0.4 }}>
            <span className="sidebar-link-icon">👤</span>
            Users
          </button>
          <button className="sidebar-link" disabled style={{ opacity: 0.4 }}>
            <span className="sidebar-link-icon">⚙️</span>
            General
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {activePage === 'llm-config' && <LLMConfig />}
        {activePage === 'test-suites' && <TestSuites />}
        {activePage === 'test-runner' && <TestRunner onNavigateToReport={handleNavigateToReport} />}
        {activePage === 'reports' && <Reports initialReport={pendingReport} />}
        {activePage === 'baselines' && <BaselineManager />}
        {activePage === 'files' && <FileBrowser />}
      </main>
    </div>
  );
}

export default App;
