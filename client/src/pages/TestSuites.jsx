import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Plus,
  SearchX,
  Trash2,
  Zap,
} from 'lucide-react';
import GeneralTestForm from '../components/GeneralTestForm';
import VisualRegressionForm from '../components/VisualRegressionForm';
import PerformanceMetricsForm from '../components/PerformanceMetricsForm';
import { useAuth } from '../hooks/useAuth';

const TABS = [
  { id: 'general', label: 'General Test', icon: FileText },
  { id: 'visual', label: 'Visual Regression', icon: ImageIcon },
  { id: 'performance', label: 'Performance Metrics', icon: Zap },
];

export default function TestSuites() {
  const { authFetch } = useAuth();
  const [tests, setTests] = useState([]);
  const [activeTab, setActiveTab] = useState('general');
  const [selectedTest, setSelectedTest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const toastTimerRef = useRef(null);

  // Form data for editing
  const [generalData, setGeneralData] = useState(null);
  const [vrData, setVrData] = useState(null);
  const [performanceData, setPerformanceData] = useState(null);
  const tabToType = {
    general: 'general',
    visual: 'visual-regression',
    performance: 'performance'
  };

  const detectTestType = (content = '') => {
    const trimmed = content.trimStart().toLowerCase();
    if (trimmed.startsWith('schemaversion:') || /(^|\n)\s*performance\s*:/i.test(content)) return 'performance';
    if (/(^|\n)\s*tests\s*:/i.test(content)) return 'general';
    if (trimmed.startsWith('name:')) return 'visual-regression';
    return 'general';
  };

  // ── Delete all tests ─────────────────────────────────
  const handleDeleteAll = async () => {
    try {
      const res = await authFetch('/api/tests', { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete all failed');

      const result = await res.json();
      showToast(`Deleted ${result.deletedCount || 0} tests`);
      setConfirmDeleteAll(false);
      handleNewTest();
      await fetchTests();
    } catch (err) {
      showToast(err.message || 'Could not delete tests', 'error');
    }
  };

  // ── Toast helper ──────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // ── Load test list ────────────────────────────────────
  const fetchTests = useCallback(async () => {
    try {
      const res = await authFetch('/api/tests');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTests((Array.isArray(data) ? data : []).filter(t => t.type !== 'form-validation'));
    } catch {
      showToast('Could not load test files', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, authFetch]);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  // ── Parse YAML content into form data ─────────────────
  const parseTestContent = (name, content, type) => {
    if (type === 'visual-regression') {
      // Parse visual regression YAML
      const lines = content.split('\n');
      const testName = lines[0]?.replace(/^name:\s*/, '').trim() || '';
      let url = '';
      const breakpoints = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        const navMatch = trimmed.match(/^- Navigate to (.+)$/);
        if (navMatch) url = navMatch[1];

        const resizeMatch = trimmed.match(/^- Resize the viewport to (\d+)x(\d+)$/);
        if (resizeMatch) {
          breakpoints.push({
            width: parseInt(resizeMatch[1]),
            height: parseInt(resizeMatch[2]),
          });
        }
      });

      if (breakpoints.length === 0) breakpoints.push({ width: 1280, height: 720 });

      return { testName, url, breakpoints };
    } else if (type === 'performance') {
      const perfMatch = content.match(/^performance:\s*(.+)$/m);

      // Parse categories block (no PWA)
      const VALID_CATS = new Set(['performance', 'accessibility', 'best-practices', 'seo']);
      let categories = ['performance'];
      const catsBlockMatch = content.match(/^\s*categories\s*:\s*\n((?:[ \t]*-[ \t]+\S+[ \t]*\n?)+)/m);
      if (catsBlockMatch) {
        const parsed = [...catsBlockMatch[1].matchAll(/[ \t]*-[ \t]+(\S+)/g)]
          .map((m) => m[1].toLowerCase())
          .filter((c) => VALID_CATS.has(c));
        if (parsed.length > 0) categories = parsed;
      } else {
        const inlineMatch = content.match(/^\s*categories\s*:\s*([^\n]+)$/m);
        if (inlineMatch) {
          const parsed = inlineMatch[1].split(',').map((c) => c.trim().toLowerCase()).filter((c) => VALID_CATS.has(c));
          if (parsed.length > 0) categories = parsed;
        }
      }

      // Parse multiple URLs from targets: block (new format)
      let urls = [];
      const targetsBlock = content.match(/^\s*targets\s*:\s*\n((?:[ \t]*-[ \t]+\S+[ \t]*\n?)+)/m);
      if (targetsBlock) {
        urls = [...targetsBlock[1].matchAll(/[ \t]*-[ \t]+(\S+)/g)]
          .map((m) => m[1].trim())
          .filter((u) => /^https?:\/\/.+/.test(u));
      }
      // Fallback: old single url: field
      if (urls.length === 0) {
        const urlMatch = content.match(/^\s*url:\s*(.+)$/m);
        if (urlMatch) urls = [urlMatch[1].trim()];
      }

      return {
        testName:   perfMatch ? perfMatch[1].trim() : '',
        urls:       urls.length > 0 ? urls : [''],
        categories,
      };
    } else {
      // Parse general test YAML (new structured format + old fallback)
      const unquote = (value = '') => {
        const trimmed = value.trim();
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        }
        return trimmed;
      };

      if (/(^|\n)\s*tests\s*:/i.test(content)) {
        const lines = content.split('\n');
        const parsedName = (content.match(/^\s*name:\s*(.+)$/m)?.[1] || '').trim();
        const parsedDescription = (content.match(/^\s*description:\s*(.+)$/m)?.[1] || '').trim();
        const parsedBaseUrl = (content.match(/^\s*baseUrl:\s*(.+)$/m)?.[1] || '').trim();

        const groups = [];
        let inTests = false;
        let currentGroup = null;

        for (const line of lines) {
          const trimmed = line.trim();

          if (/^tests\s*:\s*$/i.test(trimmed)) {
            inTests = true;
            continue;
          }

          if (!inTests) continue;

          const caseMatch = line.match(/^\s*-\s+name:\s*(.+)$/);
          if (caseMatch) {
            if (currentGroup) groups.push(currentGroup);
            currentGroup = {
              scenario: unquote(caseMatch[1]),
              description: '',
              steps: '',
            };
            continue;
          }

          if (!currentGroup) continue;

          const descMatch = line.match(/^\s+description:\s*(.+)$/);
          if (descMatch) {
            currentGroup.description = unquote(descMatch[1]);
            continue;
          }

          const stepMatch = line.match(/^\s+-\s+(.+)$/);
          if (stepMatch && /^\s{4,}-\s+/.test(line)) {
            currentGroup.steps = currentGroup.steps
              ? `${currentGroup.steps}\n${unquote(stepMatch[1])}`
              : unquote(stepMatch[1]);
          }
        }

        if (currentGroup) groups.push(currentGroup);

        return {
          testName: unquote(parsedName) || name.replace('.test.yml', ''),
          suiteDescription: unquote(parsedDescription),
          baseUrl: unquote(parsedBaseUrl),
          groups: groups.length > 0 ? groups : [{ scenario: '', description: '', steps: '' }],
        };
      }

      const lines = content.split('\n');
      const testName = lines[0]?.replace(/^Test:\s*/, '').trim() || '';
      const groups = [];
      let currentScenario = '';
      let currentSteps = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          if (currentScenario || currentSteps.length > 0) {
            groups.push({
              scenario: currentScenario,
              description: '',
              steps: currentSteps.join('\n'),
            });
          }
          currentScenario = trimmed.replace(/^# /, '');
          currentSteps = [];
        } else if (trimmed.startsWith('- ')) {
          currentSteps.push(trimmed.replace(/^- /, ''));
        }
      });

      if (currentScenario || currentSteps.length > 0) {
        groups.push({
          scenario: currentScenario,
          description: '',
          steps: currentSteps.join('\n'),
        });
      }

      if (groups.length === 0) groups.push({ scenario: '', description: '', steps: '' });

      return { testName, suiteDescription: '', baseUrl: '', groups };
    }
  };

  const filteredTests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tests.filter((test) => query.length === 0 || test.name.toLowerCase().includes(query));
  }, [tests, searchQuery]);

  // ── Select a test from the list ───────────────────────
  const handleSelectTest = async (test) => {
    try {
      const res = await authFetch(`/api/tests/${test.name}`);
      if (!res.ok) throw new Error('Failed to load test');
      const data = await res.json();

      setSelectedTest(test);

      if (test.type === 'visual-regression') {
        const parsed = parseTestContent(test.name, data.content, 'visual-regression');
        setVrData(parsed);
        setActiveTab('visual');
      } else if (test.type === 'performance') {
        const parsed = parseTestContent(test.name, data.content, 'performance');
        setPerformanceData(parsed);
        setActiveTab('performance');
      } else {
        const parsed = parseTestContent(test.name, data.content, 'general');
        setGeneralData(parsed);
        setActiveTab('general');
      }
    } catch {
      showToast('Failed to load test file', 'error');
    }
  };

  // ── New test ──────────────────────────────────────────
  const handleNewTest = () => {
    setSelectedTest(null);
    setGeneralData(null);
    setVrData(null);
    setPerformanceData(null);
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    if (selectedTest && selectedTest.type !== tabToType[tabId]) {
      setSelectedTest(null);
    }
  };

  // ── Save handler (shared by all forms) ────────────────
  const handleSave = async (fileName, content) => {
    setSaving(true);
    try {
      const res = await authFetch('/api/tests', {
        method: 'POST',
        body: JSON.stringify({
          name: fileName,
          content,
          // When editing an existing test, pass its original filename
          // so the server can skip it in duplicate checks and delete
          // the old file if the name was changed.
          ...(selectedTest && { oldName: selectedTest.name }),
        }),
      });

      if (!res.ok) {
        let message = 'Save failed';
        try {
          const raw = await res.text();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed?.error) message = parsed.error;
            } catch {
              // Fallback for non-JSON error bodies
              message = raw;
            }
          }
        } catch {
          // Keep default message.
        }

        if (res.status === 409 && (!message || message === 'Save failed')) {
          message = 'A test with this name already exists. Please choose a different name.';
        }

        throw new Error(message);
      }

      const result = await res.json();
      showToast(`Test saved as ${result.fileName}`);
      await fetchTests();

      // Select the newly saved test
      setSelectedTest({ name: result.fileName, type: detectTestType(content) });
    } catch (err) {
      const message = err?.message || 'Save failed';
      showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete handler ────────────────────────────────────
  const handleDelete = async (testName) => {
    try {
      const res = await authFetch(`/api/tests/${testName}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');

      showToast(`Deleted ${testName}`);
      setDeleteConfirm(null);

      // If deleted test was selected, clear form
      if (selectedTest?.name === testName) {
        handleNewTest();
      }

      await fetchTests();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Render ────────────────────────────────────────────
  return (
    <div className="page-container page-container-wide">
      {/* Toast */}
      {toast && (
        <div className="report-toast-container" style={{ zIndex: 3000 }}>
          <div className={`report-toast report-toast-${toast.type}`} role="alert" aria-live="polite">
            <span>{toast.type === 'success' ? '✓' : '✕'}</span>
            {toast.message}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="report-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="report-modal-dialog" onClick={e => e.stopPropagation()}>
            <h3 className="report-modal-title">Delete Test</h3>
            <p className="report-modal-text">
              Are you sure you want to delete <strong>{deleteConfirm}</strong>?
              This action cannot be undone.
            </p>
            <div className="report-modal-actions">
              <button className="report-btn-outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button className="report-btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteAll && (
        <div className="report-modal-overlay" onClick={() => setConfirmDeleteAll(false)}>
          <div className="report-modal-dialog" onClick={e => e.stopPropagation()}>
            <h3 className="report-modal-title">Delete All Tests</h3>
            <p className="report-modal-text">
              Are you sure you want to delete all visible tests? This action cannot be undone.
            </p>
            <div className="report-modal-actions">
              <button className="report-btn-outline" onClick={() => setConfirmDeleteAll(false)}>
                Cancel
              </button>
              <button className="report-btn-danger" onClick={handleDeleteAll}>
                Delete All Tests
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Test Suites</h1>
        <p className="page-subtitle">
          Create, edit, and manage your automated tests.
        </p>
      </div>

      {/* Main Layout: Test List + Form */}
      <div className="test-suites-layout">
        {/* Left Panel — Test List */}
        <aside className="test-list-panel">
          <div className="test-list-header">
            <span className="test-list-title">Saved Tests</span>
            <div className="test-list-header-actions">
              <button className="btn-new-test" onClick={handleNewTest} title="Create new test">
                <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              </button>
              <button
                className="btn-danger btn-delete-all"
                onClick={() => setConfirmDeleteAll(true)}
                title="Delete all tests"
                disabled={tests.length === 0}
                aria-label="Delete all tests"
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="test-list-filters">
            <input
              type="search"
              className="test-list-search-input"
              placeholder="Search tests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="test-list-clear-filters"
                onClick={() => setSearchQuery('')}
              >
                Clear
              </button>
            )}
          </div>

          {loading ? (
            <div className="test-list-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8, borderRadius: 8 }} />
              ))}
            </div>
          ) : tests.length === 0 ? (
            <div className="test-list-empty">
              <span className="test-list-empty-icon"><FolderOpen size={28} strokeWidth={2} aria-hidden="true" /></span>
              <span>No tests yet</span>
            </div>
          ) : filteredTests.length === 0 ? (
            <div className="test-list-empty">
              <span className="test-list-empty-icon"><SearchX size={28} strokeWidth={2} aria-hidden="true" /></span>
              <span>No matching tests</span>
            </div>
          ) : (
            <div className="test-list">
              {filteredTests.map(test => (
                <div
                  key={test.name}
                  className={`test-list-item ${selectedTest?.name === test.name ? 'active' : ''}`}
                  onClick={() => handleSelectTest(test)}
                >
                  <div className="test-list-item-info">
                    <span className="test-list-item-icon">
                      {test.type === 'visual-regression' ? (
                        <ImageIcon size={16} strokeWidth={2} aria-hidden="true" />
                      ) : test.type === 'performance' ? (
                        <Zap size={16} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <FileText size={16} strokeWidth={2} aria-hidden="true" />
                      )}
                    </span>
                    <div className="test-list-item-text">
                      <span className="test-list-item-name" title={test.name}>
                        {test.name.replace('.test.yml', '')}
                      </span>
                    </div>
                  </div>
                  <button
                    className="test-list-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(test.name);
                    }}
                    title="Delete test"
                  >
                    <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Right Panel — Tabs + Form */}
        <div className="test-form-panel">
          <div className="tabs-dropdown-wrap">
            <label className="tabs-dropdown-label" htmlFor="testsuite-tab-select">Test Type</label>
            <select
              id="testsuite-tab-select"
              className="form-select tabs-dropdown"
              value={activeTab}
              onChange={(e) => handleTabChange(e.target.value)}
            >
              {TABS.map((tab) => (
                <option key={tab.id} value={tab.id}>{tab.label}</option>
              ))}
            </select>
          </div>

          {/* Tabs */}
          <div className="tabs-container">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => handleTabChange(tab.id)}
                >
                  <span className="tab-btn-icon"><Icon size={16} strokeWidth={2} aria-hidden="true" /></span>
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="config-card">
            {activeTab === 'general' && (
              <GeneralTestForm
                key={selectedTest?.name || 'new-general'}
                initialData={generalData}
                onSave={handleSave}
                saving={saving}
              />
            )}

            {activeTab === 'visual' && (
              <VisualRegressionForm
                key={selectedTest?.name || 'new-visual'}
                initialData={vrData}
                onSave={handleSave}
                saving={saving}
              />
            )}

            {activeTab === 'performance' && (
              <PerformanceMetricsForm
                key={selectedTest?.name || 'new-performance'}
                initialData={performanceData}
                onSave={handleSave}
                saving={saving}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
