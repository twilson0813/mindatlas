import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsDashboard } from './MetricsDashboard';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const mockSystemMetrics = {
  totalUsers: 1234,
  activeUsersDaily: 256,
  activeUsersWeekly: 789,
  activeUsersMonthly: 1100,
  totalCards: 45000,
  apiRequestVolume: { last24h: 8500, last7d: 52000 },
  aiQueueDepth: 37,
  errorRates: { last24h: 5, last7d: 23 },
};

const mockSubscriptionMetrics = {
  freeCount: 900,
  proCount: 280,
  enterpriseCount: 54,
  mrr: 14500,
  churnRate: 0.032,
  upgradeCount30d: 45,
  downgradeCount30d: 18,
};

describe('MetricsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<MetricsDashboard />);
    expect(screen.getByText('Loading metrics...')).toBeInTheDocument();
  });

  it('displays system metrics after fetch', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockSystemMetrics })
      .mockResolvedValueOnce({ ok: true, json: async () => mockSubscriptionMetrics })
      // Handle interval refetch
      .mockResolvedValue({ ok: true, json: async () => mockSystemMetrics });

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('1234')).toBeInTheDocument();
      expect(screen.getByText('256')).toBeInTheDocument();
      expect(screen.getByText('45000')).toBeInTheDocument();
      expect(screen.getByText('37')).toBeInTheDocument();
    });
  });

  it('displays subscription metrics', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockSystemMetrics })
      .mockResolvedValueOnce({ ok: true, json: async () => mockSubscriptionMetrics })
      .mockResolvedValue({ ok: true, json: async () => mockSubscriptionMetrics });

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('900')).toBeInTheDocument();
      expect(screen.getByText('280')).toBeInTheDocument();
      expect(screen.getByText('54')).toBeInTheDocument();
      expect(screen.getByText('$14,500')).toBeInTheDocument();
      expect(screen.getByText('3.2%')).toBeInTheDocument();
    });
  });

  it('has accessible section headings', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => mockSystemMetrics })
      .mockResolvedValueOnce({ ok: true, json: async () => mockSubscriptionMetrics })
      .mockResolvedValue({ ok: true, json: async () => mockSystemMetrics });

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('System Metrics')).toBeInTheDocument();
      expect(screen.getByText('Subscription Metrics')).toBeInTheDocument();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    render(<MetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});
