import { useState, useEffect, useCallback } from 'react';

export default function BaselineManager() {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [uploadData, setUploadData] = useState({ testName: '', breakpoint: '1280px', file: null });
  const [isUploading, setIsUploading] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Load baselines ────────────────────────────────────
  const fetchBaselines = useCallback(async () => {
    try {
      const res = await fetch('/api/baselines');
      if (!res.ok) throw new Error('Failed to load baselines');
      const data = await res.json();
      setBaselines(data);
    } catch {
      showToast('Could not load baseine images', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchBaselines();
  }, [fetchBaselines]);

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

  // ── Direct Upload ─────────────────────────────────────
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadData.file || !uploadData.testName) {
      showToast('Test name and file are required', 'error');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', uploadData.file);
      formData.append('testName', uploadData.testName);
      formData.append('breakpoint', uploadData.breakpoint);

      const res = await fetch('/api/baselines/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');
      
      showToast('Baseline uploaded successfully');
      setUploadData({ testName: '', breakpoint: '1280px', file: null });
      // Reset file input manually
      const fileInput = document.getElementById('baseline-file-upload');
      if (fileInput) fileInput.value = '';
      
      await fetchBaselines();
    } catch (err) {
      showToast('Failed to upload baseline', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // ── Delete ────────────────────────────────────────────
  const handleDelete = async (filename) => {
    try {
      const res = await fetch(`/api/baselines/${filename}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showToast('Baseline deleted');
      setDeleteConfirm(null);
      await fetchBaselines();
    } catch {
      showToast('Failed to delete baseline', 'error');
    }
  };

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

      {/* Delete Modal */}
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
              <label className="form-label">Test Name</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. Homepage Regression"
                value={uploadData.testName}
                onChange={e => setUploadData({...uploadData, testName: e.target.value})}
                required
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Breakpoint</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. 1280px"
                value={uploadData.breakpoint}
                onChange={e => setUploadData({...uploadData, breakpoint: e.target.value})}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Reference PNG</label>
              <div style={{ border: '2px dashed #d1d5db', padding: '20px', borderRadius: '8px', textAlign: 'center', background: '#f9fafb' }}>
                <input 
                  id="baseline-file-upload"
                  type="file" 
                  accept="image/png"
                  onChange={e => setUploadData({...uploadData, file: e.target.files[0]})}
                  required
                  style={{ maxWidth: '100%', fontSize: '13px' }}
                />
              </div>
            </div>

            <button 
              type="submit" 
              className={`btn-save ${isUploading ? 'saving' : ''}`}
              style={{ width: '100%', marginTop: '20px' }}
              disabled={isUploading || !uploadData.testName || !uploadData.file}
            >
              {isUploading ? 'Uploading...' : 'Upload Baseline'}
            </button>
          </form>
        </div>

        {/* Gallery Panel */}
        <div className="gallery-panel" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '18px', color: '#1f2937' }}>Existing Baselines</h3>
            <span style={{ fontSize: '14px', color: '#6b7280', background: '#f3f4f6', padding: '4px 12px', borderRadius: '20px' }}>
              {baselines.length} total
            </span>
          </div>

          {loading ? (
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ width: '250px', height: '200px', borderRadius: '8px' }} />)}
            </div>
          ) : baselines.length === 0 ? (
            <div className="test-list-empty" style={{ padding: '60px 0', border: '1px dashed #d1d5db', borderRadius: '12px', background: '#f9fafb' }}>
              <span className="test-list-empty-icon">🖼️</span>
              <span>No baselines found</span>
              <span style={{ fontSize: '13px', color: '#9ca3af', marginTop: '8px' }}>Upload a reference image to get started</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {baselines.map(img => (
                <div key={img.filename} className="baseline-card" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  
                  {/* Thumbnail area */}
                  <div style={{ height: '180px', background: '#f8f9fa', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
                    <img 
                      src={`/files/baselines/${img.filename}?t=${img.modified}`} 
                      alt={img.filename} 
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                    />
                  </div>

                  {/* Metadata area */}
                  <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '600', color: '#111827', fontSize: '15px', wordBreak: 'break-all', lineHeight: 1.3 }}>{img.testName}</div>
                        <div style={{ fontSize: '13px', color: '#6366f1', fontWeight: '500', marginTop: '4px' }}>@ {img.breakpoint}</div>
                      </div>
                      <button 
                        onClick={() => setDeleteConfirm(img.filename)}
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
