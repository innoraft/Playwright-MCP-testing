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
  }, [showToast]);

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

        if (!res.ok) throw new Error('Upload failed');
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      showToast(`${successCount} baseline${successCount > 1 ? 's' : ''} uploaded${failCount > 0 ? ` (${failCount} failed)` : ''}`, failCount > 0 ? 'error' : 'success');
    } else {
      showToast('All uploads failed', 'error');
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
  const navigatePreview = (direction) => {
    if (!previewImage) return;
    const list = filteredBaselines.length > 0 ? filteredBaselines : baselines;
    const idx = list.findIndex(b => b.filename === previewImage.filename);
    if (idx === -1) return;
    const next = idx + direction;
    if (next >= 0 && next < list.length) {
      setPreviewImage(list[next]);
    }
  };

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
  }, [previewImage, filteredBaselines]);

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
        <div className="modal-overlay" onClick={() => setPreviewImage(null)} style={{ zIndex: 1100 }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '12px',
              width: '90vw',
              maxWidth: '1000px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 25px 60px rgba(0,0,0,0.3)'
            }}
          >
            {/* Preview header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              borderBottom: '1px solid #e5e7eb',
              background: '#f9fafb'
            }}>
              <div>
                <div style={{ fontWeight: '600', fontSize: '16px', color: '#111827' }}>
                  {previewImage.testName}
                  <span style={{ color: '#6366f1', fontWeight: '500', marginLeft: '8px' }}>@ {previewImage.breakpoint}</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '4px', fontSize: '13px', color: '#6b7280' }}>
                  <span>{previewImage.filename}</span>
                  <span>{formatSize(previewImage.sizeBytes)}</span>
                  <span>{formatDate(previewImage.modified)}</span>
                </div>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '22px',
                  cursor: 'pointer',
                  color: '#6b7280',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  lineHeight: 1
                }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Preview body */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              background: '#f3f4f6',
              overflow: 'auto',
              position: 'relative',
              minHeight: '400px'
            }}>
              {/* Nav arrows */}
              <button
                onClick={() => navigatePreview(-1)}
                style={{
                  position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.9)', border: '1px solid #d1d5db', borderRadius: '50%',
                  width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)', zIndex: 2
                }}
                title="Previous (←)"
              >
                ‹
              </button>

              <img
                src={`/files/baselines/${previewImage.filename}?t=${previewImage.modified}`}
                alt={previewImage.filename}
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(90vh - 140px)',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
                }}
              />

              <button
                onClick={() => navigatePreview(1)}
                style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(255,255,255,0.9)', border: '1px solid #d1d5db', borderRadius: '50%',
                  width: '40px', height: '40px', cursor: 'pointer', fontSize: '18px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)', zIndex: 2
                }}
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

      <div className="baseline-manager-layout" style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>

        {/* Upload Panel */}
        <div className="config-card" style={{ flex: '0 0 350px', position: 'sticky', top: '20px' }}>
          <h3 style={{ marginBottom: '20px', fontSize: '18px' }}>Upload New Baseline</h3>

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
              <div style={{
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                borderRadius: '6px',
                padding: '10px 14px',
                marginBottom: '16px',
                fontSize: '13px'
              }}>
                <span style={{ color: '#4338ca', fontWeight: '600' }}>File will be saved as:</span>
                <code style={{
                  display: 'block',
                  marginTop: '4px',
                  color: '#312e81',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  wordBreak: 'break-all'
                }}>
                  {expectedFilename}
                </code>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Reference Image (PNG / JPG)</label>
              <div style={{
                border: '2px dashed #d1d5db',
                padding: '20px',
                borderRadius: '8px',
                textAlign: 'center',
                background: '#f9fafb',
                transition: 'border-color 0.2s'
              }}>
                <div style={{ marginBottom: '8px', fontSize: '28px' }}>📁</div>
                <input
                  id="baseline-file-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  multiple
                  onChange={e => setUploadData({ ...uploadData, files: Array.from(e.target.files) })}
                  required
                  style={{ maxWidth: '100%', fontSize: '13px' }}
                />
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
                  Select one or more PNG / JPG files
                </div>
              </div>

              {/* Selected files preview */}
              {uploadData.files.length > 0 && (
                <div style={{ marginTop: '10px', fontSize: '13px', color: '#374151' }}>
                  <strong>{uploadData.files.length}</strong> file{uploadData.files.length > 1 ? 's' : ''} selected:
                  <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px', listStyle: 'disc' }}>
                    {uploadData.files.map((f, i) => (
                      <li key={i} style={{ marginBottom: '2px', wordBreak: 'break-all', color: '#6b7280' }}>
                        {f.name} <span style={{ color: '#9ca3af' }}>({formatSize(f.size)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Upload progress */}
            {isUploading && uploadProgress.total > 1 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                  <span>Uploading...</span>
                  <span>{uploadProgress.current} / {uploadProgress.total}</span>
                </div>
                <div style={{ height: '4px', background: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    background: '#6366f1',
                    borderRadius: '2px',
                    width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            )}

            <button
              type="submit"
              className={`btn-save ${isUploading ? 'saving' : ''}`}
              style={{ width: '100%', marginTop: '12px' }}
              disabled={isUploading || !uploadData.testName || !uploadData.files.length}
            >
              {isUploading
                ? `Uploading${uploadProgress.total > 1 ? ` (${uploadProgress.current}/${uploadProgress.total})` : '...'}`
                : `Upload Baseline${uploadData.files.length > 1 ? 's' : ''}`}
            </button>
          </form>
        </div>

        {/* Gallery Panel */}
        <div className="gallery-panel" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '18px', color: '#1f2937', margin: 0 }}>Existing Baselines</h3>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search baselines..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ width: '200px', height: '34px', fontSize: '13px' }}
              />
              <span style={{ fontSize: '14px', color: '#6b7280', background: '#f3f4f6', padding: '4px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                {filteredBaselines.length}{searchQuery ? ` / ${baselines.length}` : ''} total
              </span>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ width: '250px', height: '200px', borderRadius: '8px' }} />)}
            </div>
          ) : filteredBaselines.length === 0 ? (
            <div className="test-list-empty" style={{ padding: '60px 0', border: '1px dashed #d1d5db', borderRadius: '12px', background: '#f9fafb' }}>
              <span className="test-list-empty-icon">🖼️</span>
              <span>{searchQuery ? 'No matching baselines' : 'No baselines found'}</span>
              <span style={{ fontSize: '13px', color: '#9ca3af', marginTop: '8px' }}>
                {searchQuery ? 'Try a different search term' : 'Upload a reference image to get started'}
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {filteredBaselines.map(img => (
                <div
                  key={img.filename}
                  className="baseline-card"
                  style={{
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'box-shadow 0.2s, transform 0.2s'
                  }}
                  onMouseOver={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseOut={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                >
                  {/* Thumbnail area — clickable for preview */}
                  <div
                    onClick={() => setPreviewImage(img)}
                    style={{
                      height: '180px',
                      background: '#f8f9fa',
                      padding: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderBottom: '1px solid #e5e7eb',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                  >
                    <img
                      src={`/files/baselines/${img.filename}?t=${img.modified}`}
                      alt={img.filename}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                    />
                    {/* Hover overlay */}
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.03)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: 'opacity 0.2s'
                    }}
                      onMouseOver={e => e.currentTarget.style.opacity = 1}
                      onMouseOut={e => e.currentTarget.style.opacity = 0}
                    >
                      <span style={{
                        background: 'rgba(255,255,255,0.95)',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontWeight: '600',
                        color: '#4338ca',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}>
                        Click to preview
                      </span>
                    </div>
                  </div>

                  {/* Metadata area */}
                  <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '600', color: '#111827', fontSize: '15px', wordBreak: 'break-all', lineHeight: 1.3 }}>{img.testName}</div>
                        <div style={{ fontSize: '13px', color: '#6366f1', fontWeight: '500', marginTop: '4px' }}>@ {img.breakpoint}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(img.filename); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', transition: 'background 0.2s', filter: 'grayscale(1)' }}
                        onMouseOver={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.background = '#fee2e2'; }}
                        onMouseOut={e => { e.currentTarget.style.filter = 'grayscale(1)'; e.currentTarget.style.background = 'none'; }}
                        title="Delete baseline"
                      >
                        🗑️
                      </button>
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', paddingTop: '12px', borderTop: '1px dashed #e5e7eb' }}>
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
