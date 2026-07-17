import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminMfaGate } from './AdminMfaGate';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-access-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

describe('AdminMfaGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders MFA verification form initially', () => {
    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );
    expect(screen.getByText('Admin Access Verification')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('disables submit button when code is less than 6 digits', () => {
    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );
    const input = screen.getByLabelText('Authentication Code');
    fireEvent.change(input, { target: { value: '123' } });
    expect(screen.getByRole('button', { name: 'Verify Access' })).toBeDisabled();
  });

  it('enables submit button when code is exactly 6 digits', () => {
    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );
    const input = screen.getByLabelText('Authentication Code');
    fireEvent.change(input, { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: 'Verify Access' })).not.toBeDisabled();
  });

  it('only allows numeric input', () => {
    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );
    const input = screen.getByLabelText('Authentication Code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc123def456' } });
    expect(input.value).toBe('123456');
  });

  it('shows children after successful verification', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true }),
    });

    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );

    const input = screen.getByLabelText('Authentication Code');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Access' }));

    await waitFor(() => {
      expect(screen.getByText('Admin Content')).toBeInTheDocument();
    });
  });

  it('shows error message on failed verification', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Invalid MFA code' }),
    });

    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );

    const input = screen.getByLabelText('Authentication Code');
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Access' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid MFA code');
    });
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('sends authorization header with stored token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ verified: true }),
    });

    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>,
    );

    const input = screen.getByLabelText('Authentication Code');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify Access' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/verify-mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-access-token',
        },
        body: JSON.stringify({ code: '123456' }),
      });
    });
  });
});
