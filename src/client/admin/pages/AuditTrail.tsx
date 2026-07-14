import React, { useState, useEffect, useCallback } from 'react';

interface AuditEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetUserId?: string;
  targetEmail?: string;
  details: string;
  timestamp: string;
}

interface AuditFilters {
  action: string;
  adminEmail: string;
  startDate: string;
  endDate: string;
}

/**
 * Audit trail viewer with filterable admin action log.
 * Shows all administrative actions: account changes,
 * plan modifications, moderation actions.
 * Satisfies requirement 17.10.
 */
export function AuditTrail() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>({
    action: '',
    adminEmail: '',
    startDate: '',
    endDate: '',
  });

  const fetchAuditLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const params = new URLSearchParams();
      if (filters.action) params.set('action', filters.action);
      if (filters.adminEmail) params.set('adminEmail', filters.adminEmail);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);

      const response = await fetch(`/api/admin/audit?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch audit log');
      const data = await response.json();
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAuditLog();
  }, [fetchAuditLog]);

  const handleFilterChange = (field: keyof AuditFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  if (loading && entries.length === 0) {
    return <div className="admin-loading">Loading audit log...</div>;
  }

  if (error && entries.length === 0) {
    return (
      <div className="admin-error" role="alert">
        <p>{error}</p>
        <button onClick={fetchAuditLog}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-audit-trail">
      <div className="admin-section-header">
        <h3>Audit Trail</h3>
      </div>

      {/* Filters */}
      <div className="admin-audit-filters" aria-label="Audit log filters">
        <select
          value={filters.action}
          onChange={(e) => handleFilterChange('action', e.target.value)}
          aria-label="Filter by action"
        >
          <option value="">All Actions</option>
          <option value="disable_account">Disable Account</option>
          <option value="delete_account">Delete Account</option>
          <option value="unlock_account">Unlock Account</option>
          <option value="create_plan">Create Plan</option>
          <option value="update_plan">Update Plan</option>
          <option value="deactivate_plan">Deactivate Plan</option>
          <option value="update_entitlements">Update Entitlements</option>
          <option value="moderate_account">Moderate Account</option>
        </select>
        <input
          type="text"
          placeholder="Admin email"
          value={filters.adminEmail}
          onChange={(e) => handleFilterChange('adminEmail', e.target.value)}
          aria-label="Filter by admin email"
        />
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => handleFilterChange('startDate', e.target.value)}
          aria-label="Start date"
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => handleFilterChange('endDate', e.target.value)}
          aria-label="End date"
        />
      </div>

      {error && (
        <div className="admin-error-inline" role="alert">
          {error}
        </div>
      )}

      {/* Audit Table */}
      <table className="admin-table" aria-label="Audit log entries">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Admin</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.timestamp).toLocaleString()}</td>
              <td>{entry.adminEmail}</td>
              <td>
                <span className="admin-badge">{formatAction(entry.action)}</span>
              </td>
              <td>{entry.targetEmail || '—'}</td>
              <td className="admin-audit-details">{entry.details}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="admin-empty">
                No audit entries found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatAction(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
