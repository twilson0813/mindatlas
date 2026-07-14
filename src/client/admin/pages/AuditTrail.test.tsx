import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditTrail } from './AuditTrail';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const mockEntries = [
  {
    id: 'audit-1',
    adminId: 'admin-1',
    adminEmail: 'admin@example.com',
    action: 'disable_account',
    targetUserId: 'user-1',
    targetEmail: 'alice@example.com',
    details: 'Account disabled for policy violation',
    timestamp: '2024-06-15T10:30:00Z',
  },
  {
    id: 'audit-2',
    adminId: 'admin-1',
    adminEmail: 'admin@example.com',
    action: 'create_plan',
    details: 'Created new plan: Enterprise Plus',
    timestamp: '2024-06-14T09:00:00Z',
  },
];

describe('AuditTrail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<AuditTrail />);
    expect(screen.getByText('Loading audit log...')).toBeInTheDocument();
  });

  it('displays audit entries after fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: mockEntries }),
    });

    render(<AuditTrail />);

    await waitFor(() => {
      expect(screen.getAllByText('admin@example.com').length).toBe(2);
      // Check that action badges are rendered in the table body
      expect(screen.getByText('Account disabled for policy violation')).toBeInTheDocument();
      expect(screen.getByText('Created new plan: Enterprise Plus')).toBeInTheDocument();
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  it('shows filter controls', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: mockEntries }),
    });

    render(<AuditTrail />);

    await waitFor(() => {
      expect(screen.getByLabelText('Filter by action')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by admin email')).toBeInTheDocument();
      expect(screen.getByLabelText('Start date')).toBeInTheDocument();
      expect(screen.getByLabelText('End date')).toBeInTheDocument();
    });
  });

  it('has accessible table label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: mockEntries }),
    });

    render(<AuditTrail />);

    await waitFor(() => {
      expect(screen.getByLabelText('Audit log entries')).toBeInTheDocument();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    render(<AuditTrail />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows empty state when no entries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [] }),
    });

    render(<AuditTrail />);

    await waitFor(() => {
      expect(screen.getByText('No audit entries found.')).toBeInTheDocument();
    });
  });
});
