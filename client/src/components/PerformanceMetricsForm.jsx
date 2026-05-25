import { useState } from 'react';

const CATEGORIES = [
  { id: 'performance',    label: 'Performance',    icon: '⚡', desc: 'Core Web Vitals, Speed Index, TTI' },
  { id: 'seo',            label: 'SEO',            icon: '🔍', desc: 'Crawlability, meta tags, structured data' },
  { id: 'accessibility',  label: 'Accessibility',  icon: '♿', desc: 'ARIA, contrast, keyboard navigation' },
  { id: 'best-practices', label: 'Best Practices', icon: '🔒', desc: 'Security, deprecated APIs, HTTPS' },
];

export default function PerformanceMetricsForm({ initialData, onSave, saving }) {
  const [testName,   setTestName]   = useState(initialData?.testName   || '');
  const [urls,       setUrls]       = useState(
    initialData?.urls ?? (initialData?.url ? [initialData.url] : [''])
  );
  const [categories, setCategories] = useState(
    initialData?.categories ?? ['performance']
  );
  const [errors, setErrors] = useState({});

  // ── URL list handlers ────────────────────────────────────
  const updateUrl = (index, value) => {
    const next = [...urls];
    next[index] = value;
    setUrls(next);
    setErrors((prev) => { const n = { ...prev }; delete n[`url-${index}`]; return n; });
  };

  const addUrl = () => setUrls((prev) => [...prev, '']);

  const removeUrl = (index) => {
    if (urls.length <= 1) return;
    setUrls((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => { const n = { ...prev }; delete n[`url-${index}`]; return n; });
  };

  const toggleCategory = (id) => {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
    setErrors((prev) => { const n = { ...prev }; delete n.categories; return n; });
  };

  const validate = () => {
    const next = {};
    if (!testName.trim()) next.testName = 'Performance test name is required';
    urls.forEach((u, i) => {
      if (!u.trim()) next[`url-${i}`] = 'URL is required';
      else if (!/^https?:\/\/.+/.test(u.trim())) next[`url-${i}`] = 'Must start with http:// or https://';
    });
    if (categories.length === 0) next.categories = 'Select at least one category';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const buildYAML = () => {
    const cleanName = testName.trim();
    const urlLines  = urls.map((u) => `   - ${u.trim()}`).join('\n');
    const catLines  = categories.map((c) => `   - ${c}`).join('\n');
    return `schemaVersion: 1\n\nperformance: ${cleanName}\n\ntargets:\n${urlLines}\n\ncategories:\n${catLines}\n`;
  };

  const handleSave = () => {
    if (!validate()) return;
    const yaml     = buildYAML();
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
        <label className="form-label" htmlFor="perf-test-name">
          Performance Test Name <span className="form-required">*</span>
        </label>
        <input
          id="perf-test-name"
          className={`form-input ${errors.testName ? 'form-input-error' : ''}`}
          type="text"
          placeholder="e.g. Home Page Load"
          value={testName}
          onChange={(e) => {
            setTestName(e.target.value);
            setErrors((prev) => { const n = { ...prev }; delete n.testName; return n; });
          }}
        />
        {errors.testName && <span className="form-error-text">{errors.testName}</span>}
      </div>

      <hr className="form-divider" />

      {/* Target URLs */}
      <div className="field-groups-container">
        <div className="field-groups-header">
          <span className="form-label" style={{ marginBottom: 0 }}>
            Target URLs <span className="form-required">*</span>
          </span>
          <span className="form-label-hint">{urls.length} URL{urls.length !== 1 ? 's' : ''} — each gets its own report</span>
        </div>

        {urls.map((u, index) => (
          <div key={index} className="field-group">
            <div className="field-group-header">
              <span className="field-group-number">#{index + 1}</span>
              {urls.length > 1 && (
                <button
                  type="button"
                  className="btn-remove-group"
                  onClick={() => removeUrl(index)}
                  title="Remove this URL"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <input
                className={`form-input ${errors[`url-${index}`] ? 'form-input-error' : ''}`}
                type="url"
                placeholder="https://example.com"
                value={u}
                onChange={(e) => updateUrl(index, e.target.value)}
              />
              {errors[`url-${index}`] && (
                <span className="form-error-text">{errors[`url-${index}`]}</span>
              )}
            </div>
          </div>
        ))}

        <button
          type="button"
          className="btn-add"
          onClick={addUrl}
        >
          + Add URL
        </button>
      </div>

      <hr className="form-divider" />

      {/* Audit Categories */}
      <div className="form-group" style={{ marginTop: '4px' }}>
        <label className="form-label">
          Audit Categories <span className="form-required">*</span>
        </label>
        <p style={{ margin: '4px 0 12px', fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
          Select which Lighthouse categories to audit. Both Mobile and Desktop audits will run automatically.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
          {CATEGORIES.map((cat) => {
            const checked = categories.includes(cat.id);
            return (
              <label
                key={cat.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: `2px solid ${checked ? 'var(--accent, #7c3aed)' : 'var(--border, #334155)'}`,
                  background: checked ? 'var(--accent-subtle, rgba(124,58,237,0.12))' : 'var(--surface2, #1e293b)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(cat.id)}
                  style={{ marginTop: '2px', accentColor: 'var(--accent, #7c3aed)', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span>{cat.icon}</span> {cat.label}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', marginTop: '2px' }}>
                    {cat.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {errors.categories && (
          <span className="form-error-text" style={{ marginTop: '8px', display: 'block' }}>
            {errors.categories}
          </span>
        )}
      </div>

      <div className="save-section">
        <span className="save-hint">
          Runs isolated Lighthouse audits for each URL on both Mobile and Desktop with AI-powered fix
          suggestions.
        </span>
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
