import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Dashboard, DashboardStats } from './Dashboard';
import { Item } from './ItemCard';

// Mock the AuthContext
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'test@example.com' },
    logout: vi.fn(),
  }),
}));

const mockStats: DashboardStats = {
  totalItems: 12,
  activeMaps: 3,
  totalTags: 8,
  recentActivity: 5,
};

const mockItems: Item[] = [
  {
    id: 'item-1',
    title: 'First Item',
    snippet: 'This is the first item snippet',
    sourceDomain: 'example.com',
    createdAt: new Date().toISOString(),
    contentType: 'plain_text',
    tags: [
      { id: 'tag-1', name: 'javascript', color: '#f7df1e' },
      { id: 'tag-2', name: 'tutorial', color: '#22c55e' },
    ],
  },
  {
    id: 'item-2',
    title: 'Second Item',
    snippet: 'This is the second item snippet with more content to show',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    contentType: 'link',
    tags: [{ id: 'tag-3', name: 'design', color: '#6366f1' }],
  },
];

describe('Dashboard', () => {
  it('renders sidebar navigation with all sections', () => {
    render(<Dashboard items={[]} stats={mockStats} />);

    expect(screen.getByText('MindAtlas')).toBeInTheDocument();
    // "Dashboard" appears in both nav and topbar, so use getAllByText
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Items')).toBeInTheDocument();
    expect(screen.getByText('Maps')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Integrations')).toBeInTheDocument();
  });

  it('displays summary statistics', () => {
    render(<Dashboard items={mockItems} stats={mockStats} />);

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Total Items')).toBeInTheDocument();
    expect(screen.getByText('Active Maps')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
  });

  it('displays recent items heading on dashboard section', () => {
    render(<Dashboard items={mockItems} stats={mockStats} />);

    expect(screen.getByText('Recent Items')).toBeInTheDocument();
  });

  it('renders item cards in the grid', () => {
    render(<Dashboard items={mockItems} stats={mockStats} />);

    expect(screen.getByText('First Item')).toBeInTheDocument();
    expect(screen.getByText('Second Item')).toBeInTheDocument();
  });

  it('shows user email in sidebar footer', () => {
    render(<Dashboard items={mockItems} stats={mockStats} />);

    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('navigates between sections on sidebar click', () => {
    render(<Dashboard items={mockItems} stats={mockStats} />);

    // Click on Items nav
    fireEvent.click(screen.getByText('Items'));
    expect(screen.getByText('All Items')).toBeInTheDocument();

    // Click on Maps nav
    fireEvent.click(screen.getByText('Maps'));
    expect(screen.getByText('Maps will be displayed here.')).toBeInTheDocument();
  });

  it('calls onItemClick when an item card is clicked', () => {
    const handleClick = vi.fn();
    render(<Dashboard items={mockItems} stats={mockStats} onItemClick={handleClick} />);

    fireEvent.click(screen.getByText('First Item'));
    expect(handleClick).toHaveBeenCalledWith(mockItems[0]);
  });

  it('shows empty state when no items', () => {
    render(<Dashboard items={[]} stats={mockStats} />);

    expect(screen.getByText('No items yet. Start adding content to see it here.')).toBeInTheDocument();
  });

  it('has accessible sidebar navigation landmark', () => {
    render(<Dashboard items={[]} stats={mockStats} />);

    expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
  });
});
