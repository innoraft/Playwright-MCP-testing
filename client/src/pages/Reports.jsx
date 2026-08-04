import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ExternalLink,
  FileText,
  RefreshCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Reports({ initialReport }) {
  const { authFetch } = useAuth();
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const pollRef = useRef(null);
  const hasAutoSelected = useRef(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load reports ──────────────────────────────────────
  const fetchReports = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await authFetch('/api/reports');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setReports(data);

      // Auto-select only on first load and only if user hasn't picked one yet
      if (!hasAutoSelected.current && data.length > 0) {
        hasAutoSelected.current = true;
        if (initialReport) {
          setSelectedReport(initialReport);
        } else {
          setSelectedReport(data[0].name);
        }
      }
    } catch {
      if (!silent) showToast('Could not load reports', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast, authFetch, initialReport]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // ── Auto-refresh: poll every 10s to pick up new reports ──
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchReports(true);
    }, 10000);
    return () => clearInterval(pollRef.current);
  }, [fetchReports]);

  // ── Handle initialReport changes (e.g. navigating from TestRunner) ─────
  useEffect(() => {
    if (initialReport) {
      setSelectedReport(initialReport);
      // Refresh to ensure the new report appears in the list
      fetchReports(true);
    }
  }, [initialReport, fetchReports]);

  // ── Delete report ─────────────────────────────────────
  const handleDelete = async (fileName) => {
    try {
      const res = await authFetch(`/api/reports/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      showToast('Report deleted');
      if (selectedReport === fileName) {
        setSelectedReport(null);
      }
      setConfirmDelete(null);
      fetchReports(true);
    } catch {
      showToast('Could not delete report', 'error');
    }
  };

  // ── Delete all reports ───────────────────────────────
  const handleDeleteAll = async () => {
    try {
      const res = await authFetch('/api/reports', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete reports');

      const result = await res.json();
      showToast(`Deleted ${result.deletedCount || 0} reports`);
      setConfirmDeleteAll(false);
      setSelectedReport(null);
      hasAutoSelected.current = false;
      await fetchReports(true);
    } catch {
      showToast('Could not delete reports', 'error');
    }
  };

  // ── Format date ───────────────────────────────────────
  const formatDate = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // ── Format file size ──────────────────────────────────
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  // ── Friendly report name ──────────────────────────────
  const friendlyName = (name) => {
    const ts = name.match(/(\d{10,})/);
    if (ts) {
      const d = new Date(parseInt(ts[1]));
      return `Report — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return name.replace('.html', '');
  };

  const normalizeResult = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['pass', 'passed', 'success', 'ok'].includes(normalized)) return 'pass';
    if (['fail', 'failed', 'error'].includes(normalized)) return 'fail';
    return 'unknown';
  };

  // ── Filter reports ────────────────────────────────────
  const filteredReports = reports.filter(r => {
    const matchesSearch = searchQuery === '' ||
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      friendlyName(r.name).toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // ── Report stats for summary ──────────────────────────
  const totalReports = reports.length;
  const passedReports = reports.filter(r => normalizeResult(r.result) === 'pass').length;
  const failedReports = reports.filter(r => normalizeResult(r.result) === 'fail').length;

  return (
    <div className="page-container page-container-wide">
      {/* Toast */}
      {toast && (
        <div className="report-toast-container">
          <div className={`report-toast report-toast-${toast.type}`}>
            <span>{toast.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span>
            {toast.message}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Test Reports</h1>
        <p className="page-subtitle">
          View detailed HTML reports generated from your test runs — logs, results, screenshots, and visual diffs all in one place.
        </p>
      </div>

      {/* Reports Summary Bar */}
      {!loading && reports.length > 0 && (
        <div className="reports-summary-bar">
          <div className="reports-summary-stat">
            <span className="reports-summary-value">{totalReports}</span>
            <span className="reports-summary-label">Total</span>
          </div>
          <div className="reports-summary-stat">
            <span className="reports-summary-value reports-summary-pass">{passedReports}</span>
            <span className="reports-summary-label">Passed</span>
          </div>
          <div className="reports-summary-stat">
            <span className="reports-summary-value reports-summary-fail">{failedReports}</span>
            <span className="reports-summary-label">Failed</span>
          </div>
        </div>
      )}

      {/* Reports Layout */}
      <div className="reports-layout">
        {/* Report List */}
        <aside className="report-list-panel">
          <div className="report-list-header">
            <span className="report-list-title">Reports ({filteredReports.length})</span>
            <div className="report-list-header-actions">
              <button
                className="btn-new-test"
                onClick={() => fetchReports()}
                title="Refresh reports"
              >
                <RefreshCcw size={16} aria-hidden="true" />
              </button>
              <button
                className="report-btn-danger btn-delete-all"
                onClick={() => setConfirmDeleteAll(true)}
                title="Delete all reports"
                disabled={reports.length === 0}
                aria-label="Delete all reports"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Search & Filter */}
          <div className="report-list-controls">
            <input
              type="text"
              className="report-search-input"
              placeholder="Search reports…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="report-list-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="report-skeleton" style={{ height: 60, marginBottom: 8, borderRadius: 8 }} />
              ))}
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="report-list-empty">
              <span className="report-list-empty-icon"><BarChart3 size={24} /></span>
              <span>{reports.length === 0 ? 'No reports yet' : 'No matching reports'}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {reports.length === 0
                  ? 'Run a test to generate a report'
                  : 'Try a different search or filter'}
              </span>
            </div>
          ) : (
            <div className="report-list">
              {filteredReports.map(report => {
                const result = normalizeResult(report.result);
                return (
                <div
                  key={report.name}
                  className={`report-list-item ${selectedReport === report.name ? 'active' : ''}`}
                  onClick={() => setSelectedReport(report.name)}
                >
                  <div className="report-list-item-info">
                    <span className={`report-list-item-icon ${result === 'pass' ? 'pass' : result === 'fail' ? 'fail' : ''}`}>
                      {result === 'pass' ? <CheckCircle2 size={16} /> : result === 'fail' ? <XCircle size={16} /> : <FileText size={16} />}
                    </span>
                    <div className="report-list-item-details">
                      <span className="report-list-item-name" title={report.name}>
                        {friendlyName(report.name)}
                      </span>
                      <div className="report-list-item-meta">
                        <span className="report-list-item-date">
                          {formatDate(report.modified)}
                        </span>
                        {report.totalActions > 0 && (
                          <span className="report-list-item-steps">
                            {report.passed}/{report.totalActions} steps
                          </span>
                        )}
                        {report.duration && report.duration !== 'N/A' && (
                          <span className="report-list-item-duration">
                             {report.duration}
                          </span>
                        )}
                        {report.sizeBytes && (
                          <span className="report-list-item-size">
                            {formatSize(report.sizeBytes)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className="report-delete-btn"
                    title="Delete report"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(report.name);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Report Viewer */}
        <div className="report-viewer-panel">
          {selectedReport ? (
            <div className="report-viewer-container">
              <div className="report-viewer-toolbar">
                <span className="report-viewer-filename">
                  <BarChart3 size={16} /> {friendlyName(selectedReport)}
                </span>
                <div className="report-viewer-actions">
                  <a
                    href={`/reports/${selectedReport}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="report-btn-outline report-open-btn"
                  >
                    Open in New Tab <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  <button
                    className="report-btn-outline report-delete-toolbar-btn"
                    onClick={() => setConfirmDelete(selectedReport)}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
              <iframe
                key={selectedReport}
                src={`/reports/${selectedReport}`}
                className="report-iframe"
                title="Test Report"
                id="report-iframe"
              />
            </div>
          ) : (
            <div className="report-viewer-empty">
              <span className="report-viewer-empty-icon"><BarChart3 size={28} /></span>
              <h3>No Report Selected</h3>
              <p>Select a report from the list to view it, or run a test to generate a new report.</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="report-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="report-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="report-modal-title">Delete Report?</h3>
            <p className="report-modal-text">
              Are you sure you want to delete <strong>{friendlyName(confirmDelete)}</strong>? This action cannot be undone.
            </p>
            <div className="report-modal-actions">
              <button className="report-btn-outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="report-btn-danger" onClick={() => handleDelete(confirmDelete)}>
                Delete Report
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteAll && (
        <div className="report-modal-overlay" onClick={() => setConfirmDeleteAll(false)}>
          <div className="report-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="report-modal-title">Delete All Reports?</h3>
            <p className="report-modal-text">
              Are you sure you want to delete all visible reports? This action cannot be undone.
            </p>
            <div className="report-modal-actions">
              <button className="report-btn-outline" onClick={() => setConfirmDeleteAll(false)}>
                Cancel
              </button>
              <button className="report-btn-danger" onClick={handleDeleteAll}>
                Delete All Reports
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
