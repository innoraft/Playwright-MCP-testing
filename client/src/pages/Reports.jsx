import { useState, useEffect, useCallback, useRef } from 'react';

export default function Reports({ initialReport }) {
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterResult, setFilterResult] = useState('all'); // 'all' | 'pass' | 'fail'
  const [confirmDelete, setConfirmDelete] = useState(null);
  const pollRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load reports ──────────────────────────────────────
  const fetchReports = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch('/api/reports');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setReports(data);

      // Auto-select the initial report or the newest one
      if (initialReport) {
        setSelectedReport(initialReport);
      } else if (data.length > 0 && !selectedReport) {
        setSelectedReport(data[0].name);
      }
    } catch {
      if (!silent) showToast('Could not load reports', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast, initialReport]);

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

  // ── Handle initialReport changes ─────────────────────
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
      const res = await fetch(`/api/reports/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
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

  // ── Filter reports ────────────────────────────────────
  const filteredReports = reports.filter(r => {
    const matchesSearch = searchQuery === '' ||
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      friendlyName(r.name).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesResult = filterResult === 'all' ||
      r.result === filterResult;
    return matchesSearch && matchesResult;
  });

  // ── Report stats for summary ──────────────────────────
  const totalReports = reports.length;
  const passedReports = reports.filter(r => r.result === 'pass').length;
  const failedReports = reports.filter(r => r.result === 'fail').length;

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
            <button
              className="btn-new-test"
              onClick={() => fetchReports()}
              title="Refresh reports"
            >
              ↻
            </button>
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
            <div className="report-filter-pills">
              {['all', 'pass', 'fail'].map(f => (
                <button
                  key={f}
                  className={`report-filter-pill ${filterResult === f ? 'active' : ''} ${f}`}
                  onClick={() => setFilterResult(f)}
                >
                  {f === 'all' ? 'All' : f === 'pass' ? '✓ Pass' : '✕ Fail'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="test-list-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 60, marginBottom: 8, borderRadius: 8 }} />
              ))}
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="test-list-empty">
              <span className="test-list-empty-icon">📊</span>
              <span>{reports.length === 0 ? 'No reports yet' : 'No matching reports'}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {reports.length === 0
                  ? 'Run a test to generate a report'
                  : 'Try a different search or filter'}
              </span>
            </div>
          ) : (
            <div className="report-list">
              {filteredReports.map(report => (
                <div
                  key={report.name}
                  className={`report-list-item ${selectedReport === report.name ? 'active' : ''}`}
                  onClick={() => setSelectedReport(report.name)}
                >
                  <div className="report-list-item-info">
                    <span className={`report-list-item-icon ${report.result === 'pass' ? 'pass' : report.result === 'fail' ? 'fail' : ''}`}>
                      {report.result === 'pass' ? '✅' : report.result === 'fail' ? '❌' : '📄'}
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
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Report Viewer */}
        <div className="report-viewer-panel">
          {selectedReport ? (
            <div className="report-viewer-container">
              <div className="report-viewer-toolbar">
                <span className="report-viewer-filename">
                  📊 {friendlyName(selectedReport)}
                </span>
                <div className="report-viewer-actions">
                  <a
                    href={`/reports/${selectedReport}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline report-open-btn"
                  >
                    Open in New Tab ↗
                  </a>
                  <button
                    className="btn-outline report-delete-toolbar-btn"
                    onClick={() => setConfirmDelete(selectedReport)}
                  >
                    🗑 Delete
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
              <span className="report-viewer-empty-icon">📊</span>
              <h3>No Report Selected</h3>
              <p>Select a report from the list to view it, or run a test to generate a new report.</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Delete Report?</h3>
            <p className="modal-text">
              Are you sure you want to delete <strong>{friendlyName(confirmDelete)}</strong>? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={() => handleDelete(confirmDelete)}>
                Delete Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
