import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlanSelector, PlanDetails } from './PlanSelector';

const mockPlans: PlanDetails[] = [
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
    price: 1999,
    storage: '5 GB',
    aiQueries: '100 / day',
    features: ['Unlimited Cards', 'Full AI categorization & mapping', 'All input channels'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 4999,
    storage: '50 GB',
    aiQueries: 'Unlimited',
    features: ['Unlimited Cards', 'Full AI suite', 'Priority AI processing'],
  },
];

describe('PlanSelector', () => {
  it('renders all three plans', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    // "Free" appears in both plan name and price, so use getAllByText
    expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('shows "Current Plan" badge on active plan', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="pro"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    // Badge and disabled button both say "Current Plan"
    expect(screen.getAllByText('Current Plan').length).toBeGreaterThanOrEqual(1);
  });

  it('shows upgrade buttons for higher plans', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Upgrade to Pro')).toBeInTheDocument();
    expect(screen.getByLabelText('Upgrade to Enterprise')).toBeInTheDocument();
  });

  it('shows downgrade buttons for lower plans', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="enterprise"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Downgrade to Free')).toBeInTheDocument();
    expect(screen.getByLabelText('Downgrade to Pro')).toBeInTheDocument();
  });

  it('calls onUpgrade with plan id when upgrade button clicked', () => {
    const onUpgrade = vi.fn();
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={onUpgrade}
        onDowngrade={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Upgrade to Pro'));
    expect(onUpgrade).toHaveBeenCalledWith('pro');
  });

  it('calls onDowngrade with plan id when downgrade button clicked', () => {
    const onDowngrade = vi.fn();
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="enterprise"
        onUpgrade={vi.fn()}
        onDowngrade={onDowngrade}
      />,
    );

    fireEvent.click(screen.getByLabelText('Downgrade to Pro'));
    expect(onDowngrade).toHaveBeenCalledWith('pro');
  });

  it('displays price formatting correctly', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    expect(screen.getByText('$19.99')).toBeInTheDocument();
    expect(screen.getByText('$49.99')).toBeInTheDocument();
  });

  it('displays plan features', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    expect(screen.getByText('Basic AI categorization')).toBeInTheDocument();
    expect(screen.getByText('Full AI categorization & mapping')).toBeInTheDocument();
    expect(screen.getByText('Priority AI processing')).toBeInTheDocument();
  });

  it('disables buttons when isLoading is true', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
        isLoading={true}
      />,
    );

    const upgradeButtons = screen.getAllByText('Processing...');
    upgradeButtons.forEach((btn) => {
      expect(btn.closest('button')).toBeDisabled();
    });
  });

  it('has accessible plan section', () => {
    render(
      <PlanSelector
        plans={mockPlans}
        currentPlanId="free"
        onUpgrade={vi.fn()}
        onDowngrade={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Subscription plans')).toBeInTheDocument();
  });
});
