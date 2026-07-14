import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingPage } from './BillingPage';

// Mock the AuthContext
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@example.com' },
    logout: vi.fn(),
  }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockSuccessfulFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/billing/subscription')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            subscription: {
              planId: 'pro',
              planName: 'Pro',
              status: 'active',
              currentPeriodEnd: '2025-02-15T00:00:00Z',
              cancelAtPeriodEnd: false,
            },
            plans: [
              {
                id: 'free',
                name: 'Free',
                price: 0,
                storage: '500 MB',
                aiQueries: '10 / day',
                features: ['Unlimited Cards'],
              },
              {
                id: 'pro',
                name: 'Pro',
                price: 1999,
                storage: '5 GB',
                aiQueries: '100 / day',
                features: ['Unlimited Cards', 'All input channels'],
              },
              {
                id: 'enterprise',
                name: 'Enterprise',
                price: 4999,
                storage: '50 GB',
                aiQueries: 'Unlimited',
                features: ['Unlimited Cards', 'Priority processing'],
              },
            ],
          }),
      });
    }
    if (url.includes('/api/billing/usage')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            usage: {
              storageUsedBytes: 1024 * 1024 * 200,
              storageLimitBytes: 1024 * 1024 * 1024 * 5,
              aiQueriesUsed: 30,
              aiQueriesLimit: 100,
            },
          }),
      });
    }
    if (url.includes('/api/billing/history')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            payments: [
              {
                id: 'pay-1',
                amount: 1999,
                currency: 'usd',
                status: 'succeeded',
                createdAt: '2025-01-15T00:00:00Z',
                description: 'Pro subscription',
              },
            ],
          }),
      });
    }
    return Promise.resolve({ ok: false });
  });
}

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<BillingPage />);

    expect(screen.getByText('Loading billing information...')).toBeInTheDocument();
  });

  it('renders current plan information after loading', async () => {
    mockSuccessfulFetch();
    render(<BillingPage />);

    await waitFor(() => {
      // "Current Plan" appears in section heading, plan badge, and disabled button
      expect(screen.getAllByText('Current Plan').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders usage meters after loading', async () => {
    mockSuccessfulFetch();
    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Current Usage')).toBeInTheDocument();
    });

    expect(screen.getByText('30 / 100')).toBeInTheDocument();
  });

  it('renders payment history table', async () => {
    mockSuccessfulFetch();
    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Pro subscription')).toBeInTheDocument();
    });

    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('renders plan selector with plans', async () => {
    mockSuccessfulFetch();
    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Choose Your Plan')).toBeInTheDocument();
    });
  });

  it('displays page header with title and navigation', async () => {
    mockSuccessfulFetch();
    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Billing & Subscription')).toBeInTheDocument();
    });

    expect(screen.getByText('← Back to Dashboard')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('shows cancel button for active paid subscription', async () => {
    mockSuccessfulFetch();
    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Cancel subscription')).toBeInTheDocument();
    });
  });

  it('shows empty payment history message when no payments', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/billing/subscription')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              subscription: {
                planId: 'free',
                planName: 'Free',
                status: 'active',
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
              },
            }),
        });
      }
      if (url.includes('/api/billing/usage')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              usage: {
                storageUsedBytes: 0,
                storageLimitBytes: 500 * 1024 * 1024,
                aiQueriesUsed: 0,
                aiQueriesLimit: 10,
              },
            }),
        });
      }
      if (url.includes('/api/billing/history')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ payments: [] }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(<BillingPage />);

    await waitFor(() => {
      expect(screen.getByText('No payment history yet.')).toBeInTheDocument();
    });
  });
});
