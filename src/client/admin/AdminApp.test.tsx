import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminMfaGate } from './components/AdminMfaGate';
import { AdminLayout } from './components/AdminLayout';
import { MemoryRouter } from 'react-router-dom';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(() => 'mock-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

describe('AdminApp integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders MFA gate which blocks access to admin content', () => {
    render(
      <AdminMfaGate>
        <div>Admin Content</div>
      </AdminMfaGate>
    );
    expect(screen.getByText('Admin Access Verification')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('renders admin layout with navigation when given children', () => {
    render(
      <MemoryRouter initialEntries={['/users']}>
        <AdminLayout>
          <div>Page Content</div>
        </AdminLayout>
      </MemoryRouter>
    );
    expect(screen.getByText('Admin Console')).toBeInTheDocument();
    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('admin layout has all navigation sections accessible', () => {
    render(
      <MemoryRouter initialEntries={['/users']}>
        <AdminLayout>
          <div>Content</div>
        </AdminLayout>
      </MemoryRouter>
    );
    const nav = screen.getByLabelText('Admin navigation');
    expect(nav).toHaveTextContent('Users');
    expect(nav).toHaveTextContent('Metrics');
    expect(nav).toHaveTextContent('Plans');
    expect(nav).toHaveTextContent('Credentials');
    expect(nav).toHaveTextContent('Moderation');
    expect(nav).toHaveTextContent('Audit Log');
  });
});
