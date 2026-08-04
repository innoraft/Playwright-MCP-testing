import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function UserManagement() {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState([]);
  const [resetRequests, setResetRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [resetModal, setResetModal] = useState(null); // { userId, username }
  const [resetPassword, setResetPassword] = useState('');
  const [formData, setFormData] = useState({
    username: '', email: '', password: '', roles: ['authenticated']
  });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authFetch('/api/users');
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      setUsers(data);
    } catch {
      showToast('Could not load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [authFetch, showToast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchResetRequests = useCallback(async () => {
    try {
      const res = await authFetch('/api/users/reset-requests');
      if (res.ok) {
        const data = await res.json();
        setResetRequests(data);
      }
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => { fetchResetRequests(); }, [fetchResetRequests]);

  const resetForm = () => {
    setFormData({ username: '', email: '', password: '', roles: ['authenticated'] });
    setShowCreateForm(false);
    setEditingUser(null);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!formData.username.trim() || !formData.password.trim()) {
      showToast('Username and password are required', 'error');
      return;
    }
    try {
      const res = await authFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create user');
      }
      showToast('User created successfully');
      resetForm();
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const updates = {
        username: formData.username,
        email: formData.email,
        roles: formData.roles
      };
      if (formData.password.trim()) {
        updates.password = formData.password;
      }
      const res = await authFetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update user');
      }
      showToast('User updated successfully');
      resetForm();
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleActive = async (user) => {
    try {
      const res = await authFetch(`/api/users/${user.id}/toggle-active`, {
        method: 'PUT'
      });
      if (!res.ok) throw new Error('Failed to toggle user status');
      showToast(`User ${user.active ? 'deactivated' : 'activated'} successfully`);
      fetchUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const startEditing = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      password: '',
      roles: [...user.roles]
    });
    setShowCreateForm(false);
  };

  const toggleRole = (role) => {
    setFormData(prev => {
      const has = prev.roles.includes(role);
      return {
        ...prev,
        roles: has
          ? prev.roles.filter(r => r !== role)
          : [...prev.roles, role]
      };
    });
  };

  const handleAdminReset = async (e) => {
    e.preventDefault();
    if (!resetModal || !resetPassword.trim()) return;
    if (resetPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    try {
      const res = await authFetch(`/api/users/${resetModal.userId}/admin-reset`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPassword })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reset password');
      }
      showToast(`Password reset for ${resetModal.username}`);
      setResetModal(null);
      setResetPassword('');
      fetchResetRequests();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDismissReset = async (userId) => {
    try {
      await authFetch(`/api/users/${userId}/reset-request`, { method: 'DELETE' });
      showToast('Reset request dismissed');
      fetchResetRequests();
    } catch {
      showToast('Failed to dismiss', 'error');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">User Management</h1>
        <p className="page-subtitle">Create, edit, and manage user accounts and role assignments</p>
      </div>

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <span className="toast-icon">{toast.type === 'success' ? '✅' : '❌'}</span>
          {toast.message}
        </div>
      )}

      {/* Actions Bar */}
      <div className='row my-3'>
        <span className='col-4'>
          {users.length} user{users.length !== 1 ? 's' : ''} registered
        </span>
        <button
          className="btn-save col-4"
          onClick={() => {
            resetForm();
            setShowCreateForm(true);
          }}
        >
          + Create User
        </button>
      </div>

      {/* Password Reset Requests */}
      {resetRequests.length > 0 && (
        <div className="config-card um-reset-panel" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: 'var(--warning, #f59e0b)' }}>
            🔑 Password Reset Requests ({resetRequests.length})
          </h3>
          <div className="um-user-list">
            {resetRequests.map((req) => (
              <div key={req.id} className="um-user-row um-reset-row">
                <div className="um-user-info">
                  <div className="um-user-avatar" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                    {req.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="um-user-name">{req.username}</div>
                    <div className="um-user-email">
                      Requested {new Date(req.requestedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="um-user-actions">
                  <button
                    className="btn btn-sm btn-save"
                    onClick={() => { setResetModal({ userId: req.id, username: req.username }); setResetPassword(''); }}
                  >
                    🔒 Set New Password
                  </button>
                  <button
                    className="btn btn-secondary btn-danger"
                    onClick={() => handleDismissReset(req.id)}
                  >
                    ✕ Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin Reset Password Modal */}
      {resetModal && (
        <div className="um-modal-overlay" onClick={() => setResetModal(null)}>
          <div className="um-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>
              Reset Password: {resetModal.username}
            </h3>
            <form onSubmit={handleAdminReset}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Min. 6 characters"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoFocus
                  required
                  minLength={6}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button type="submit" className="btn btn-save">Set Password</button>
                <button type="button" className="btn btn-danger" onClick={() => setResetModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Form */}
      {(showCreateForm || editingUser) && (
        <div className="config-card" style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>
            {editingUser ? `Edit User: ${editingUser.username}` : 'Create New User'}
          </h3>
          <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="Enter username"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-input"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="user@example.com"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">
                Password {editingUser && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave blank to keep current)</span>}
              </label>
              <input
                type="password"
                className="form-input"
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder={editingUser ? 'Leave blank to keep current' : 'Min. 6 characters'}
                required={!editingUser}
                minLength={!editingUser ? 6 : undefined}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Roles</label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <label className="um-role-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.roles.includes('authenticated')}
                    onChange={() => toggleRole('authenticated')}
                  />
                  <span>Authenticated User</span>
                </label>
                <label className="um-role-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.roles.includes('admin')}
                    onChange={() => toggleRole('admin')}
                  />
                  <span>Site Admin</span>
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button type="submit" className="btn btn-save">
                {editingUser ? 'Save Changes' : 'Create User'}
              </button>
              <button type="button" className="btn btn-danger" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User List */}
      <div className="config-card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading users...</div>
        ) : users.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No users found</div>
        ) : (
          <div className="um-user-list">
            {users.map((u) => (
              <div key={u.id} className={`um-user-row ${!u.active ? 'um-user-inactive' : ''}`}>
                <div className="um-user-info">
                  <div className="um-user-avatar">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="um-user-name">
                      {u.username}
                      {!u.active && <span className="um-badge um-badge-inactive">Inactive</span>}
                    </div>
                    <div className="um-user-email">{u.email || 'No email'}</div>
                  </div>
                </div>
                <div className="um-user-roles">
                  {u.roles.map(r => (
                    <span key={r} className={`um-badge ${r === 'admin' ? 'um-badge-admin' : 'um-badge-auth'}`}>
                      {r === 'admin' ? '🛡️ Admin' : '👤 User'}
                    </span>
                  ))}
                </div>
                <div className="um-user-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEditing(u)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setResetModal({ userId: u.id, username: u.username }); setResetPassword(''); }}
                    title="Reset password"
                  >
                    🔑 Reset
                  </button>
                  <button
                    className={`btn btn-sm ${u.active ? 'btn-danger' : 'btn-primary'}`}
                    onClick={() => handleToggleActive(u)}
                  >
                    {u.active ? '🚫 Deactivate' : '✅ Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
