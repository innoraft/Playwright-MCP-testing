import { useState, useEffect, useCallback } from 'react';
import { PROVIDERS, MODELS_BY_PROVIDER } from '../constants/llmProviders';
import { useAuth } from '../hooks/useAuth';

export default function LLMConfig() {
  const { authFetch } = useAuth();
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-5');
  const [apiKey, setApiKey] = useState('');
  const [temperature, setTemperature] = useState(1);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // ── Load saved config on mount ────────────────────────
  useEffect(() => {
    authFetch('/api/llm-config')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        setProvider(data.provider || 'openai');
        setModel(data.model || '');
        setApiKey(data.apiKey || '');
        setTemperature(data.temperature ?? 1);
      })
      .catch(() => {
        showToast('Could not load saved configuration', 'error');
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Toast helper ──────────────────────────────────────
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── When provider changes, reset model ────────────────
  const handleProviderChange = (e) => {
    const newProvider = e.target.value;
    setProvider(newProvider);
    const models = MODELS_BY_PROVIDER[newProvider];
    setModel(models?.[0]?.value || '');
  };

  // ── Save config ───────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch('/api/llm-config', {
        method: 'POST',
        body: JSON.stringify({ provider, model, apiKey, temperature }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }

      showToast('Configuration saved successfully');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────
  const models = MODELS_BY_PROVIDER[provider] || [];
  const sliderProgress = (temperature / 2) * 100;

  const getTemperatureLabel = () => {
    if (temperature <= 0.3) return 'Precise';
    if (temperature <= 0.7) return 'Focused';
    if (temperature <= 1.3) return 'Balanced';
    if (temperature <= 1.7) return 'Creative';
    return 'Experimental';
  };

  // ── Render ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <div className="skeleton" style={{ width: 260, height: 32, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: 400, height: 18 }} />
        </div>
        <div className="config-card">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 120, height: 14, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: '100%', height: 44 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
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
        <h1 className="page-title">LLM Configuration</h1>
        <p className="page-subtitle">
          Configure the AI provider, model, and parameters used across the platform.
          Changes apply to all users immediately.
        </p>
      </div>

      {/* Form Card */}
      <div className="config-card">
        {/* Provider */}
        <div className="form-group">
          <label className="form-label" htmlFor="provider-select">
            AI Provider
          </label>
          <select
            id="provider-select"
            className="form-select"
            value={provider}
            onChange={handleProviderChange}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div className="form-group">
          <label className="form-label" htmlFor="api-key-input">
            API Key
            <span className="form-label-hint">(stored securely)</span>
          </label>
          <div className="form-input-wrapper">
            <input
              id="api-key-input"
              className="form-input"
              type={showKey ? 'text' : 'password'}
              placeholder="Enter your API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="toggle-visibility-btn"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {/* Model */}
        <div className="form-group">
          <label className="form-label" htmlFor="model-select">
            Model
            <span className="form-label-hint">
              ({models.length} available for {PROVIDERS.find((p) => p.value === provider)?.label})
            </span>
          </label>
          <select
            id="model-select"
            className="form-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <hr className="form-divider" />

        {/* Temperature Slider */}
        <div className="form-group">
          <label className="form-label">Temperature</label>
          <div className="slider-container">
            <div className="slider-header">
              <span className="slider-value">{temperature.toFixed(1)}</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--accent-primary-hover)',
                }}
              >
                {getTemperatureLabel()}
              </span>
            </div>
            <div className="slider-track">
              <input
                type="range"
                className="form-slider"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                style={{ '--slider-progress': `${sliderProgress}%` }}
              />
            </div>
            <div className="slider-labels">
              <span className={`slider-label ${temperature === 0 ? 'active' : ''}`}>
                Precise
              </span>
              <span className={`slider-label ${temperature === 1 ? 'active' : ''}`}>
                Balanced
              </span>
              <span className={`slider-label ${temperature === 2 ? 'active' : ''}`}>
                Creative
              </span>
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="save-section">
          <span className="save-hint">Changes are saved to the platform configuration</span>
          <button
            className={`btn-save ${saving ? 'saving' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}
