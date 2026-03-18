import { useState, useEffect, useCallback } from 'react';

export default function Reports({ initialReport }) {
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load reports ──────────────────────────────────────
  const fetchReports = useCallback(async () => {
    try {
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
      showToast('Could not load reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, initialReport]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // ── Handle initialReport changes ─────────────────────
  useEffect(() => {
    if (initialReport) {
      setSelectedReport(initialReport);
    }
  }, [initialReport]);

  // ── Format date ───────────────────────────────────────
  const formatDate = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

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
          View detailed HTML reports generated from your test runs.
        </p>
      </div>

      {/* Reports Layout */}
      <div className="reports-layout">
        {/* Report List */}
        <aside className="report-list-panel">
          <div className="report-list-header">
            <span className="report-list-title">Reports</span>
            <button
              className="btn-new-test"
              onClick={fetchReports}
              title="Refresh reports"
            >
              ↻
            </button>
          </div>

          {loading ? (
            <div className="test-list-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8, borderRadius: 8 }} />
              ))}
            </div>
          ) : reports.length === 0 ? (
            <div className="test-list-empty">
              <span className="test-list-empty-icon">📊</span>
              <span>No reports yet</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Run a test to generate a report
              </span>
            </div>
          ) : (
            <div className="report-list">
              {reports.map(report => (
                <div
                  key={report.name}
                  className={`report-list-item ${selectedReport === report.name ? 'active' : ''}`}
                  onClick={() => setSelectedReport(report.name)}
                >
                  <div className="report-list-item-info">
                    <span className="report-list-item-icon">📄</span>
                    <div className="report-list-item-details">
                      <span className="report-list-item-name" title={report.name}>
                        {report.name.replace('.html', '').replace('autonomous_mcp_report_', 'Report ')}
                      </span>
                      <span className="report-list-item-date">
                        {formatDate(report.modified)}
                      </span>
                    </div>
                  </div>
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
                  📊 {selectedReport}
                </span>
                <a
                  href={`/reports/${selectedReport}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline report-open-btn"
                >
                  Open in New Tab ↗
                </a>
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
    </div>
  );
}
