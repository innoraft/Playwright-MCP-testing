import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * LiveMonitor — Displays CDP screencast frames streamed via SSE.
 *
 * Props:
 *  - frame: base64 JPEG string (latest screencast frame)
 *  - isRunning: whether a test is currently executing
 */
export default function LiveMonitor({ frame, isRunning }) {
  const [expanded, setExpanded] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef(null);

  // Toggle fullscreen on the container
  const handleFullscreen = useCallback(() => {
    if (!fullscreen && containerRef.current) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, [fullscreen]);

  useEffect(() => {
    const onFSChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, []);

  return (
    <div className="live-monitor-container" ref={containerRef}>
      {/* Header bar */}
      <div className="live-monitor-header">
        <button
          className="live-monitor-toggle"
          onClick={() => setExpanded(prev => !prev)}
          title={expanded ? 'Collapse monitor' : 'Expand monitor'}
        >
          <span className={`live-monitor-chevron ${expanded ? 'open' : ''}`}>▸</span>
        </button>

        <span className="live-monitor-title">
          <span className={`live-monitor-dot ${isRunning && frame ? 'live' : ''}`} />
          Live Browser Monitor
        </span>

        {isRunning && frame && (
          <span className="live-monitor-badge">LIVE</span>
        )}

        {expanded && frame && (
          <button
            className="live-monitor-fullscreen-btn"
            onClick={handleFullscreen}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? '⊗' : '⛶'}
          </button>
        )}
      </div>

      {/* Frame viewport */}
      {expanded && (
        <div className="live-monitor-viewport">
          {frame ? (
            <img
              className="live-monitor-frame"
              src={`data:image/jpeg;base64,${frame}`}
              alt="Live browser view"
              draggable={false}
            />
          ) : (
            <div className="live-monitor-placeholder">
              {isRunning ? (
                <>
                  <div className="live-monitor-spinner" />
                  <span>Waiting for browser frames…</span>
                </>
              ) : (
                <>
                  <span className="live-monitor-placeholder-icon">🖥️</span>
                  <span>Run a test to see live browser output here</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
