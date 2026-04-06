import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import LiveMonitor from '../components/LiveMonitor';

export default function TestRunner({ onNavigateToReport }) {
  const { authFetch, token } = useAuth();
  const [tests, setTests] = useState([]);
  const [selectedTest, setSelectedTest] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done
  const [result, setResult] = useState(null);   // null | 'passed' | 'failed'
  const [logs, setLogs] = useState([]);
  const [toast, setToast] = useState(null);
  const [screencastFrame, setScreencastFrame] = useState(null);

  const logEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  // ── Toast helper ──────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load test list ────────────────────────────────────
  useEffect(() => {
    authFetch('/api/tests')
      .then(res => res.json())
      .then(data => setTests(data))
      .catch(() => showToast('Could not load test files', 'error'));
  }, [showToast, authFetch]);

  // ── Auto-scroll logs ─────────────────────────────────
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // ── Cleanup SSE on unmount ────────────────────────────
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // ── Connect to SSE ───────────────────────────────────
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/runner/logs?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        setLogs(prev => [...prev, data]);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('screencast', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.frame) {
          setScreencastFrame(data.frame);
        }
      } catch { /* ignore */ }
    });

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data);
        setStatus('done');
        setResult(data.result);

        // Auto-navigate to reports after a short delay
        if (data.reportFile && onNavigateToReport) {
          setTimeout(() => {
            onNavigateToReport(data.reportFile);
          }, 2500);
        }
      } catch { /* ignore */ }

      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = () => {
      // SSE connection lost — if still running, it may have ended
      es.close();
      eventSourceRef.current = null;
    };
  }, [onNavigateToReport]);

  // ── Run Test ──────────────────────────────────────────
  const handleRun = async () => {
    if (!selectedTest) return;

    // Clear previous state
    setLogs([]);
    setResult(null);
    setStatus('running');
    setScreencastFrame(null);

    try {
      const res = await authFetch('/api/runner/run', {
        method: 'POST',
        body: JSON.stringify({ testName: selectedTest })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start test');
      }

      // Connect to SSE for live logs
      connectSSE();
    } catch (err) {
      showToast(err.message, 'error');
      setStatus('idle');
    }
  };

  // ── Stop Test ─────────────────────────────────────────
  const handleStop = async () => {
    try {
      await authFetch('/api/runner/stop', { method: 'POST' });
      showToast('Test run stopped');
    } catch {
      showToast('Failed to stop test', 'error');
    }
  };

  // ── Get log line class ────────────────────────────────
  const getLogClass = (type) => {
    switch (type) {
      case 'pass': return 'log-line log-pass';
      case 'fail': return 'log-line log-fail';
      case 'llm': return 'log-line log-llm';
      case 'step': return 'log-line log-step';
      default: return 'log-line';
    }
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
        <h1 className="page-title">Test Runner</h1>
        <p className="page-subtitle">
          Execute tests and monitor their progress in real time with live log streaming.
        </p>
      </div>

      {/* Run Controls */}
      <div className="config-card">
        <div className="runner-controls">
          {/* Test Selector */}
          <div className="runner-select-group">
            <label className="form-label">
              <span className="form-label-icon">📋</span>
              Select Test
            </label>
            <select
              className="form-select"
              value={selectedTest}
              onChange={(e) => setSelectedTest(e.target.value)}
              disabled={status === 'running'}
              id="test-selector"
            >
              <option value="">— Choose a test file —</option>
              {tests.map(t => (
                <option key={t.name} value={t.name}>
                  {t.name.replace('.test.yml', '')} ({t.type})
                </option>
              ))}
            </select>
          </div>

          {/* Action Buttons + Status */}
          <div className="runner-actions">
            {status === 'running' ? (
              <button
                className="btn-stop"
                onClick={handleStop}
                id="stop-btn"
              >
                <span className="btn-icon">⏹</span>
                Stop
              </button>
            ) : (
              <button
                className="btn-run"
                onClick={handleRun}
                disabled={!selectedTest}
                id="run-btn"
              >
                <span className="btn-icon">▶</span>
                Run Test
              </button>
            )}

            {/* Status Badge */}
            {result && status === 'done' && (
              <div className={`status-badge ${result}`} id="status-badge">
                {result === 'passed' ? (
                  <>
                    <span className="status-badge-icon">✅</span>
                    All Tests Passed
                  </>
                ) : (
                  <>
                    <span className="status-badge-icon">❌</span>
                    Tests Failed
                  </>
                )}
              </div>
            )}

            {status === 'running' && (
              <div className="runner-spinner">
                <div className="spinner-ring"></div>
                <span>Running…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Browser Monitor */}
      <LiveMonitor frame={screencastFrame} isRunning={status === 'running'} />

      {/* Log Console */}
      <div className="log-console-container">
        <div className="log-console-header">
          <span className="log-console-title">
            <span className="log-console-dot"></span>
            Live Output
          </span>
          <span className="log-console-count">
            {logs.length} {logs.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="log-console" id="log-console">
          {logs.length === 0 ? (
            <div className="log-empty">
              <span className="log-empty-icon">📺</span>
              <span>Select a test and click Run to see live output here…</span>
            </div>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className={getLogClass(entry.type)}>
                <span className="log-line-number">{i + 1}</span>
                <span className="log-line-text">{entry.line}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
