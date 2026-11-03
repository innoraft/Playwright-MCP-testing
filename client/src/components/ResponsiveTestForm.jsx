import { useState } from 'react';

export default function ResponsiveTestForm({ initialData, onSave, saving }) {
  const [testName, setTestName] = useState(initialData?.testName || '');
  const [url, setUrl] = useState(initialData?.url || '');
  const [preSteps, setPreSteps] = useState(initialData?.preSteps || '');
  const [breakpoints, setBreakpoints] = useState(
    initialData?.breakpoints || [
      { label: 'Desktop', width: 1920, height: 1080 },
      { label: 'Tablet', width: 768, height: 1024 },
      { label: 'Mobile', width: 375, height: 667 },
    ]
  );
  const [errors, setErrors] = useState({});

  // ── Handlers ──────────────────────────────────────────
  const updateBreakpoint = (index, field, value) => {
    const updated = [...breakpoints];
    updated[index] = {
      ...updated[index],
      [field]: field === 'label' ? value : Number(value) || 0,
    };
    setBreakpoints(updated);
    setErrors(prev => {
      const next = { ...prev };
      delete next[`bp-${index}-${field}`];
      return next;
    });
  };

  const MAX_BREAKPOINTS = 3;

  const addBreakpoint = () => {
    if (breakpoints.length >= MAX_BREAKPOINTS) return;
    setBreakpoints([...breakpoints, { label: `Breakpoint ${breakpoints.length + 1}`, width: 1024, height: 768 }]);
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
      if (!bp.label.trim()) errs[`bp-${i}-label`] = 'Label is required';
      if (!bp.width || bp.width < 1) errs[`bp-${i}-width`] = 'Width must be > 0';
      if (!bp.height || bp.height < 1) errs[`bp-${i}-height`] = 'Height must be > 0';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── YAML Generation ───────────────────────────────────
  const buildYAML = () => {
    const preStepLines = preSteps
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const lines = [`name: ${testName}`, `baseUrl: ${url}`, `responsiveness:`];

    if (preStepLines.length > 0) {
      lines.push(`  preSteps:`);
      preStepLines.forEach(step => lines.push(`    - "${step.replace(/"/g, '\\"')}"`));
    }

    lines.push(`  breakpoints:`);
    breakpoints.forEach(bp => {
      lines.push(`    - { label: "${bp.label.replace(/"/g, '\\"')}", width: ${bp.width}, height: ${bp.height} }`);
    });

    return `${lines.join('\n')}\n`;
  };

  // ── Save ──────────────────────────────────────────────
  const handleSave = () => {
    if (!validate()) return;
    const yamlContent = buildYAML();
    const fileName = testName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    onSave(fileName, yamlContent);
  };

  return (
    <div className="test-form">
      <div className="row">
        {/* Test Name */}
        <div className="form-group col-6">
          <label className="form-label" htmlFor="rt-test-name">
            Test Name <span className="form-required">*</span>
          </label>
          <input
            id="rt-test-name"
            className={`form-input ${errors.testName ? 'form-input-error' : ''}`}
            type="text"
            placeholder="e.g. Responsive Check"
            value={testName}
            onChange={(e) => {
              setTestName(e.target.value);
              setErrors(prev => { const n = { ...prev }; delete n.testName; return n; });
            }}
          />
          {errors.testName && <span className="form-error-text">{errors.testName}</span>}
        </div>

        {/* URL */}
        <div className="form-group col-6">
          <label className="form-label" htmlFor="rt-url">
            Target URL <span className="form-required">*</span>
          </label>
          <input
            id="rt-url"
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
      </div>

      {/* Pre-steps */}
      <div className="form-group">
        <label className="form-label" htmlFor="rt-pre-steps">
          Pre-check Steps (optional)
          <span className="form-label-hint">One step per line — run once before the breakpoint checks (e.g. login, dismiss cookie banner)</span>
        </label>
        <textarea
          id="rt-pre-steps"
          className="form-textarea"
          rows={3}
          placeholder={'Dismiss the cookie consent banner if present\nLog in with the demo account'}
          value={preSteps}
          onChange={(e) => setPreSteps(e.target.value)}
        />
      </div>

      <hr className="form-divider" />

      {/* Breakpoints */}
      <div className="field-groups-container">
        <div className="field-groups-header">
          <span className="form-label" style={{ marginBottom: 0 }}>Breakpoints</span>
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

            <div className="form-group">
              <label className="form-label form-label-sm">
                Label <span className="form-required">*</span>
              </label>
              <input
                className={`form-input ${errors[`bp-${index}-label`] ? 'form-input-error' : ''}`}
                type="text"
                placeholder="Desktop"
                value={bp.label}
                onChange={(e) => updateBreakpoint(index, 'label', e.target.value)}
              />
              {errors[`bp-${index}-label`] && (
                <span className="form-error-text">{errors[`bp-${index}-label`]}</span>
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
                  placeholder="1920"
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
                  placeholder="1080"
                  value={bp.height}
                  onChange={(e) => updateBreakpoint(index, 'height', e.target.value)}
                />
                {errors[`bp-${index}-height`] && (
                  <span className="form-error-text">{errors[`bp-${index}-height`]}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {breakpoints.length < MAX_BREAKPOINTS && (
          <button type="button" className="btn-add" onClick={addBreakpoint}>
            <span>＋</span> Add Breakpoint
          </button>
        )}
      </div>

      {/* Save */}
      <div className="save-section">
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
