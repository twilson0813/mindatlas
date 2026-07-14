import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanManagement } from './PlanManagement';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const mockPlans = [
  {
    id: 'plan-1',
    name: 'Free',
    price: 0,
    billingInterval: 'monthly',
    storageLimit: 500,
    aiQueryLimit: 10,
    isActive: true,
  },
  {
    id: 'plan-2',
    name: 'Pro',
    price: 1999,
    billingInterval: 'monthly',
    storageLimit: 5000,
    aiQueryLimit: 100,
    isActive: true,
  },
];

const mockFeatures = [
  {
    key: 'input.sms',
    name: 'SMS Input',
    description: 'Receive items via SMS',
    category: 'input_channels',
  },
  {
    key: 'ai.categorization',
    name: 'AI Categorization',
    description: 'Automatic content categorization',
    category: 'ai_capabilities',
  },
];

describe('PlanManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<PlanManagement />);
    expect(screen.getByText('Loading plans...')).toBeInTheDocument();
  });

  it('displays plan cards after fetch', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plans: mockPlans }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: mockFeatures }) });

    render(<PlanManagement />);

    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
  });

  it('shows create plan button', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plans: mockPlans }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: mockFeatures }) });

    render(<PlanManagement />);

    await waitFor(() => {
      expect(screen.getByText('Create Plan')).toBeInTheDocument();
    });
  });

  it('shows create plan form on button click', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plans: mockPlans }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: mockFeatures }) });

    render(<PlanManagement />);

    await waitFor(() => {
      expect(screen.getByText('Create Plan')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Create Plan'));
    expect(screen.getByPlaceholderText('Plan name')).toBeInTheDocument();
  });

  it('shows feature entitlements when plan is selected', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plans: mockPlans }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: mockFeatures }) });

    render(<PlanManagement />);

    await waitFor(() => {
      expect(screen.getByText('Free')).toBeInTheDocument();
    });

    // Clicking a plan loads entitlements
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entitlements: { 'input.sms': false, 'ai.categorization': true } }),
    });

    fireEvent.click(screen.getByText('Free'));

    await waitFor(() => {
      expect(screen.getByText('SMS Input')).toBeInTheDocument();
      expect(screen.getByText('AI Categorization')).toBeInTheDocument();
    });
  });

  it('shows deactivate button for active plans', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plans: mockPlans }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: mockFeatures }) });

    render(<PlanManagement />);

    await waitFor(() => {
      const deactivateBtns = screen.getAllByText('Deactivate');
      expect(deactivateBtns.length).toBe(2);
    });
  });
});
