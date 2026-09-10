import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import LiveMonitor from '../components/LiveMonitor';
import { TEST_RUNNER_UI } from '../constants/testRunnerUi';

export default function TestRunner({ onNavigateToReport, onRunningChange }) {
  const { authFetch, token } = useAuth();
  const [tests, setTests] = useState([]);
  const [selectedTest, setSelectedTest] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done
  const [result, setResult] = useState(null);   // null | 'passed' | 'failed'
  const [logs, setLogs] = useState([]);
  const [toast, setToast] = useState(null);
  const [screencastFrame, setScreencastFrame] = useState(null);
  const [isPerformanceTest, setIsPerformanceTest] = useState(false);
  const [animeActive, setAnimeActive] = useState(false);

  const logEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const runIdRef = useRef(null);
  const liveLayoutRef = useRef(null);
  const runActivityRef = useRef(null);
  const showAnimation = TEST_RUNNER_UI.animation;
  const showTerminalOutput = TEST_RUNNER_UI.terminalOutput;

  // ── Toast helper ──────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load test list ────────────────────────────────────
  useEffect(() => {
    authFetch('/api/tests')
      .then(res => res.json())
      .then(data => setTests((Array.isArray(data) ? data : []).filter(t => t.type !== 'form-validation')))
      .catch(() => showToast('Could not load test files', 'error'));
  }, [showToast, authFetch]);

  // ── Auto-scroll developer logs when enabled ──────────
  useEffect(() => {
    if (!showTerminalOutput) return;
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showTerminalOutput]);

  // ── Cleanup SSE on unmount ────────────────────────────
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // ── Focus live monitor/output split when run starts ───
  useEffect(() => {
    if (status === 'running' && liveLayoutRef.current) {
      liveLayoutRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [status]);

  // ── Anime.js motion for run-activity panel ───────────
  useEffect(() => {
    let isMounted = true;
    let ringRotateAnimation;
    let corePulseAnimation;
    let completionAnimation;

    const loadAnimation = async () => {
      if (!runActivityRef.current || !showAnimation) return;
      setAnimeActive(false);

      try {
        const animeModuleName = 'animejs';
        const animeImport = await import(/* @vite-ignore */ animeModuleName);
        if (!isMounted) return;

        const anime = animeImport.default || animeImport;
        const rings = runActivityRef.current.querySelectorAll('.run-activity-loader-ring');
        const core = runActivityRef.current.querySelector('.run-activity-loader-core');

        if (status === 'running') {
          setAnimeActive(true);

          ringRotateAnimation = anime({
            targets: rings,
            rotate: 360,
            easing: 'linear',
            duration: 2800,
            delay: anime.stagger(160),
            loop: true
          });

          corePulseAnimation = anime({
            targets: core,
            scale: [1, 1.08],
            easing: 'easeInOutSine',
            direction: 'alternate',
            duration: 820,
            loop: true
          });

        }

        if (status === 'done') {
          completionAnimation = anime({
            targets: runActivityRef.current,
            scale: [0.98, 1],
            opacity: [0.7, 1],
            easing: 'easeOutQuad',
            duration: 420
          });
        }
      } catch {
        // Keep CSS-only fallback when anime.js is unavailable.
      }
    };

    loadAnimation();

    return () => {
      isMounted = false;
      setAnimeActive(false);
      [ringRotateAnimation, corePulseAnimation, completionAnimation].forEach((animation) => {
        if (animation?.pause) animation.pause();
      });
    };
  }, [status, showAnimation]);



  const runStateLabel = useMemo(() => {
    if (status === 'running') return 'Active';
    if (status === 'done' && result === 'passed') return 'Passed';
    if (status === 'done' && result === 'stopped') return 'Stopped';
    if (status === 'done') return 'Failed';
    return 'Idle';
  }, [status, result]);

  const getLogClass = (type) => {
    switch (type) {
      case 'pass': return 'log-line log-pass';
      case 'fail': return 'log-line log-fail';
      case 'llm': return 'log-line log-llm';
      case 'step': return 'log-line log-step';
      default: return 'log-line';
    }
  };

  // ── Connect to SSE ───────────────────────────────────
  const connectSSE = useCallback((runId) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(
      `/api/runner/logs?token=${encodeURIComponent(token)}&runId=${encodeURIComponent(runId)}`
    );
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

    es.addEventListener('perftest', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.isPerformanceTest) {
          setIsPerformanceTest(true);
        }
      } catch { /* ignore */ }
    });

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data);
        setStatus('done');
        setResult(data.result);
        if (onRunningChange) onRunningChange(false);

        // Auto-navigate to reports after a short delay
        if (data.reportFile && onNavigateToReport) {
          setTimeout(() => {
            onNavigateToReport(data.reportFile);
          }, 2500);
        }
        runIdRef.current = null;
      } catch { /* ignore */ }

      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = () => {
      // SSE connection lost — if still running, it may have ended
      es.close();
      eventSourceRef.current = null;
      if (onRunningChange) onRunningChange(false);
    };
  }, [onNavigateToReport, onRunningChange, token]);

  // ── Run Test ──────────────────────────────────────────
  const handleRun = async () => {
    if (!selectedTest) return;

    // Clear previous state
    runIdRef.current = null;
    setLogs([]);
    setResult(null);
    setStatus('running');
    setScreencastFrame(null);
    setIsPerformanceTest(false);
    if (onRunningChange) onRunningChange(true);

    try {
      const res = await authFetch('/api/runner/run', {
        method: 'POST',
        body: JSON.stringify({ testName: selectedTest })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start test');
      }

      const data = await res.json();
      runIdRef.current = data.runId;

      // Connect to SSE for live logs/events
      connectSSE(data.runId);
    } catch (err) {
      runIdRef.current = null;
      showToast(err.message, 'error');
      setStatus('idle');
      if (onRunningChange) onRunningChange(false);
    }
  };

  // ── Stop Test ─────────────────────────────────────────
  const handleStop = async () => {
    if (!runIdRef.current) {
      showToast('Test is still starting. Please wait a moment.', 'error');
      return;
    }

    try {
      const res = await authFetch('/api/runner/stop', {
        method: 'POST',
        body: JSON.stringify({ runId: runIdRef.current })
      });
      let reportFile;

      // Stop may or may not return a report path; navigate either way.
      try {
        const data = await res.json();
        reportFile = data?.reportFile;
      } catch {
        reportFile = undefined;
      }

      showToast('Test run stopped');
      setStatus('done');
      setResult('stopped');
      if (onRunningChange) onRunningChange(false);
      // Close SSE connection immediately
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      runIdRef.current = null;

      if (onNavigateToReport) {
        onNavigateToReport(reportFile);
      }
    } catch {
      showToast('Failed to stop test', 'error');
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
          Execute tests and monitor progress in real time through live visual activity signals.
        </p>
      </div>

      {/* Run Controls */}
      <div className="config-card">
        <div className="runner-controls row">
          {/* Test Selector */}
          <div className="runner-select-group col-10">
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
          <div className="runner-actions col-2">
            {status === 'running' ? (
              <button
                className="btn-stop"
                onClick={handleStop}
                disabled={!runIdRef.current}
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
              <div
                className={`status-badge ${result === 'passed' ? 'passed' : result === 'stopped' ? 'stopped' : 'failed'}`}
                id="status-badge"
              >
                {result === 'passed' ? (
                  <>
                    <span className="status-badge-icon">✅</span>
                    All Tests Passed
                  </>
                ) : result === 'stopped' ? (
                  <>
                    <span className="status-badge-icon">⏸</span>
                    Test Run Stopped
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

      <div
        className={`runner-live-split ${status === 'running' ? 'running' : ''} ${showAnimation ? 'show-animation' : ''} ${showTerminalOutput ? 'show-terminal' : ''}`}
        ref={liveLayoutRef}
      >
        {/* Live Browser Monitor */}
        <LiveMonitor frame={screencastFrame} isRunning={status === 'running'} isPerformanceTest={isPerformanceTest} />

        {/* Live Run Activity */}
        {showAnimation && (
          <div
            className={`run-activity-container ${status === 'running' ? 'is-running' : ''} ${status === 'done' ? 'is-done' : ''} ${status === 'done' && result ? `result-${result}` : ''} ${animeActive ? 'anime-active' : ''}`}
            ref={runActivityRef}
          >
            <div className="run-activity-header">
              <span className="run-activity-title">
                <span className="run-activity-dot"></span>
                Test Execution Pulse
              </span>
              <span className={`run-activity-state ${status} ${result || ''}`}>
                {runStateLabel}
              </span>
            </div>

            <div className="run-activity-surface">
              <div className="run-activity-hero" aria-hidden="true">
                <div className="run-activity-loader-wrap">
                  <div className="run-activity-loader-ring run-activity-loader-ring-a"></div>
                  <div className="run-activity-loader-ring run-activity-loader-ring-b"></div>
                  <div className="run-activity-loader-ring run-activity-loader-ring-c"></div>
                  <div className="run-activity-loader-core">
                    {status === 'running' ? 'RUN' : status === 'done' ? 'END' : 'IDLE'}
                  </div>
                </div>

                <div className="run-activity-graph">
                  {[22, 48, 72, 88, 58, 94, 76, 50, 82, 66, 38, 80, 56, 90, 44, 70, 30, 82, 54, 42].map((peak, i) => (
                    <span
                      key={i}
                      className="run-activity-graph-bar"
                      style={{ '--peak': `${peak}%`, '--delay': `${(i * 0.055).toFixed(3)}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Terminal Output (Developer mode) */}
        {showTerminalOutput && (
          <div className="log-console-container">
            <div className="log-console-header">
              <span className="log-console-title">
                <span className="log-console-dot"></span>
                Terminal Output
              </span>
              <span className="log-console-count">
                {logs.length} {logs.length === 1 ? 'line' : 'lines'}
              </span>
            </div>
            <div className="log-console" id="log-console">
              {logs.length === 0 ? (
                <div className="log-empty">
                  <span className="log-empty-icon">📺</span>
                  <span>Developer output will appear here during run.</span>
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
        )}

        {!showAnimation && !showTerminalOutput && (
          <div className="run-mode-empty">
            <h4>Run panel disabled</h4>
            <p>
              Enable at least one mode in
              {' '}
              <strong>client/src/constants/testRunnerUi.js</strong>
              {' '}
              by setting animation or terminalOutput to true.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
