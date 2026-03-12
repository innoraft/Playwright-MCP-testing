import { useState, useEffect, useCallback } from 'react';
import GeneralTestForm from '../components/GeneralTestForm';
import VisualRegressionForm from '../components/VisualRegressionForm';
import AdvancedEditor from '../components/AdvancedEditor';

const TABS = [
  { id: 'general', label: 'General Test', icon: '📋' },
  { id: 'visual', label: 'Visual Regression', icon: '🖼️' },
  { id: 'editor', label: 'Test Editor', icon: '⌨️' },
];

export default function TestSuites() {
  const [tests, setTests] = useState([]);
  const [activeTab, setActiveTab] = useState('general');
  const [selectedTest, setSelectedTest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Form data for editing
  const [generalData, setGeneralData] = useState(null);
  const [vrData, setVrData] = useState(null);
  const [editorContent, setEditorContent] = useState('');

  // ── Toast helper ──────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load test list ────────────────────────────────────
  const fetchTests = useCallback(async () => {
    try {
      const res = await fetch('/api/tests');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTests(data);
    } catch {
      showToast('Could not load test files', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

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
    } else {
      // Parse general test YAML
      const lines = content.split('\n');
      const testName = lines[0]?.replace(/^Test:\s*/, '').trim() || '';
      const groups = [];
      let currentScenario = '';
      let currentSteps = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          // If we have pending steps, save the current group
          if (currentScenario || currentSteps.length > 0) {
            groups.push({
              scenario: currentScenario,
              steps: currentSteps.join('\n'),
            });
          }
          currentScenario = trimmed.replace(/^# /, '');
          currentSteps = [];
        } else if (trimmed.startsWith('- ')) {
          currentSteps.push(trimmed.replace(/^- /, ''));
        }
      });

      // Push last group
      if (currentScenario || currentSteps.length > 0) {
        groups.push({
          scenario: currentScenario,
          steps: currentSteps.join('\n'),
        });
      }

      if (groups.length === 0) groups.push({ scenario: '', steps: '' });

      return { testName, groups };
    }
  };

  // ── Select a test from the list ───────────────────────
  const handleSelectTest = async (test) => {
    try {
      const res = await fetch(`/api/tests/${test.name}`);
      if (!res.ok) throw new Error('Failed to load test');
      const data = await res.json();

      setSelectedTest(test);

      if (test.type === 'visual-regression') {
        const parsed = parseTestContent(test.name, data.content, 'visual-regression');
        setVrData(parsed);
        setActiveTab('visual');
      } else {
        const parsed = parseTestContent(test.name, data.content, 'general');
        setGeneralData(parsed);
        setActiveTab('general');
      }

      // Also set raw content for advanced editor
      setEditorContent(data.content);
    } catch {
      showToast('Failed to load test file', 'error');
    }
  };

  // ── New test ──────────────────────────────────────────
  const handleNewTest = () => {
    setSelectedTest(null);
    setGeneralData(null);
    setVrData(null);
    setEditorContent('');
  };

  // ── Save handler (shared by all forms) ────────────────
  const handleSave = async (fileName, content) => {
    setSaving(true);
    try {
      const res = await fetch('/api/tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName, content }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }

      const result = await res.json();
      showToast(`Test saved as ${result.fileName}`);
      await fetchTests();

      // Select the newly saved test
      setSelectedTest({ name: result.fileName, type: content.startsWith('name:') ? 'visual-regression' : 'general' });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete handler ────────────────────────────────────
  const handleDelete = async (testName) => {
    try {
      const res = await fetch(`/api/tests/${testName}`, { method: 'DELETE' });
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
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : '✕'}</span>
            {toast.message}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-icon">🗑️</span>
              <h3>Delete Test</h3>
            </div>
            <p className="modal-text">
              Are you sure you want to delete <strong>{deleteConfirm}</strong>?
              This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Test Suites</h1>
        <p className="page-subtitle">
          Create, edit, and manage your automated tests. Choose a form type or use the advanced editor.
        </p>
      </div>

      {/* Main Layout: Test List + Form */}
      <div className="test-suites-layout">
        {/* Left Panel — Test List */}
        <aside className="test-list-panel">
          <div className="test-list-header">
            <span className="test-list-title">Saved Tests</span>
            <button className="btn-new-test" onClick={handleNewTest} title="Create new test">
              ＋
            </button>
          </div>

          {loading ? (
            <div className="test-list-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8, borderRadius: 8 }} />
              ))}
            </div>
          ) : tests.length === 0 ? (
            <div className="test-list-empty">
              <span className="test-list-empty-icon">📂</span>
              <span>No tests yet</span>
            </div>
          ) : (
            <div className="test-list">
              {tests.map(test => (
                <div
                  key={test.name}
                  className={`test-list-item ${selectedTest?.name === test.name ? 'active' : ''}`}
                  onClick={() => handleSelectTest(test)}
                >
                  <div className="test-list-item-info">
                    <span className="test-list-item-icon">
                      {test.type === 'visual-regression' ? '🖼️' : '📋'}
                    </span>
                    <span className="test-list-item-name" title={test.name}>
                      {test.name.replace('.test.yml', '')}
                    </span>
                  </div>
                  <button
                    className="test-list-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(test.name);
                    }}
                    title="Delete test"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Right Panel — Tabs + Form */}
        <div className="test-form-panel">
          {/* Tabs */}
          <div className="tabs-container">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-btn-icon">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
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

            {activeTab === 'editor' && (
              <AdvancedEditor
                key={selectedTest?.name || 'new-editor'}
                initialContent={editorContent}
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
