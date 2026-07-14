import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';

function renderWithRouter(ui: React.ReactElement, { route = '/users' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
    </MemoryRouter>
  );
}

describe('AdminLayout', () => {
  it('renders the admin console title', () => {
    renderWithRouter(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    expect(screen.getByText('Admin Console')).toBeInTheDocument();
  });

  it('renders all navigation items', () => {
    renderWithRouter(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    const nav = screen.getByLabelText('Admin navigation');
    expect(nav).toHaveTextContent('Users');
    expect(nav).toHaveTextContent('Metrics');
    expect(nav).toHaveTextContent('Plans');
    expect(nav).toHaveTextContent('Moderation');
    expect(nav).toHaveTextContent('Audit Log');
  });

  it('renders children in the content area', () => {
    renderWithRouter(
      <AdminLayout>
        <div>Test Content Area</div>
      </AdminLayout>
    );
    expect(screen.getByText('Test Content Area')).toBeInTheDocument();
  });

  it('has accessible admin navigation landmark', () => {
    renderWithRouter(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    expect(screen.getByLabelText('Admin navigation')).toBeInTheDocument();
  });

  it('shows back to dashboard link', () => {
    renderWithRouter(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    const backLink = screen.getByText('← Back to Dashboard');
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/');
  });

  it('shows mobile toggle button', () => {
    renderWithRouter(
      <AdminLayout>
        <div>Content</div>
      </AdminLayout>
    );
    const toggle = screen.getByLabelText('Toggle admin navigation');
    expect(toggle).toBeInTheDocument();
  });
});
