import React from 'react';

export interface PlanDetails {
  id: string;
  name: string;
  price: number; // monthly price in cents, 0 for free
  storage: string;
  aiQueries: string;
  features: string[];
}

export interface PlanSelectorProps {
  plans: PlanDetails[];
  currentPlanId: string;
  onUpgrade: (planId: string) => void;
  onDowngrade: (planId: string) => void;
  isLoading?: boolean;
}

const DEFAULT_PLANS: PlanDetails[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    storage: '500 MB',
    aiQueries: '10 / day',
    features: ['Unlimited Cards', 'Basic AI categorization', 'Web upload only'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 1999, // $19.99
    storage: '5 GB',
    aiQueries: '100 / day',
    features: [
      'Unlimited Cards',
      'Full AI categorization & mapping',
      'All input channels (API, SMS, Web, CSV)',
      'Notion integration',
      'Natural language AI queries',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 4999, // $49.99
    storage: '50 GB',
    aiQueries: 'Unlimited',
    features: [
      'Unlimited Cards',
      'Full AI suite (all capabilities)',
      'All input channels',
      'All integrations',
      'Priority AI processing',
      'Custom categories',
    ],
  },
];

/**
 * Plan comparison table showing Free, Pro, and Enterprise plans
 * with upgrade/downgrade action buttons.
 */
export function PlanSelector({
  plans = DEFAULT_PLANS,
  currentPlanId,
  onUpgrade,
  onDowngrade,
  isLoading = false,
}: PlanSelectorProps) {
  const currentPlanIndex = plans.findIndex((p) => p.id === currentPlanId);

  return (
    <div className="plan-selector" aria-label="Subscription plans">
      <h3 className="plan-selector__title">Choose Your Plan</h3>

      <div className="plan-selector__grid">
        {plans.map((plan, index) => {
          const isCurrent = plan.id === currentPlanId;
          const isUpgrade = index > currentPlanIndex;
          const isDowngrade = index < currentPlanIndex;

          return (
            <div
              key={plan.id}
              className={`plan-card ${isCurrent ? 'plan-card--current' : ''}`}
              aria-current={isCurrent ? 'true' : undefined}
            >
              {isCurrent && <span className="plan-card__badge">Current Plan</span>}

              <h4 className="plan-card__name">{plan.name}</h4>

              <div className="plan-card__price">
                {plan.price === 0 ? (
                  <span className="plan-card__price-amount">Free</span>
                ) : (
                  <>
                    <span className="plan-card__price-amount">
                      ${(plan.price / 100).toFixed(2)}
                    </span>
                    <span className="plan-card__price-period">/month</span>
                  </>
                )}
              </div>

              <div className="plan-card__limits">
                <div className="plan-card__limit-item">
                  <span className="plan-card__limit-label">Storage</span>
                  <span className="plan-card__limit-value">{plan.storage}</span>
                </div>
                <div className="plan-card__limit-item">
                  <span className="plan-card__limit-label">AI Queries</span>
                  <span className="plan-card__limit-value">{plan.aiQueries}</span>
                </div>
              </div>

              <ul className="plan-card__features">
                {plan.features.map((feature) => (
                  <li key={feature} className="plan-card__feature">
                    <span className="plan-card__feature-check" aria-hidden="true">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="plan-card__action">
                {isCurrent && (
                  <button className="btn-secondary" disabled>
                    Current Plan
                  </button>
                )}
                {isUpgrade && (
                  <button
                    className="btn-primary"
                    onClick={() => onUpgrade(plan.id)}
                    disabled={isLoading}
                    aria-label={`Upgrade to ${plan.name}`}
                  >
                    {isLoading ? 'Processing...' : `Upgrade to ${plan.name}`}
                  </button>
                )}
                {isDowngrade && (
                  <button
                    className="btn-secondary"
                    onClick={() => onDowngrade(plan.id)}
                    disabled={isLoading}
                    aria-label={`Downgrade to ${plan.name}`}
                  >
                    {isLoading ? 'Processing...' : `Downgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
