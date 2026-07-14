import React, { useState, useEffect, useCallback } from 'react';

interface AdminUser {
  id: string;
  email: string;
  registrationDate: string;
  subscriptionTier: string;
  status: 'active' | 'disabled' | 'locked' | 'deleted';
}

/**
 * User management page for the admin console.
 * Allows viewing user accounts and performing admin actions
 * (disable, delete, unlock) without accessing card content.
 * Satisfies requirement 17.2 — no card content exposure.
 */
export function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const response = await fetch('/api/admin/users', {
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

  const performAction = useCallback(
    async (userId: string, action: 'disable' | 'delete' | 'unlock') => {
      setActionLoading(`${userId}-${action}`);
      try {
        const token = localStorage.getItem('mindatlas_access_token');
        const response = await fetch(`/api/admin/users/${userId}/${action}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason: `Admin ${action} action` }),
        });
        if (!response.ok) throw new Error(`Failed to ${action} user`);
        await fetchUsers();
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${action} user`);
      } finally {
        setActionLoading(null);
      }
    },
    [fetchUsers]
  );

  if (loading) {
    return <div className="admin-loading">Loading users...</div>;
  }

  if (error) {
    return (
      <div className="admin-error" role="alert">
        <p>{error}</p>
        <button onClick={fetchUsers}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-user-management">
      <div className="admin-section-header">
        <h3>User Accounts</h3>
        <span className="admin-count">{users.length} users</span>
      </div>

      <table className="admin-table" aria-label="User accounts">
        <thead>
          <tr>
            <th>Email</th>
            <th>Registration Date</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{new Date(user.registrationDate).toLocaleDateString()}</td>
              <td>
                <span className="admin-badge">{user.subscriptionTier}</span>
              </td>
              <td>
                <span className={`admin-status admin-status-${user.status}`}>
                  {user.status}
                </span>
              </td>
              <td className="admin-actions">
                {user.status === 'active' && (
                  <button
                    className="admin-btn admin-btn-warn"
                    onClick={() => performAction(user.id, 'disable')}
                    disabled={actionLoading === `${user.id}-disable`}
                  >
                    Disable
                  </button>
                )}
                {user.status === 'locked' && (
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={() => performAction(user.id, 'unlock')}
                    disabled={actionLoading === `${user.id}-unlock`}
                  >
                    Unlock
                  </button>
                )}
                <button
                  className="admin-btn admin-btn-danger"
                  onClick={() => performAction(user.id, 'delete')}
                  disabled={actionLoading === `${user.id}-delete`}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="admin-empty">
                No users found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
