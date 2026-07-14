import React, { useState, useEffect, useCallback } from 'react';

interface FlaggedUser {
  id: string;
  email: string;
  status: 'active' | 'disabled' | 'flagged';
  flagReason?: string;
  flaggedAt?: string;
}

/**
 * Moderation panel for flagging/disabling accounts.
 * Admin can flag or disable users for policy violations
 * without viewing card content.
 * Satisfies requirement 17.9.
 */
export function ModerationPanel() {
  const [users, setUsers] = useState<FlaggedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moderatingUserId, setModeratingUserId] = useState<string | null>(null);
  const [moderationReason, setModerationReason] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const response = await fetch('/api/admin/users?status=flagged,active', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleModerate = async (userId: string, action: 'flag' | 'disable') => {
    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const response = await fetch(`/api/admin/moderate/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, reason: moderationReason }),
      });
      if (!response.ok) throw new Error(`Failed to ${action} user`);
      setModeratingUserId(null);
      setModerationReason('');
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Moderation action failed');
    }
  };

  if (loading) {
    return <div className="admin-loading">Loading moderation panel...</div>;
  }

  if (error && users.length === 0) {
    return (
      <div className="admin-error" role="alert">
        <p>{error}</p>
        <button onClick={fetchUsers}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-moderation-panel">
      <div className="admin-section-header">
        <h3>Account Moderation</h3>
      </div>

      {error && (
        <div className="admin-error-inline" role="alert">
          {error}
        </div>
      )}

      <table className="admin-table" aria-label="Moderation queue">
        <thead>
          <tr>
            <th>Email</th>
            <th>Status</th>
            <th>Flag Reason</th>
            <th>Flagged At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>
                <span className={`admin-status admin-status-${user.status}`}>
                  {user.status}
                </span>
              </td>
              <td>{user.flagReason || '—'}</td>
              <td>
                {user.flaggedAt ? new Date(user.flaggedAt).toLocaleDateString() : '—'}
              </td>
              <td className="admin-actions">
                {moderatingUserId === user.id ? (
                  <div className="admin-moderation-form">
                    <input
                      type="text"
                      placeholder="Reason for action"
                      value={moderationReason}
                      onChange={(e) => setModerationReason(e.target.value)}
                      aria-label="Moderation reason"
                    />
                    <button
                      className="admin-btn admin-btn-warn"
                      onClick={() => handleModerate(user.id, 'flag')}
                      disabled={!moderationReason.trim()}
                    >
                      Flag
                    </button>
                    <button
                      className="admin-btn admin-btn-danger"
                      onClick={() => handleModerate(user.id, 'disable')}
                      disabled={!moderationReason.trim()}
                    >
                      Disable
                    </button>
                    <button
                      className="admin-btn"
                      onClick={() => {
                        setModeratingUserId(null);
                        setModerationReason('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="admin-btn admin-btn-warn"
                    onClick={() => setModeratingUserId(user.id)}
                  >
                    Moderate
                  </button>
                )}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="admin-empty">
                No users in moderation queue.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
