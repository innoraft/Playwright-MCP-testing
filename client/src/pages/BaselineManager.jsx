import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function BaselineManager() {
  const { authFetch } = useAuth();
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [uploadData, setUploadData] = useState({ testName: '', breakpoint: '1280px', files: [] });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState('');

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load baselines ────────────────────────────────────
  const fetchBaselines = useCallback(async () => {
    try {
      const res = await authFetch('/api/baselines');
      if (!res.ok) throw new Error('Failed to load baselines');
      const data = await res.json();
      setBaselines(data);
    } catch {
      showToast('Could not load baseline images', 'error');
    } finally {
      setLoading(false);
    }
  }, [authFetch, showToast]);

  useEffect(() => {
    fetchBaselines();
  }, [fetchBaselines]);

  // ── Filtered baselines ────────────────────────────────
  const filteredBaselines = useMemo(() => {
    if (!searchQuery.trim()) return baselines;
    const q = searchQuery.toLowerCase();
    return baselines.filter(b =>
      b.filename.toLowerCase().includes(q) ||
      b.testName.toLowerCase().includes(q) ||
      b.breakpoint.toLowerCase().includes(q)
    );
  }, [baselines, searchQuery]);

  // ── File format bits ──────────────────────────────────
  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (ms) => {
    if (!ms) return 'Unknown';
    const d = new Date(ms);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // ── Auto-generated filename preview ───────────────────
  const expectedFilename = useMemo(() => {
    if (!uploadData.testName.trim()) return '';
    const safeName = uploadData.testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBp = uploadData.breakpoint.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safeName}_${safeBp}.png`;
  }, [uploadData.testName, uploadData.breakpoint]);

  // ── Upload (supports multiple files) ──────────────────
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadData.files.length || !uploadData.testName) {
      showToast('Test name and at least one file are required', 'error');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: uploadData.files.length });

    let successCount = 0;
    let failCount = 0;
    const failedMessages = [];

    for (let i = 0; i < uploadData.files.length; i++) {
      setUploadProgress({ current: i + 1, total: uploadData.files.length });
      try {
        const formData = new FormData();
        formData.append('image', uploadData.files[i]);
        formData.append('testName', uploadData.testName);
        // For multi-file, use index-based breakpoint only if single breakpoint given
        const bp = uploadData.files.length > 1
          ? uploadData.breakpoint
          : uploadData.breakpoint;
        formData.append('breakpoint', bp);

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
        successCount++;
      } catch (err) {
        failCount++;
        failedMessages.push(err.message || 'Upload failed');
      }
    }

    const conflictMessage = failedMessages.find(msg => /already exists/i.test(msg));
    const firstFailureMessage = conflictMessage || failedMessages[0] || '';

    if (failCount > 0) {
      if (successCount > 0) {
        showToast(
          `${successCount} baseline${successCount > 1 ? 's' : ''} uploaded, ${failCount} failed. ${firstFailureMessage}`,
          'error'
        );
      } else {
        showToast(firstFailureMessage || 'All uploads failed', 'error');
      }
    } else {
      showToast(`${successCount} baseline${successCount > 1 ? 's' : ''} uploaded`, 'success');
    }

    setUploadData({ testName: '', breakpoint: '1280px', files: [] });
    const fileInput = document.getElementById('baseline-file-upload');
    if (fileInput) fileInput.value = '';
    setUploadProgress({ current: 0, total: 0 });
    setIsUploading(false);
    await fetchBaselines();
  };

  // ── Delete ────────────────────────────────────────────
  const handleDelete = async (filename) => {
    try {
      const res = await authFetch(`/api/baselines/${filename}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showToast('Baseline deleted');
      setDeleteConfirm(null);
      // Clear preview if deleted image was being previewed
      if (previewImage && previewImage.filename === filename) {
        setPreviewImage(null);
      }
      await fetchBaselines();
    } catch {
      showToast('Failed to delete baseline', 'error');
    }
  };

  // ── Preview navigation ────────────────────────────────
  const navigatePreview = useCallback((direction) => {
    if (!previewImage) return;
    const list = filteredBaselines.length > 0 ? filteredBaselines : baselines;
    const idx = list.findIndex(b => b.filename === previewImage.filename);
    if (idx === -1) return;
    const next = idx + direction;
    if (next >= 0 && next < list.length) {
      setPreviewImage(list[next]);
    }
  }, [previewImage, filteredBaselines, baselines]);

  // ── Keyboard support for preview modal ────────────────
  useEffect(() => {
    if (!previewImage) return;
    const handler = (e) => {
      if (e.key === 'Escape') setPreviewImage(null);
      if (e.key === 'ArrowLeft') navigatePreview(-1);
      if (e.key === 'ArrowRight') navigatePreview(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewImage, filteredBaselines, navigatePreview]);

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

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-icon">🗑️</span>
              <h3>Delete Baseline</h3>
            </div>
            <p className="modal-text">
              Are you sure you want to delete <strong>{deleteConfirm}</strong>?
              Visual regression tests relying on this image will fail until a new baseline is uploaded.
            </p>
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="modal-overlay baseline-preview-overlay" onClick={() => setPreviewImage(null)}>
          <div className="baseline-preview-modal" onClick={e => e.stopPropagation()}>
            {/* Preview header */}
            <div className="baseline-preview-header">
              <div>
                <div className="baseline-preview-title">
                  {previewImage.testName}
                  <span className="baseline-preview-breakpoint">@ {previewImage.breakpoint}</span>
                </div>
                <div className="baseline-preview-meta">
                  <span>{previewImage.filename}</span>
                  <span>{formatSize(previewImage.sizeBytes)}</span>
                  <span>{formatDate(previewImage.modified)}</span>
                </div>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="baseline-preview-close"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Preview body */}
            <div className="baseline-preview-body">
              {/* Nav arrows */}
              <button
                onClick={() => navigatePreview(-1)}
                className="baseline-preview-nav baseline-preview-nav-left"
                title="Previous (←)"
              >
                ‹
              </button>

              <img
                src={`/files/baselines/${previewImage.filename}?t=${previewImage.modified}`}
                alt={previewImage.filename}
                className="baseline-preview-image"
              />

              <button
                onClick={() => navigatePreview(1)}
                className="baseline-preview-nav baseline-preview-nav-right"
                title="Next (→)"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Baseline Manager</h1>
        <p className="page-subtitle">
          Manage reference images used for pixel-level visual regression comparisons.
        </p>
      </div>

      <div className="baseline-manager-layout">

        {/* Upload Panel */}
        <div className="config-card baseline-upload-panel">
          <h3 className="baseline-upload-title">Upload New Baseline</h3>

          <form onSubmit={handleUploadSubmit}>
            <div className="form-group">
              <label className="form-label">Test Name <span className="form-required">*</span></label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Homepage Regression"
                value={uploadData.testName}
                onChange={e => setUploadData({ ...uploadData, testName: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Breakpoint <span className="form-required">*</span></label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. 1280px"
                value={uploadData.breakpoint}
                onChange={e => setUploadData({ ...uploadData, breakpoint: e.target.value })}
                required
              />
            </div>

            {/* Auto-generated filename preview */}
            {expectedFilename && (
              <div className="baseline-filename-preview">
                <span className="baseline-filename-label">File will be saved as:</span>
                <code className="baseline-filename-code">
                  {expectedFilename}
                </code>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Reference Image (PNG / JPG)</label>
              <div className="baseline-dropzone">
                <div className="baseline-dropzone-icon">📁</div>
                <input
                  id="baseline-file-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  multiple
                  onChange={e => setUploadData({ ...uploadData, files: Array.from(e.target.files) })}
                  required
                  className="baseline-file-input"
                />
                <div className="baseline-dropzone-help">
                  Select one or more PNG / JPG files
                </div>
              </div>

              {/* Selected files preview */}
              {uploadData.files.length > 0 && (
                <div className="baseline-selected-files">
                  <strong>{uploadData.files.length}</strong> file{uploadData.files.length > 1 ? 's' : ''} selected:
                  <ul className="baseline-selected-files-list">
                    {uploadData.files.map((f, i) => (
                      <li key={i} className="baseline-selected-file-item">
                        {f.name} <span className="baseline-selected-file-size">({formatSize(f.size)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {isUploading && uploadProgress.total > 1 && (
              <div className="baseline-upload-progress">
                <div className="baseline-upload-progress-meta">
                  <span>Uploading...</span>
                  <span>{uploadProgress.current} / {uploadProgress.total}</span>
                </div>
                <progress className="baseline-upload-progress-bar" value={uploadProgress.current} max={uploadProgress.total} />
              </div>
            )}

            <button
              type="submit"
              className={`btn-save baseline-upload-submit ${isUploading ? 'saving' : ''}`}
              disabled={isUploading || !uploadData.testName || !uploadData.files.length}
            >
              {isUploading
                ? `Uploading${uploadProgress.total > 1 ? ` (${uploadProgress.current}/${uploadProgress.total})` : '...'}`
                : `Upload Baseline${uploadData.files.length > 1 ? 's' : ''}`}
            </button>
          </form>
        </div>

        {/* Gallery Panel */}
        <div className="gallery-panel baseline-gallery-panel">
          <div className="baseline-gallery-header">
            <h3 className="baseline-gallery-title">Existing Baselines</h3>
            <div className="baseline-gallery-controls">
              <input
                type="text"
                placeholder="Search baselines..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="baseline-search-input"
              />
              <span className="form-input baseline-total-chip">
                {filteredBaselines.length}{searchQuery ? ` / ${baselines.length}` : ''} total
              </span>
            </div>
          </div>

          {loading ? (
            <div className="baseline-loading-grid">
              {[1, 2, 3].map(i => <div key={i} className="skeleton baseline-loading-skeleton" />)}
            </div>
          ) : filteredBaselines.length === 0 ? (
            <div className="test-list-empty baseline-empty-state">
              <span className="test-list-empty-icon">🖼️</span>
              <span>{searchQuery ? 'No matching baselines' : 'No baselines found'}</span>
              <span className="baseline-empty-help">
                {searchQuery ? 'Try a different search term' : 'Upload a reference image to get started'}
              </span>
            </div>
          ) : (
            <div className="baseline-grid">
              {filteredBaselines.map(img => (
                <div
                  key={img.filename}
                  className="baseline-card"
                >
                  {/* Thumbnail area — clickable for preview */}
                  <div
                    onClick={() => setPreviewImage(img)}
                    className="baseline-thumb"
                  >
                    <img
                      src={`/files/baselines/${img.filename}?t=${img.modified}`}
                      alt={img.filename}
                      className="baseline-thumb-image"
                    />
                    {/* Hover overlay */}
                    <div className="baseline-thumb-overlay">
                      <span className="baseline-thumb-overlay-text">
                        Click to preview
                      </span>
                    </div>
                  </div>

                  {/* Metadata area */}
                  <div className="baseline-card-content">
                    <div className="baseline-card-head">
                      <div className="baseline-card-title-wrap">
                        <div className="baseline-card-name">{img.testName}</div>
                        <div className="baseline-card-breakpoint">@ {img.breakpoint}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(img.filename); }}
                        className="baseline-delete-btn"
                        title="Delete baseline"
                      >
                        🗑️
                      </button>
                    </div>

                    <div className="baseline-card-footer">
                      <span>{formatSize(img.sizeBytes)}</span>
                      <span>{formatDate(img.modified)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
