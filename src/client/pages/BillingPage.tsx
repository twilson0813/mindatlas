import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { PlanSelector, PlanDetails } from '../components/PlanSelector';
import { UsageMeter, UsageData } from '../components/UsageMeter';

interface Subscription {
  planId: string;
  planName: string;
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

interface PaymentHistoryEntry {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  description: string;
}

/**
 * Billing management page with current plan display, usage meters,
 * plan comparison/selection, payment history, and cancel option.
 */
export function BillingPage() {
  const { user, logout } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryEntry[]>([]);
  const [plans, setPlans] = useState<PlanDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('mindatlas_access_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, []);

  useEffect(() => {
    async function fetchBillingData() {
      try {
        const headers = getAuthHeaders();

        const [subRes, usageRes, historyRes] = await Promise.allSettled([
          fetch('/api/billing/subscription', { headers }),
          fetch('/api/billing/usage', { headers }),
          fetch('/api/billing/history', { headers }),
        ]);

        if (subRes.status === 'fulfilled' && subRes.value.ok) {
          const data = await subRes.value.json();
          setSubscription(data.subscription);
          if (data.plans) {
            setPlans(data.plans);
          }
        }

        if (usageRes.status === 'fulfilled' && usageRes.value.ok) {
          const data = await usageRes.value.json();
          setUsage(data.usage);
        }

        if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
          const data = await historyRes.value.json();
          setPaymentHistory(data.payments || []);
        }
      } catch {
        setError('Failed to load billing information. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchBillingData();
  }, [getAuthHeaders]);

  const handleUpgrade = useCallback(
    async (planId: string) => {
      setActionLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const headers = getAuthHeaders();
        const response = await fetch('/api/billing/upgrade', {
          method: 'POST',
          headers,
          body: JSON.stringify({ planId }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Upgrade failed');
        }

        const data = await response.json();

        // If Stripe checkout URL is returned, redirect to it
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }

        setSubscription(data.subscription);
        setSuccessMessage(`Successfully upgraded to ${data.subscription?.planName || planId}!`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upgrade failed. Please try again.');
      } finally {
        setActionLoading(false);
      }
    },
    [getAuthHeaders],
  );

  const handleDowngrade = useCallback(
    async (planId: string) => {
      setActionLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const headers = getAuthHeaders();
        const response = await fetch('/api/billing/downgrade', {
          method: 'POST',
          headers,
          body: JSON.stringify({ planId }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Downgrade failed');
        }

        const data = await response.json();
        setSubscription(data.subscription);
        setSuccessMessage(
          `Plan will downgrade to ${data.subscription?.planName || planId} at the end of your billing period.`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Downgrade failed. Please try again.');
      } finally {
        setActionLoading(false);
      }
    },
    [getAuthHeaders],
  );

  const handleCancel = useCallback(async () => {
    if (
      !window.confirm(
        'Are you sure you want to cancel your subscription? You will retain access until the end of your current billing period.',
      )
    ) {
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const headers = getAuthHeaders();
      const response = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Cancellation failed');
      }

      const data = await response.json();
      setSubscription(data.subscription);
      setSuccessMessage(
        'Subscription canceled. You will retain access until the end of your billing period.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancellation failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }, [getAuthHeaders]);

  if (isLoading) {
    return (
      <div className="billing-page">
        <div className="loading-screen" aria-label="Loading billing information">
          <p>Loading billing information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="billing-page">
      <header className="billing-page__header">
        <div className="billing-page__header-left">
          <a href="/" className="billing-page__back">
            ← Back to Dashboard
          </a>
          <h1>Billing & Subscription</h1>
        </div>
        <div className="billing-page__header-right">
          <span className="user-email">{user?.email}</span>
          <button className="btn-secondary" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="billing-page__content">
        {error && (
          <div className="billing-alert billing-alert--error" role="alert">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="billing-alert billing-alert--success" role="status">
            {successMessage}
          </div>
        )}

        {/* Current Plan Summary */}
        <section className="billing-section" aria-labelledby="current-plan-heading">
          <h2 id="current-plan-heading">Current Plan</h2>
          {subscription ? (
            <div className="billing-current-plan">
              <div className="billing-current-plan__info">
                <span className="billing-current-plan__name">{subscription.planName}</span>
                <span
                  className={`billing-current-plan__status billing-current-plan__status--${subscription.status}`}
                >
                  {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && 'Active'}
                  {subscription.status === 'active' &&
                    subscription.cancelAtPeriodEnd &&
                    'Cancels at period end'}
                  {subscription.status === 'canceled' && 'Canceled'}
                  {subscription.status === 'past_due' && 'Past Due'}
                  {subscription.status === 'trialing' && 'Trial'}
                </span>
              </div>
              {subscription.currentPeriodEnd && (
                <p className="billing-current-plan__period">
                  Current period ends:{' '}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
              {subscription.status === 'active' &&
                !subscription.cancelAtPeriodEnd &&
                subscription.planId !== 'free' && (
                  <button
                    className="btn-danger"
                    onClick={handleCancel}
                    disabled={actionLoading}
                    aria-label="Cancel subscription"
                  >
                    {actionLoading ? 'Processing...' : 'Cancel Subscription'}
                  </button>
                )}
            </div>
          ) : (
            <p className="text-muted">No active subscription. Choose a plan below.</p>
          )}
        </section>

        {/* Usage Meters */}
        {usage && (
          <section className="billing-section" aria-labelledby="usage-heading">
            <h2 id="usage-heading" className="visually-hidden">
              Usage
            </h2>
            <UsageMeter usage={usage} />
          </section>
        )}

        {/* Plan Comparison */}
        <section className="billing-section" aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="visually-hidden">
            Plans
          </h2>
          <PlanSelector
            plans={plans.length > 0 ? plans : undefined!}
            currentPlanId={subscription?.planId || 'free'}
            onUpgrade={handleUpgrade}
            onDowngrade={handleDowngrade}
            isLoading={actionLoading}
          />
        </section>

        {/* Payment History */}
        <section className="billing-section" aria-labelledby="history-heading">
          <h2 id="history-heading">Payment History</h2>
          {paymentHistory.length > 0 ? (
            <div className="billing-history">
              <table className="billing-history__table" aria-label="Payment history">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistory.map((payment) => (
                    <tr key={payment.id}>
                      <td>{new Date(payment.createdAt).toLocaleDateString()}</td>
                      <td>{payment.description}</td>
                      <td>{formatCurrency(payment.amount, payment.currency)}</td>
                      <td>
                        <span
                          className={`billing-history__status billing-history__status--${payment.status}`}
                        >
                          {payment.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No payment history yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function formatCurrency(amountInCents: number, currency: string = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountInCents / 100);
}
