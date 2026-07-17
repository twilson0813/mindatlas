import React, { useState, useEffect, useCallback } from 'react';

interface SystemMetrics {
  totalUsers: number;
  activeUsersDaily: number;
  activeUsersWeekly: number;
  activeUsersMonthly: number;
  totalCards: number;
  apiRequestVolume: { last24h: number; last7d: number };
  aiQueueDepth: number;
  errorRates: { last24h: number; last7d: number };
}

interface SubscriptionMetrics {
  freeCount: number;
  proCount: number;
  enterpriseCount: number;
  mrr: number;
  churnRate: number;
  upgradeCount30d: number;
  downgradeCount30d: number;
}

/**
 * System and subscription metrics dashboard.
 * Displays real-time analytics: user counts, API volume,
 * queue depth, error rates, and subscription KPIs.
 * Satisfies requirements 17.5 and 18.10.
 */
export function MetricsDashboard() {
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [subscriptionMetrics, setSubscriptionMetrics] = useState<SubscriptionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('mindatlas_access_token');
      const headers = { Authorization: `Bearer ${token}` };

      const [systemRes, subRes] = await Promise.all([
        fetch('/api/admin/metrics', { headers }),
        fetch('/api/admin/metrics/subscriptions', { headers }),
      ]);

      if (!systemRes.ok || !subRes.ok) throw new Error('Failed to fetch metrics');

      const systemData = await systemRes.json();
      const subData = await subRes.json();

      setSystemMetrics(systemData);
      setSubscriptionMetrics(subData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    // Refresh metrics every 30 seconds
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (loading && !systemMetrics) {
    return <div className="admin-loading">Loading metrics...</div>;
  }

  if (error && !systemMetrics) {
    return (
      <div className="admin-error" role="alert">
        <p>{error}</p>
        <button onClick={fetchMetrics}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-metrics-dashboard">
      {/* System Metrics */}
      <section aria-labelledby="system-metrics-heading">
        <h3 id="system-metrics-heading">System Metrics</h3>
        <div className="admin-metrics-grid">
          <MetricCard label="Total Users" value={systemMetrics?.totalUsers ?? 0} />
          <MetricCard label="Daily Active" value={systemMetrics?.activeUsersDaily ?? 0} />
          <MetricCard label="Weekly Active" value={systemMetrics?.activeUsersWeekly ?? 0} />
          <MetricCard label="Monthly Active" value={systemMetrics?.activeUsersMonthly ?? 0} />
          <MetricCard label="Total Cards" value={systemMetrics?.totalCards ?? 0} />
          <MetricCard
            label="API Requests (24h)"
            value={systemMetrics?.apiRequestVolume.last24h ?? 0}
          />
          <MetricCard
            label="API Requests (7d)"
            value={systemMetrics?.apiRequestVolume.last7d ?? 0}
          />
          <MetricCard label="AI Queue Depth" value={systemMetrics?.aiQueueDepth ?? 0} />
          <MetricCard
            label="Errors (24h)"
            value={systemMetrics?.errorRates.last24h ?? 0}
            variant="warning"
          />
          <MetricCard
            label="Errors (7d)"
            value={systemMetrics?.errorRates.last7d ?? 0}
            variant="warning"
          />
        </div>
      </section>

      {/* Subscription Metrics */}
      <section aria-labelledby="subscription-metrics-heading">
        <h3 id="subscription-metrics-heading">Subscription Metrics</h3>
        <div className="admin-metrics-grid">
          <MetricCard label="Free Tier" value={subscriptionMetrics?.freeCount ?? 0} />
          <MetricCard label="Pro Tier" value={subscriptionMetrics?.proCount ?? 0} />
          <MetricCard label="Enterprise Tier" value={subscriptionMetrics?.enterpriseCount ?? 0} />
          <MetricCard label="MRR" value={`$${(subscriptionMetrics?.mrr ?? 0).toLocaleString()}`} />
          <MetricCard
            label="Churn Rate"
            value={`${((subscriptionMetrics?.churnRate ?? 0) * 100).toFixed(1)}%`}
            variant={
              subscriptionMetrics && subscriptionMetrics.churnRate > 0.05 ? 'warning' : 'default'
            }
          />
          <MetricCard label="Upgrades (30d)" value={subscriptionMetrics?.upgradeCount30d ?? 0} />
          <MetricCard
            label="Downgrades (30d)"
            value={subscriptionMetrics?.downgradeCount30d ?? 0}
          />
        </div>
      </section>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number | string;
  variant?: 'default' | 'warning';
}

function MetricCard({ label, value, variant = 'default' }: MetricCardProps) {
  return (
    <div className={`admin-metric-card ${variant === 'warning' ? 'admin-metric-warning' : ''}`}>
      <div className="admin-metric-label">{label}</div>
      <div className="admin-metric-value">{value}</div>
    </div>
  );
}
