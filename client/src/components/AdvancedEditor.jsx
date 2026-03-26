import { useState } from 'react';

export default function AdvancedEditor({ initialContent, onSave, saving }) {
  const [content, setContent] = useState(initialContent || '');
  const [fileName, setFileName] = useState('');
  const [dismissed, setDismissed] = useState(false);

  const handleSave = () => {
    if (!fileName.trim()) return;
    if (!content.trim()) return;
    onSave(fileName.trim(), content);
  };

  return (
    <div className="test-form">
      {/* Warning Banner */}
      {!dismissed && (
        <div className="warning-banner">
          <div className="warning-banner-content">
            <span className="warning-banner-icon">⚠️</span>
            <div>
              <strong>Advanced Mode</strong> — Changes are saved as-is without
              validation or auto-formatting. Make sure your YAML syntax is correct.
            </div>
          </div>
          <button
            className="warning-banner-dismiss"
            onClick={() => setDismissed(true)}
          >
            ✕
          </button>
        </div>
      )}

      {/* File Name */}
      <div className="form-group">
        <label className="form-label" htmlFor="editor-file-name">
          File Name <span className="form-required">*</span>
          <span className="form-label-hint">.test.yml will be appended automatically</span>
        </label>
        <input
          id="editor-file-name"
          className="form-input"
          type="text"
          placeholder="my-custom-test"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
        />
      </div>

      {/* Raw Editor */}
      <div className="form-group">
        <label className="form-label" htmlFor="editor-content">
          Test Content (YAML)
        </label>
        <textarea
          id="editor-content"
          className="form-textarea form-textarea-lg"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Test: My Custom Test\n\nSteps:\n  - Navigate to https://example.com\n  - Verify the page title is "Example"`}
          rows={18}
          spellCheck={false}
        />
      </div>

      {/* Save */}
      <div className="save-section">
        <span className="save-hint">Content is saved exactly as written</span>
        <button
          className={`btn-save ${saving ? 'saving' : ''}`}
          onClick={handleSave}
          disabled={saving || !fileName.trim() || !content.trim()}
        >
          {saving ? 'Saving...' : 'Save Test'}
        </button>
      </div>
    </div>
  );
}
