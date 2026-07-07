import { useState } from 'react';

export default function GeneralTestForm({ initialData, onSave, saving }) {
  const [testName, setTestName] = useState(initialData?.testName || '');
  const [suiteDescription, setSuiteDescription] = useState(initialData?.suiteDescription || '');
  const [baseUrl, setBaseUrl] = useState(initialData?.baseUrl || '');
  const [groups, setGroups] = useState(
    initialData?.groups || [{ scenario: '', description: '', steps: '' }]
  );
  const [errors, setErrors] = useState({});

  // ── Handlers ──────────────────────────────────────────
  const updateGroup = (index, field, value) => {
    const updated = [...groups];
    updated[index] = { ...updated[index], [field]: value };
    setGroups(updated);
    // Clear error for this field
    setErrors(prev => {
      const next = { ...prev };
      delete next[`group-${index}-${field}`];
      return next;
    });
  };

  const addGroup = () => {
    setGroups([...groups, { scenario: '', description: '', steps: '' }]);
  };

  const removeGroup = (index) => {
    if (groups.length <= 1) return;
    setGroups(groups.filter((_, i) => i !== index));
  };

  // ── Validation ────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (!testName.trim()) errs.testName = 'Test name is required';
    if (!baseUrl.trim()) errs.baseUrl = 'Base URL is required';
    groups.forEach((g, i) => {
      if (!g.scenario.trim()) errs[`group-${i}-scenario`] = 'Scenario is required';
      if (!g.steps.trim()) errs[`group-${i}-steps`] = 'Test steps are required';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── YAML Generation ───────────────────────────────────
  const quoteYaml = (value = '') => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  const generateYAML = () => {
    const testBlocks = groups.map((g) => {
      const scenarioDescription = g.description.trim() || `Scenario for ${g.scenario.trim()}`;
      const stepLines = g.steps
        .split('\n')
        .map(step => step.trim())
        .filter(Boolean)
        .map(step => `      - ${quoteYaml(step)}`)
        .join('\n');

      return [
        `  - name: ${quoteYaml(g.scenario.trim())}`,
        `    description: ${quoteYaml(scenarioDescription)}`,
        `    steps:`,
        stepLines,
      ].join('\n');
    }).join('\n');

    return [
      `name: ${quoteYaml(testName.trim())}`,
      `description: ${quoteYaml(suiteDescription.trim() || `Test suite for ${testName.trim()}`)}`,
      `baseUrl: ${quoteYaml(baseUrl.trim())}`,
      '',
      'tests:',
      testBlocks,
      '',
    ].join('\n');
  };

  // ── Save ──────────────────────────────────────────────
  const handleSave = () => {
    if (!validate()) return;
    const yaml = generateYAML();
    // Derive file name from test name
    const fileName = testName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    onSave(fileName, yaml);
  };

  return (
    <div className="test-form">
      {/* Test Name */}
      <div className="form-group">
        <label className="form-label" htmlFor="general-test-name">
          Test Name <span className="form-required">*</span>
        </label>
        <input
          id="general-test-name"
          className={`form-input ${errors.testName ? 'form-input-error' : ''}`}
          type="text"
          placeholder="e.g. Responsive Layout Validation Test"
          value={testName}
          onChange={(e) => {
            setTestName(e.target.value);
            setErrors(prev => { const n = { ...prev }; delete n.testName; return n; });
          }}
        />
        {errors.testName && <span className="form-error-text">{errors.testName}</span>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="general-suite-description">
          Suite Description
        </label>
        <input
          id="general-suite-description"
          className="form-input"
          type="text"
          placeholder="e.g. Tests for user authentication"
          value={suiteDescription}
          onChange={(e) => setSuiteDescription(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="general-base-url">
          Base URL <span className="form-required">*</span>
        </label>
        <input
          id="general-base-url"
          className={`form-input ${errors.baseUrl ? 'form-input-error' : ''}`}
          type="text"
          placeholder="https://www.example.com"
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setErrors(prev => { const n = { ...prev }; delete n.baseUrl; return n; });
          }}
        />
        {errors.baseUrl && <span className="form-error-text">{errors.baseUrl}</span>}
      </div>

      <hr className="form-divider" />

      {/* Scenario Groups */}
      <div className="field-groups-container">
        <div className="field-groups-header">
          <span className="form-label" style={{ marginBottom: 0 }}>Scenario & Test Steps</span>
          <span className="form-label-hint">{groups.length} group{groups.length > 1 ? 's' : ''}</span>
        </div>

        {groups.map((group, index) => (
          <div key={index} className="field-group">
            <div className="field-group-header">
              <span className="field-group-number">#{index + 1}</span>
              {groups.length > 1 && (
                <button
                  type="button"
                  className="btn-remove-group"
                  onClick={() => removeGroup(index)}
                  title="Remove this group"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="form-group">
              <label className="form-label form-label-sm">
                Scenario <span className="form-required">*</span>
              </label>
              <input
                className={`form-input ${errors[`group-${index}-scenario`] ? 'form-input-error' : ''}`}
                type="text"
                placeholder="e.g. Desktop view — verify layout at 1280px"
                value={group.scenario}
                onChange={(e) => updateGroup(index, 'scenario', e.target.value)}
              />
              {errors[`group-${index}-scenario`] && (
                <span className="form-error-text">{errors[`group-${index}-scenario`]}</span>
              )}
            </div>

            <div className="form-group">
              <label className="form-label form-label-sm">
                Scenario Description
              </label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Verify login alert interactions"
                value={group.description || ''}
                onChange={(e) => updateGroup(index, 'description', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label form-label-sm">
                Test Steps <span className="form-required">*</span>
                <span className="form-label-hint">(one step per line)</span>
              </label>
              <textarea
                className={`form-textarea ${errors[`group-${index}-steps`] ? 'form-input-error' : ''}`}
                value={group.steps}
                onChange={(e) => updateGroup(index, 'steps', e.target.value)}
                rows={5}
              />
              {errors[`group-${index}-steps`] && (
                <span className="form-error-text">{errors[`group-${index}-steps`]}</span>
              )}
            </div>
          </div>
        ))}

        <button type="button" className="btn-add" onClick={addGroup}>
          <span>＋</span> Add Scenario Group
        </button>
      </div>

      {/* Save */}
      <div className="save-section">
        <span className="save-hint">YAML is generated automatically from your inputs</span>
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
