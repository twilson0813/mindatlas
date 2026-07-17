import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserManagement } from './UserManagement';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

const mockUsers = [
  {
    id: 'user-1',
    email: 'alice@example.com',
    registrationDate: '2024-01-15T00:00:00Z',
    subscriptionTier: 'Pro',
    status: 'active',
  },
  {
    id: 'user-2',
    email: 'bob@example.com',
    registrationDate: '2024-03-01T00:00:00Z',
    subscriptionTier: 'Free',
    status: 'locked',
  },
];

describe('UserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<UserManagement />);
    expect(screen.getByText('Loading users...')).toBeInTheDocument();
  });

  it('displays user list after fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ users: mockUsers }),
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
  });

  it('shows user count', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ users: mockUsers }),
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('2 users')).toBeInTheDocument();
    });
  });

  it('shows disable button for active users', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ users: mockUsers }),
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });
  });

  it('shows unlock button for locked users', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ users: mockUsers }),
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('Unlock')).toBeInTheDocument();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('has accessible table with proper label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ users: mockUsers }),
    });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByLabelText('User accounts')).toBeInTheDocument();
    });
  });

  it('calls disable endpoint when disable is clicked', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: mockUsers }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [] }) });

    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Disable'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/users/user-1/disable',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
