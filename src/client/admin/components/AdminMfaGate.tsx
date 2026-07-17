import React, { useState, useCallback } from 'react';

interface AdminMfaGateProps {
  children: React.ReactNode;
}

/**
 * MFA verification gate for admin console access.
 * Requires a valid TOTP code before rendering admin content.
 * Corresponds to requirement 17.12 — elevated session verification.
 */
export function AdminMfaGate({ children }: AdminMfaGateProps) {
  const [verified, setVerified] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);

      try {
        const token = localStorage.getItem('mindatlas_access_token');
        const response = await fetch('/api/admin/verify-mfa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code: mfaCode }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'MFA verification failed');
        }

        setVerified(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Verification failed');
      } finally {
        setLoading(false);
      }
    },
    [mfaCode],
  );

  if (verified) {
    return <>{children}</>;
  }

  return (
    <div className="admin-mfa-gate">
      <div className="admin-mfa-card">
        <h2>Admin Access Verification</h2>
        <p>Enter your multi-factor authentication code to access the admin console.</p>

        <form onSubmit={handleVerify} aria-label="MFA verification form">
          <div className="admin-mfa-input-group">
            <label htmlFor="mfa-code">Authentication Code</label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={loading}
              aria-describedby={error ? 'mfa-error' : undefined}
            />
          </div>

          {error && (
            <div id="mfa-error" className="admin-mfa-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="admin-mfa-submit"
            disabled={loading || mfaCode.length !== 6}
          >
            {loading ? 'Verifying...' : 'Verify Access'}
          </button>
        </form>
      </div>
    </div>
  );
}
