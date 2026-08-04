import { useState, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';

// ── Screenshot name generator ───────────────────────────
function generateScreenshotName(testName, width) {
  const base = testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${base}_${width}px.png`;
}

export default function VisualRegressionForm({ initialData, onSave, saving }) {
  const { authFetch } = useAuth();
  const [testName, setTestName] = useState(initialData?.testName || '');
  const [url, setUrl] = useState(initialData?.url || '');
  const [threshold, setThreshold] = useState(initialData?.threshold ?? 0.1);
  const [failOnPercent, setFailOnPercent] = useState(initialData?.failOnPercent ?? 1.0);
  const [breakpoints, setBreakpoints] = useState(
    initialData?.breakpoints || [{ width: 1280, height: 720 }]
  );
  const [baselines, setBaselines] = useState({});
  const [uploading, setUploading] = useState(false);
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
    if (threshold < 0 || threshold > 1) errs.threshold = 'Must be between 0.0 and 1.0';
    if (failOnPercent < 0 || failOnPercent > 100) errs.failOnPercent = 'Must be between 0.0 and 100.0';

    breakpoints.forEach((bp, i) => {
      if (!bp.width || bp.width < 1) errs[`bp-${i}-width`] = 'Width must be > 0';
      if (!bp.height || bp.height < 1) errs[`bp-${i}-height`] = 'Height must be > 0';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Baseline Upload ───────────────────────────────────
  const handleBaselineUpload = async (file, index) => {
    if (!file) return;
    if (!testName.trim()) {
      setErrors(prev => ({ ...prev, testName: 'Test name required before uploading baselines' }));
      return;
    }

    setUploading(index);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('testName', testName);
      formData.append('breakpoint', `${breakpoints[index].width}px`);

      const res = await authFetch('/api/baselines/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        let message = 'Upload failed';
        try {
          const err = await res.json();
          if (err?.error) message = err.error;
        } catch {
          // Keep default message.
        }
        throw new Error(message);
      }
      const data = await res.json();

      setBaselines(prev => ({
        ...prev,
        [index]: {
          url: `/${data.path}?t=${Date.now()}`,
          filename: data.filename
        }
      }));
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to upload baseline');
    } finally {
      setUploading(false);
    }
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
      steps.push(`  - Wait for 2 seconds`);
      steps.push(`  - Take a screenshot of the full page and save by giving the name '${screenshotName}'`);
      steps.push(`  - Check visual regression at breakpoint ${bp.width}px using screenshot files/screenshots/${screenshotName} strictly checking if threshold is ${threshold} or the file is less than ${failOnPercent} percent differing otherwise failing.`);
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
      <div className="row">
        {/* Test Name */}
        <div className="form-group col-6">
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
        <div className="form-group col-6">
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
      </div>
      {/* Sensitivity Controls */}
      <div className="form-row" style={{ display: 'flex', gap: '20px', marginTop: '16px' }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="vr-threshold">
            Color Sensitivity
            <span className="form-label-hint">0 = exact match, 1 = very lenient</span>
          </label>
          <input
            id="vr-threshold"
            className={`form-input ${errors.threshold ? 'form-input-error' : ''}`}
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={threshold}
            onChange={(e) => {
              setThreshold(parseFloat(e.target.value) || 0);
              setErrors(prev => { const n = { ...prev }; delete n.threshold; return n; });
            }}
          />
          {errors.threshold && <span className="form-error-text">{errors.threshold}</span>}
        </div>

        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label" htmlFor="vr-fail">
            Acceptable Difference %
            <span className="form-label-hint">How much of the page can differ before failing</span>
          </label>
          <input
            id="vr-fail"
            className={`form-input ${errors.failOnPercent ? 'form-input-error' : ''}`}
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={failOnPercent}
            onChange={(e) => {
              setFailOnPercent(parseFloat(e.target.value) || 0);
              setErrors(prev => { const n = { ...prev }; delete n.failOnPercent; return n; });
            }}
          />
          {errors.failOnPercent && <span className="form-error-text">{errors.failOnPercent}</span>}
        </div>
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

            {/* Screenshot name preview & Baseline Upload */}
            <div className="bp-baseline-section" style={{ marginTop: '12px', padding: '12px', background: '#f9fafb', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div className="screenshot-preview">
                  <span className="screenshot-preview-label">📸 Screenshot:</span>
                  <code className="screenshot-preview-name">{screenshotPreviews[index]}</code>
                </div>
                
                <div className="baseline-status">
                  {baselines[index] || initialData?.hasBaseline ? (
                    <span style={{ color: '#15803d', fontSize: '12px', fontWeight: '600' }}>✅ Baseline ready</span>
                  ) : (
                    <span style={{ color: '#9ca3af', fontSize: '12px' }}>No baseline</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label form-label-sm">Upload Baseline Image</label>
                  <input 
                    type="file" 
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={(e) => handleBaselineUpload(e.target.files[0], index)}
                    disabled={uploading === index || !testName.trim()}
                    style={{ fontSize: '13px' }}
                  />
                  {uploading === index && <span style={{ fontSize: '12px', color: '#6366f1', marginLeft: '8px' }}>Uploading...</span>}
                </div>
                
                {baselines[index] && (
                  <div className="baseline-preview" style={{ width: '100px', height: '60px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                    <img src={baselines[index].url} alt="Baseline preview" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        <button type="button" className="btn-add" onClick={addBreakpoint}>
          <span>＋</span> Add Breakpoint
        </button>
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
