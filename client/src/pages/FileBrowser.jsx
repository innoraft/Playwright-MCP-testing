import { useState, useEffect, useCallback, useMemo } from 'react';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

// File type icon mapping
function getFileIcon(item) {
  if (item.type === 'folder') return '📁';
  const ext = item.extension || '';
  if (IMAGE_EXTENSIONS.includes(ext)) return '🖼️';
  if (['yml', 'yaml'].includes(ext)) return '📄';
  if (['json'].includes(ext)) return '📋';
  if (['html'].includes(ext)) return '🌐';
  if (['css'].includes(ext)) return '🎨';
  if (['js'].includes(ext)) return '📦';
  if (['txt'].includes(ext)) return '📝';
  return '📎';
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function FileBrowser() {
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [toast, setToast] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState({ totalFiles: 0, totalFolders: 0 });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Fetch directory contents ──────────────────────────
  const fetchDirectory = useCallback(async (folder = '') => {
    setLoading(true);
    setSearchQuery('');
    try {
      const url = folder
        ? `/api/files/browse?folder=${encodeURIComponent(folder)}`
        : '/api/files/browse';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to browse directory');
      const data = await res.json();
      setItems(data.items);
      setBreadcrumbs(data.breadcrumbs);
      setCurrentPath(data.currentPath);
      setStats({ totalFiles: data.totalFiles, totalFolders: data.totalFolders });
    } catch {
      showToast('Could not load directory', 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchDirectory('');
  }, [fetchDirectory]);

  // ── Navigate to folder ────────────────────────────────
  const navigateToFolder = useCallback((folderPath) => {
    setSelectedFile(null);
    setPreviewUrl(null);
    fetchDirectory(folderPath);
  }, [fetchDirectory]);

  // ── Select a file for preview ─────────────────────────
  const selectFile = useCallback((item) => {
    if (item.type === 'folder') {
      navigateToFolder(item.path);
      return;
    }
    setSelectedFile(item);
    const isImage = IMAGE_EXTENSIONS.includes(item.extension);
    if (isImage) {
      setPreviewUrl(`/api/files/preview/${item.path}`);
    } else {
      setPreviewUrl(null);
    }
  }, [navigateToFolder]);

  // ── Delete file ───────────────────────────────────────
  const deleteFile = useCallback(async (filePath) => {
    try {
      const res = await fetch(`/api/files/delete/${filePath}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      showToast('File deleted successfully');
      // Clear preview if deleted file was previewed
      if (selectedFile && selectedFile.path === filePath) {
        setSelectedFile(null);
        setPreviewUrl(null);
      }
      fetchDirectory(currentPath);
    } catch {
      showToast('Could not delete file', 'error');
    } finally {
      setDeleteConfirm(null);
    }
  }, [currentPath, fetchDirectory, selectedFile, showToast]);

  // ── Filtered items ────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [items, searchQuery]);

  return (
    <div className="page-container" style={{ maxWidth: '1200px' }}>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Files & Assets</h1>
        <p className="page-subtitle">
          Browse and manage test screenshots, baselines, and diff images
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span className="toast-icon">{toast.type === 'success' ? '✅' : '❌'}</span>
          {toast.message}
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">🗑️</div>
            <h3>Delete File</h3>
            <p>Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              This action cannot be undone.
            </p>
            <div className="confirm-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => deleteFile(deleteConfirm.path)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout: File List + Preview */}
      <div className="fb-layout">
        {/* File List Panel */}
        <div className="fb-list-panel">
          {/* Breadcrumbs */}
          <div className="fb-breadcrumbs">
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb.path} className="fb-breadcrumb-item">
                {idx > 0 && <span className="fb-breadcrumb-sep">/</span>}
                <button
                  className={`fb-breadcrumb-btn ${idx === breadcrumbs.length - 1 ? 'active' : ''}`}
                  onClick={() => navigateToFolder(crumb.path)}
                >
                  {idx === 0 ? '🏠' : ''} {crumb.name}
                </button>
              </span>
            ))}
          </div>

          {/* Search + Stats */}
          <div className="fb-controls">
            <input
              type="text"
              className="fb-search-input"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="fb-stats">
              <span className="fb-stat">{stats.totalFolders} folders</span>
              <span className="fb-stat">{stats.totalFiles} files</span>
            </div>
          </div>

          {/* File List */}
          <div className="fb-file-list">
            {loading ? (
              <div className="fb-empty">
                <div className="fb-empty-icon">⏳</div>
                <p>Loading...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="fb-empty">
                <div className="fb-empty-icon">📂</div>
                <p>{searchQuery ? 'No matching files' : 'This folder is empty'}</p>
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.path}
                  className={`fb-file-item ${selectedFile?.path === item.path ? 'active' : ''} ${item.type === 'folder' ? 'fb-folder-item' : ''}`}
                  onClick={() => selectFile(item)}
                >
                  <div className="fb-file-item-info">
                    <span className="fb-file-icon">{getFileIcon(item)}</span>
                    <div className="fb-file-details">
                      <span className="fb-file-name">{item.name}</span>
                      {item.type === 'file' && (
                        <div className="fb-file-meta">
                          <span className="fb-file-size">{formatSize(item.sizeBytes)}</span>
                          <span className="fb-file-date">{formatDate(item.modified)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {item.type === 'file' && (
                    <button
                      className="fb-delete-btn"
                      title="Delete file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(item);
                      }}
                    >
                      🗑️
                    </button>
                  )}
                  {item.type === 'folder' && (
                    <span className="fb-folder-arrow">›</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Preview Panel */}
        <div className="fb-preview-panel">
          {selectedFile ? (
            <div className="fb-preview-content">
              <div className="fb-preview-header">
                <div className="fb-preview-title">
                  <span className="fb-preview-icon">{getFileIcon(selectedFile)}</span>
                  <div>
                    <h3>{selectedFile.name}</h3>
                    <span className="fb-preview-size">{formatSize(selectedFile.sizeBytes)}</span>
                  </div>
                </div>
                <div className="fb-preview-actions">
                  <a
                    className="btn btn-secondary btn-sm"
                    href={`/api/files/preview/${selectedFile.path}`}
                    download={selectedFile.name}
                    title="Download"
                  >
                    ⬇️ Download
                  </a>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setDeleteConfirm(selectedFile)}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
              <div className="fb-preview-body">
                {previewUrl && IMAGE_EXTENSIONS.includes(selectedFile.extension) ? (
                  <div className="fb-image-preview">
                    <img
                      src={previewUrl}
                      alt={selectedFile.name}
                      className="fb-preview-image"
                    />
                  </div>
                ) : (
                  <div className="fb-preview-fallback">
                    <div className="fb-preview-fallback-icon">{getFileIcon(selectedFile)}</div>
                    <h3>{selectedFile.name}</h3>
                    <p>Preview not available for .{selectedFile.extension} files</p>
                    <a
                      className="btn btn-primary btn-sm"
                      href={`/api/files/preview/${selectedFile.path}`}
                      download={selectedFile.name}
                    >
                      ⬇️ Download File
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="fb-preview-empty">
              <div className="fb-preview-empty-icon">👁️</div>
              <h3>No File Selected</h3>
              <p>Click a file to preview it here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
