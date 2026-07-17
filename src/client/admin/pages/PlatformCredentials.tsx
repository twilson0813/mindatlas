import React, { useState, useEffect, useCallback } from 'react';

interface ProviderStatus {
  configured: boolean;
  updatedAt: string | null;
}

interface CredentialStatusResponse {
  providers: Record<string, ProviderStatus>;
}

interface ProviderFieldConfig {
  key: string;
  label: string;
  type: string;
  placeholder: string;
}

interface ProviderConfig {
  name: string;
  displayName: string;
  description: string;
  fields: ProviderFieldConfig[];
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    name: 'openai',
    displayName: 'OpenAI',
    description: 'AI-powered features including item categorization and mapping.',
    fields: [{ key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' }],
  },
  {
    name: 'twilio',
    displayName: 'Twilio',
    description: 'SMS messaging for notifications and item capture.',
    fields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', placeholder: 'AC...' },
      { key: 'authToken', label: 'Auth Token', type: 'password', placeholder: 'Auth token' },
      { key: 'phoneNumber', label: 'Phone Number', type: 'text', placeholder: '+1234567890' },
    ],
  },
  {
    name: 'stripe',
    displayName: 'Stripe',
    description: 'Payment processing for subscriptions.',
    fields: [
      { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_...' },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...' },
    ],
  },
];

/**
 * Platform Credentials management page for the admin console.
 * Allows admins with entitlements.manage permission to configure
 * API credentials for OpenAI, Twilio, and Stripe providers.
 * Credentials are stored encrypted in the database.
 * Satisfies requirements 2.1–2.8.
 */
export default function PlatformCredentials() {
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const response = await fetch('/api/admin/credentials/status', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 403) {
        setPermissionDenied(true);
        return;
      }

      if (!response.ok) throw new Error('Failed to fetch credential status');

      const data: CredentialStatusResponse = await response.json();
      setProviderStatus(data.providers || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credential status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (permissionDenied) {
    return (
      <div className="admin-error" role="alert">
        <p>You do not have permission to manage platform credentials.</p>
        <p>
          The <code>entitlements.manage</code> permission is required.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="admin-loading">Loading credential status...</div>;
  }

  if (error) {
    return (
      <div className="admin-error" role="alert">
        <p>{error}</p>
        <button onClick={fetchStatus}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-platform-credentials">
      <div className="admin-section-header">
        <h3>Platform Credentials</h3>
        <span className="admin-count">
          {Object.values(providerStatus).filter((s) => s.configured).length} of{' '}
          {PROVIDER_CONFIGS.length} configured
        </span>
      </div>

      {PROVIDER_CONFIGS.map((provider) => (
        <ProviderCredentialSection
          key={provider.name}
          config={provider}
          status={providerStatus[provider.name]}
          onSaved={fetchStatus}
        />
      ))}
    </div>
  );
}

interface ProviderCredentialSectionProps {
  config: ProviderConfig;
  status: ProviderStatus | undefined;
  onSaved: () => void;
}

function ProviderCredentialSection({ config, status, onSaved }: ProviderCredentialSectionProps) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isConfigured = status?.configured ?? false;

  const handleFieldChange = (fieldKey: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [fieldKey]: value }));
    setSuccessMessage(null);
    setSaveError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const response = await fetch(`/api/admin/credentials/${config.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formValues),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save ${config.displayName} credentials`);
      }

      setSuccessMessage(`${config.displayName} credentials saved successfully.`);
      setFormValues({});
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const hasValues = config.fields.some((field) => formValues[field.key]?.trim());

  return (
    <section className="admin-credential-section" aria-labelledby={`${config.name}-heading`}>
      <div className="admin-credential-section-header">
        <div>
          <h4 id={`${config.name}-heading`}>{config.displayName}</h4>
          <p className="admin-credential-description">{config.description}</p>
        </div>
        <span
          className={`admin-status ${isConfigured ? 'admin-status-active' : 'admin-status-disabled'}`}
        >
          {isConfigured ? 'Configured' : 'Not configured'}
        </span>
      </div>

      {isConfigured && status?.updatedAt && (
        <p className="admin-credential-updated">
          Last updated: {new Date(status.updatedAt).toLocaleString()}
        </p>
      )}

      <form onSubmit={handleSubmit} aria-label={`${config.displayName} credentials form`}>
        <div className="admin-credential-fields">
          {config.fields.map((field) => (
            <div key={field.key} className="admin-credential-field">
              <label htmlFor={`${config.name}-${field.key}`}>{field.label}</label>
              <input
                id={`${config.name}-${field.key}`}
                type={field.type}
                value={formValues[field.key] || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                placeholder={isConfigured ? '••••••••configured' : field.placeholder}
                autoComplete="off"
                disabled={saving}
              />
            </div>
          ))}
        </div>

        {saveError && (
          <div className="admin-error-inline" role="alert">
            {saveError}
          </div>
        )}

        {successMessage && (
          <div className="admin-success-inline" role="status" aria-live="polite">
            {successMessage}
          </div>
        )}

        <div className="admin-form-actions">
          <button
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={saving || !hasValues}
          >
            {saving ? 'Saving...' : isConfigured ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </div>
      </form>
    </section>
  );
}
