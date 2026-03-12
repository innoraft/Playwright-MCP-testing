import { useState, useMemo } from 'react';

// ── Screenshot name generator ───────────────────────────
function generateScreenshotName(testName, width) {
  const base = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${base}_${width}px.png`;
}

export default function VisualRegressionForm({ initialData, onSave, saving }) {
  const [testName, setTestName] = useState(initialData?.testName || '');
  const [url, setUrl] = useState(initialData?.url || '');
  const [breakpoints, setBreakpoints] = useState(
    initialData?.breakpoints || [{ width: 1280, height: 720 }]
  );
  const [errors, setErrors] = useState({});

  // ── Computed screenshot names ─────────────────────────
  const screenshotPreviews = useMemo(() => {
    return breakpoints.map(bp =>
      generateScreenshotName(testName || 'untitled', bp.width)
    );
  }, [testName, breakpoints]);

  // ── Handlers ──────────────────────────────────────────
  const updateBreakpoint = (index, field, value) => {
    const updated = [...breakpoints];
    updated[index] = { ...updated[index], [field]: Number(value) || 0 };
    setBreakpoints(updated);
    setErrors(prev => {
      const next = { ...prev };
      delete next[`bp-${index}-${field}`];
      return next;
    });
  };

  const addBreakpoint = () => {
    setBreakpoints([...breakpoints, { width: 768, height: 1024 }]);
  };

  const removeBreakpoint = (index) => {
    if (breakpoints.length <= 1) return;
    setBreakpoints(breakpoints.filter((_, i) => i !== index));
  };

  // ── Validation ────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (!testName.trim()) errs.testName = 'Test name is required';
    if (!url.trim()) errs.url = 'URL is required';
    else if (!/^https?:\/\/.+/.test(url.trim())) errs.url = 'Enter a valid URL starting with http:// or https://';
    breakpoints.forEach((bp, i) => {
      if (!bp.width || bp.width < 1) errs[`bp-${i}-width`] = 'Width must be > 0';
      if (!bp.height || bp.height < 1) errs[`bp-${i}-height`] = 'Height must be > 0';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── YAML Generation (matches user's buildYAML prompt) ─
  const buildYAML = () => {
    const name = testName;
    const steps = [`  - Navigate to ${url}`];
    breakpoints.forEach((bp) => {
      const screenshotName = generateScreenshotName(testName, bp.width);
      steps.push(`  - Resize the viewport to ${bp.width}x${bp.height}`);
      steps.push(`  - Scroll the page 20%`);
      steps.push(`  - Wait for 2 seconds`);
      steps.push(`  - Scroll the page 40%`);
      steps.push(`  - Wait for 2 seconds`);
      steps.push(`  - Scroll the page 60%`);
      steps.push(`  - Wait for 2 seconds`);
      steps.push(`  - Scroll the page 75%`);
      steps.push(`  - Wait for 2 seconds`);
      steps.push(`  - Scroll the page till the footer`);
      steps.push(`  - Wait for 2 seconds`);
      steps.push(`  - Navigate the page till the header`);
      steps.push(`  - Take a screenshot of the full page and save by giving the name '${screenshotName}'`);
      steps.push(`  - Check visual regression at breakpoint ${bp.width}px using screenshot files/screenshots/${screenshotName}`);
    });
    return `name: ${name}\nsteps:\n${steps.join('\n')}\n`;
  };

  // ── Save ──────────────────────────────────────────────
  const handleSave = () => {
    if (!validate()) return;
    const yaml = buildYAML();
    const fileName = testName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    onSave(fileName, yaml);
  };

  return (
    <div className="test-form">
      {/* Test Name */}
      <div className="form-group">
        <label className="form-label" htmlFor="vr-test-name">
          Test Name <span className="form-required">*</span>
        </label>
        <input
          id="vr-test-name"
          className={`form-input ${errors.testName ? 'form-input-error' : ''}`}
          type="text"
          placeholder="e.g. Visual Regression Test"
          value={testName}
          onChange={(e) => {
            setTestName(e.target.value);
            setErrors(prev => { const n = { ...prev }; delete n.testName; return n; });
          }}
        />
        {errors.testName && <span className="form-error-text">{errors.testName}</span>}
      </div>

      {/* URL */}
      <div className="form-group">
        <label className="form-label" htmlFor="vr-url">
          Target URL <span className="form-required">*</span>
        </label>
        <input
          id="vr-url"
          className={`form-input ${errors.url ? 'form-input-error' : ''}`}
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setErrors(prev => { const n = { ...prev }; delete n.url; return n; });
          }}
        />
        {errors.url && <span className="form-error-text">{errors.url}</span>}
      </div>

      <hr className="form-divider" />

      {/* Breakpoints */}
      <div className="field-groups-container">
        <div className="field-groups-header">
          <span className="form-label" style={{ marginBottom: 0 }}>Breakpoints</span>
          <span className="form-label-hint">{breakpoints.length} breakpoint{breakpoints.length > 1 ? 's' : ''}</span>
        </div>

        {breakpoints.map((bp, index) => (
          <div key={index} className="field-group">
            <div className="field-group-header">
              <span className="field-group-number">#{index + 1}</span>
              {breakpoints.length > 1 && (
                <button
                  type="button"
                  className="btn-remove-group"
                  onClick={() => removeBreakpoint(index)}
                  title="Remove this breakpoint"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="bp-row">
              <div className="form-group bp-field">
                <label className="form-label form-label-sm">
                  Width (px) <span className="form-required">*</span>
                </label>
                <input
                  className={`form-input ${errors[`bp-${index}-width`] ? 'form-input-error' : ''}`}
                  type="number"
                  min="1"
                  placeholder="1280"
                  value={bp.width}
                  onChange={(e) => updateBreakpoint(index, 'width', e.target.value)}
                />
                {errors[`bp-${index}-width`] && (
                  <span className="form-error-text">{errors[`bp-${index}-width`]}</span>
                )}
              </div>

              <span className="bp-separator">×</span>

              <div className="form-group bp-field">
                <label className="form-label form-label-sm">
                  Height (px) <span className="form-required">*</span>
                </label>
                <input
                  className={`form-input ${errors[`bp-${index}-height`] ? 'form-input-error' : ''}`}
                  type="number"
                  min="1"
                  placeholder="720"
                  value={bp.height}
                  onChange={(e) => updateBreakpoint(index, 'height', e.target.value)}
                />
                {errors[`bp-${index}-height`] && (
                  <span className="form-error-text">{errors[`bp-${index}-height`]}</span>
                )}
              </div>
            </div>

            {/* Screenshot name preview */}
            <div className="screenshot-preview">
              <span className="screenshot-preview-label">📸 Screenshot:</span>
              <code className="screenshot-preview-name">{screenshotPreviews[index]}</code>
            </div>
          </div>
        ))}

        <button type="button" className="btn-add" onClick={addBreakpoint}>
          <span>＋</span> Add Breakpoint
        </button>
      </div>

      {/* Save */}
      <div className="save-section">
        <span className="save-hint">YAML with scroll + screenshot steps is generated automatically</span>
        <button
          className={`btn-save ${saving ? 'saving' : ''}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Test'}
        </button>
      </div>
    </div>
  );
}
