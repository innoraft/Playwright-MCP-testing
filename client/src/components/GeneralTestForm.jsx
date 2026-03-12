import { useState } from 'react';

export default function GeneralTestForm({ initialData, onSave, saving }) {
  const [testName, setTestName] = useState(initialData?.testName || '');
  const [groups, setGroups] = useState(
    initialData?.groups || [{ scenario: '', steps: '' }]
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
    setGroups([...groups, { scenario: '', steps: '' }]);
  };

  const removeGroup = (index) => {
    if (groups.length <= 1) return;
    setGroups(groups.filter((_, i) => i !== index));
  };

  // ── Validation ────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (!testName.trim()) errs.testName = 'Test name is required';
    groups.forEach((g, i) => {
      if (!g.scenario.trim()) errs[`group-${i}-scenario`] = 'Scenario is required';
      if (!g.steps.trim()) errs[`group-${i}-steps`] = 'Test steps are required';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── YAML Generation ───────────────────────────────────
  const generateYAML = () => {
    const allSteps = [];
    groups.forEach((g) => {
      // Add scenario as a comment
      allSteps.push(`  # ${g.scenario}`);
      // Parse steps (each line becomes a step)
      g.steps.split('\n').filter(s => s.trim()).forEach(step => {
        allSteps.push(`  - ${step.trim()}`);
      });
    });
    return `Test: ${testName}\n\nSteps:\n${allSteps.join('\n')}\n`;
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
                Test Steps <span className="form-required">*</span>
                <span className="form-label-hint">(one step per line)</span>
              </label>
              <textarea
                className={`form-textarea ${errors[`group-${index}-steps`] ? 'form-input-error' : ''}`}
                placeholder={"Navigate to https://example.com\nWait for the page to load\nVerify that the heading is visible"}
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
