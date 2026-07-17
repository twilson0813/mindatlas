import React, { useState, useEffect, useCallback } from 'react';

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  billingInterval: 'monthly' | 'yearly';
  storageLimit: number;
  aiQueryLimit: number;
  isActive: boolean;
}

interface FeatureRegistryEntry {
  key: string;
  name: string;
  description: string;
  category: string;
}

interface PlanEntitlements {
  [featureKey: string]: boolean;
}

/**
 * Plan management page with feature entitlement editor.
 * Allows creating, modifying, deactivating plans and
 * toggling feature entitlements per plan.
 * Satisfies requirements 17.6, 17.7, 17.8.
 */
export function PlanManagement() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [features, setFeatures] = useState<FeatureRegistryEntry[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<PlanEntitlements>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const token = localStorage.getItem('mindatlas_access_token');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plansRes, featuresRes] = await Promise.all([
        fetch('/api/admin/plans', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/features', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!plansRes.ok || !featuresRes.ok) throw new Error('Failed to fetch data');
      const plansData = await plansRes.json();
      const featuresData = await featuresRes.json();
      setPlans(plansData.plans || []);
      setFeatures(featuresData.features || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchEntitlements = useCallback(
    async (planId: string) => {
      try {
        const response = await fetch(`/api/admin/plans/${planId}/entitlements`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to fetch entitlements');
        const data = await response.json();
        setEntitlements(data.entitlements || {});
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entitlements');
      }
    },
    [token],
  );

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    if (selectedPlanId) {
      fetchEntitlements(selectedPlanId);
    }
  }, [selectedPlanId, fetchEntitlements]);

  const handleToggleFeature = async (featureKey: string, enabled: boolean) => {
    if (!selectedPlanId) return;
    const updated = { ...entitlements, [featureKey]: enabled };
    setEntitlements(updated);

    try {
      const response = await fetch(`/api/admin/plans/${selectedPlanId}/entitlements`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ entitlements: updated }),
      });
      if (!response.ok) throw new Error('Failed to update entitlements');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entitlements');
      // Revert on failure
      fetchEntitlements(selectedPlanId);
    }
  };

  const handleDeactivatePlan = async (planId: string) => {
    try {
      const response = await fetch(`/api/admin/plans/${planId}/deactivate`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to deactivate plan');
      await fetchPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate plan');
    }
  };

  const handleCreatePlan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newPlan = {
      name: formData.get('name') as string,
      price: Number(formData.get('price')),
      billingInterval: formData.get('billingInterval') as string,
      storageLimit: Number(formData.get('storageLimit')),
      aiQueryLimit: Number(formData.get('aiQueryLimit')),
    };

    try {
      const response = await fetch('/api/admin/plans', {
        method: 'POST',
        headers,
        body: JSON.stringify(newPlan),
      });
      if (!response.ok) throw new Error('Failed to create plan');
      setShowCreateForm(false);
      await fetchPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan');
    }
  };

  if (loading) {
    return <div className="admin-loading">Loading plans...</div>;
  }

  if (error && plans.length === 0) {
    return (
      <div className="admin-error" role="alert">
        <p>{error}</p>
        <button onClick={fetchPlans}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-plan-management">
      {/* Plan List */}
      <section aria-labelledby="plans-heading">
        <div className="admin-section-header">
          <h3 id="plans-heading">Subscription Plans</h3>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowCreateForm(true)}>
            Create Plan
          </button>
        </div>

        {error && (
          <div className="admin-error-inline" role="alert">
            {error}
          </div>
        )}

        {showCreateForm && (
          <form className="admin-create-plan-form" onSubmit={handleCreatePlan}>
            <input name="name" placeholder="Plan name" required />
            <input name="price" type="number" placeholder="Price (cents)" required />
            <select name="billingInterval" required>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <input name="storageLimit" type="number" placeholder="Storage MB" required />
            <input name="aiQueryLimit" type="number" placeholder="AI queries/day" required />
            <div className="admin-form-actions">
              <button type="submit" className="admin-btn admin-btn-primary">
                Create
              </button>
              <button type="button" className="admin-btn" onClick={() => setShowCreateForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="admin-plan-list">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`admin-plan-card ${selectedPlanId === plan.id ? 'selected' : ''} ${!plan.isActive ? 'inactive' : ''}`}
              onClick={() => setSelectedPlanId(plan.id)}
              role="button"
              tabIndex={0}
              aria-pressed={selectedPlanId === plan.id}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelectedPlanId(plan.id);
              }}
            >
              <div className="admin-plan-card-header">
                <span className="admin-plan-name">{plan.name}</span>
                {!plan.isActive && <span className="admin-badge-inactive">Inactive</span>}
              </div>
              <div className="admin-plan-card-details">
                <span>
                  ${(plan.price / 100).toFixed(2)}/{plan.billingInterval}
                </span>
                <span>{plan.storageLimit} MB storage</span>
                <span>{plan.aiQueryLimit === -1 ? 'Unlimited' : plan.aiQueryLimit} AI queries</span>
              </div>
              {plan.isActive && (
                <button
                  className="admin-btn admin-btn-warn admin-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeactivatePlan(plan.id);
                  }}
                >
                  Deactivate
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Feature Entitlement Editor */}
      {selectedPlanId && (
        <FeatureEntitlementEditor
          planName={plans.find((p) => p.id === selectedPlanId)?.name || ''}
          features={features}
          entitlements={entitlements}
          onToggle={handleToggleFeature}
        />
      )}
    </div>
  );
}

interface FeatureEntitlementEditorProps {
  planName: string;
  features: FeatureRegistryEntry[];
  entitlements: PlanEntitlements;
  onToggle: (featureKey: string, enabled: boolean) => void;
}

/**
 * Feature entitlement editor — toggle features on/off for a plan.
 * Satisfies requirement 17.7 — feature entitlement configuration.
 */
function FeatureEntitlementEditor({
  planName,
  features,
  entitlements,
  onToggle,
}: FeatureEntitlementEditorProps) {
  // Group features by category
  const grouped = features.reduce<Record<string, FeatureRegistryEntry[]>>((acc, feature) => {
    if (!acc[feature.category]) acc[feature.category] = [];
    acc[feature.category].push(feature);
    return acc;
  }, {});

  return (
    <section className="admin-entitlement-editor" aria-labelledby="entitlements-heading">
      <h3 id="entitlements-heading">Feature Entitlements — {planName}</h3>

      {Object.entries(grouped).map(([category, categoryFeatures]) => (
        <div key={category} className="admin-entitlement-group">
          <h4>{formatCategory(category)}</h4>
          <div className="admin-entitlement-list">
            {categoryFeatures.map((feature) => (
              <label key={feature.key} className="admin-entitlement-toggle">
                <input
                  type="checkbox"
                  checked={entitlements[feature.key] ?? false}
                  onChange={(e) => onToggle(feature.key, e.target.checked)}
                />
                <div className="admin-entitlement-info">
                  <span className="admin-entitlement-name">{feature.name}</span>
                  <span className="admin-entitlement-desc">{feature.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function formatCategory(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
