import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Brain,
  Cpu,
  FolderOpen,
  Image,
  KeyRound,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  PlayCircle,
  PlugZap,
  Sun,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "./hooks/useAuth";
import Login from "./pages/Login";
import LLMConfig from "./pages/LLMConfig";
import TestSuites from "./pages/TestSuites";
import TestRunner from "./pages/TestRunner";
import Reports from "./pages/Reports";
import BaselineManager from "./pages/BaselineManager";
import FileBrowser from "./pages/FileBrowser";
import UserManagement from "./pages/UserManagement";
import ChangePassword from "./pages/ChangePassword";
import BestPracticesPopup from "./components/BestPracticesPopup";

function App() {
  const { user, isAdmin, isAuthenticated, loading, logout } = useAuth();
  const [activePage, setActivePage] = useState("test-suites");
  const [pendingReport, setPendingReport] = useState(null);
  const [showBestPractices, setShowBestPractices] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("app-theme");
    return savedTheme === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("app-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onResize = () => {
      if (window.innerWidth > 1080) {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
    document.body.style.overflow = '';
  }, [mobileNavOpen]);

  const safeActivePage =
    !isAdmin && (activePage === "llm-config" || activePage === "users")
      ? "test-suites"
      : activePage;

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="login-wrapper">
        <div style={{ color: "var(--text-secondary)", fontSize: "16px" }}>
          Loading...
        </div>
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
    setActivePage("reports");
  };

  const openBestPracticesFromDrawer = () => {
    setShowBestPractices(true);
    setMobileNavOpen(false);
  };

  const toggleThemeFromDrawer = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
    setMobileNavOpen(false);
  };

  const logoutFromDrawer = () => {
    setMobileNavOpen(false);
    logout();
  };

  // Clear pending report when navigating away from reports
  const handlePageChange = (page) => {
    // Guard: block navigation while a test is running
    if (testRunning && page !== "test-runner") {
      return;
    }
    // Guard: prevent non-admin from accessing admin pages
    if (!isAdmin && (page === "llm-config" || page === "users")) {
      return;
    }
    if (page !== "reports") {
      setPendingReport(null);
    }
    setActivePage(page);
    setMobileNavOpen(false);
  };

  const navGroups = [
    ...(isAdmin
      ? [
          {
            label: "Administration",
            items: [
              { id: "llm-config", label: "LLM Config", icon: Brain },
              { id: "users", label: "Users", icon: Users },
            ],
          },
        ]
      : []),
    {
      label: "Testing",
      items: [
        { id: "test-suites", label: "Test Suites", icon: ListChecks },
        { id: "test-runner", label: "Test Runner", icon: PlayCircle },
        { id: "reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      label: "Assets",
      items: [
        { id: "baselines", label: "Baselines", icon: Image },
        { id: "files", label: "Files & Assets", icon: FolderOpen },
      ],
    },
  ];

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-inner container-xxl">
          <div className="topbar-brand-wrap">
            <div className="topbar-brand">
              <button
                className="topbar-menu-btn"
                onClick={() => setMobileNavOpen((prev) => !prev)}
                aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileNavOpen}
                title={mobileNavOpen ? 'Close menu' : 'Open menu'}
              >
                {mobileNavOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              </button>
              <PlugZap size={22} strokeWidth={2} />
              <div className="topbar-logo">
                <Zap size={18} strokeWidth={2.5} />
              </div>
              <div className="topbar-brand-text">
                <span className="topbar-brand-title">AI Testing</span>
              </div>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="topbar-user-pill topbar-cta">
              <span className="topbar-avatar">
                {user.username.charAt(0).toUpperCase()}
              </span>
              <span className="topbar-user-name">{user.username}</span>
            </div>
            <button
              className="topbar-action-btn btn btn-sm btn-outline-info topbar-cta"
              onClick={() => setShowBestPractices(true)}
              disabled={testRunning}
              title="Best Practices"
            >
              <BookOpen size={16} aria-hidden="true" />
              Best Practices
            </button>
            <button
              className="topbar-icon-btn btn btn-sm btn-outline-light"
              onClick={() => handlePageChange("change-password")}
              disabled={testRunning}
              title="Change Password"
            >
              <KeyRound size={16} aria-hidden="true" />
            </button>
            <button
              className="topbar-icon-btn"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <button
              className="topbar-logout-btn btn btn-sm btn-success topbar-cta"
              onClick={logout}
              title="Sign out"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        {mobileNavOpen && (
          <button
            className="mobile-nav-backdrop"
            aria-label="Close navigation menu"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <div className="container-xxl">
          <div className="main-wrapper">
            <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
              <div className="sidebar-mobile-actions">
                <div className="topbar-user-pill sidebar-mobile-user">
                  <span className="topbar-avatar">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="topbar-user-name">{user.username}</span>
                </div>

                <button
                  className="sidebar-mobile-action"
                  onClick={openBestPracticesFromDrawer}
                  disabled={testRunning}
                >
                  <BookOpen size={16} aria-hidden="true" />
                  Best Practices
                </button>

                <button
                  className="sidebar-mobile-action"
                  onClick={() => handlePageChange("change-password")}
                  disabled={testRunning}
                >
                  <KeyRound size={16} aria-hidden="true" />
                  Change Password
                </button>

                <button
                  className="sidebar-mobile-action"
                  onClick={toggleThemeFromDrawer}
                >
                  {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
                  {theme === "dark" ? "Light Mode" : "Dark Mode"}
                </button>

                <button
                  className="sidebar-mobile-action sidebar-mobile-logout"
                  onClick={logoutFromDrawer}
                >
                  <LogOut size={16} aria-hidden="true" />
                  Sign out
                </button>
              </div>

              {navGroups.map((group) => (
                <section key={group.label} className="sidebar-group">
                  <h3 className="sidebar-group-label">{group.label}</h3>
                  <nav
                    className="topbar-nav"
                    aria-label={`${group.label} navigation`}
                  >
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          className={`topnav-link ${safeActivePage === item.id ? "active" : ""}`}
                          onClick={() => handlePageChange(item.id)}
                          disabled={testRunning && item.id !== "test-runner"}
                        >
                          <span>
                            <Icon size={17} strokeWidth={2} aria-hidden="true" />
                          </span>
                          {item.label}
                        </button>
                      );
                    })}
                  </nav>
                </section>
              ))}

              <div className="sidebar-helper-card">
                <Cpu size={22} strokeWidth={2} />
                <div className="sidebar-helper-title">
                  Explore Best Practices
                </div>
                <p className="sidebar-helper-text">
                  Learn how to get the most from AI testing.
                </p>
                <button
                  className="sidebar-helper-btn"
                  onClick={() => setShowBestPractices(true)}
                  disabled={testRunning}
                >
                  View Guide
                </button>
              </div>
            </aside>

            <main className="main-content">
              {safeActivePage === "llm-config" && isAdmin && <LLMConfig />}
              {safeActivePage === "users" && isAdmin && <UserManagement />}
              {safeActivePage === "test-suites" && <TestSuites />}
              {safeActivePage === "test-runner" && (
                <TestRunner
                  onNavigateToReport={handleNavigateToReport}
                  onRunningChange={setTestRunning}
                />
              )}
              {safeActivePage === "reports" && (
                <Reports initialReport={pendingReport} />
              )}
              {safeActivePage === "baselines" && <BaselineManager />}
              {safeActivePage === "files" && <FileBrowser />}
              {safeActivePage === "change-password" && <ChangePassword />}
            </main>
          </div>
        </div>
      </div>

      <BestPracticesPopup
        manualOpen={showBestPractices}
        onClose={() => setShowBestPractices(false)}
      />
    </div>
  );
}

export default App;
