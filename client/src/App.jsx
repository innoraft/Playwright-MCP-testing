import LLMConfig from './pages/LLMConfig';
import './index.css';

function App() {
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
          <button className="sidebar-link active">
            <span className="sidebar-link-icon">🧠</span>
            LLM Config
          </button>
          <button className="sidebar-link" disabled style={{ opacity: 0.4 }}>
            <span className="sidebar-link-icon">📋</span>
            Test Suites
          </button>
          <button className="sidebar-link" disabled style={{ opacity: 0.4 }}>
            <span className="sidebar-link-icon">▶️</span>
            Test Runner
          </button>
          <button className="sidebar-link" disabled style={{ opacity: 0.4 }}>
            <span className="sidebar-link-icon">📊</span>
            Reports
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
        <LLMConfig />
      </main>
    </div>
  );
}

export default App;
