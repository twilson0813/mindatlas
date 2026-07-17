import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ItemGrid } from './ItemGrid';
import { Item } from './ItemCard';

const mockItems: Item[] = [
  {
    id: 'item-1',
    title: 'First Item',
    snippet: 'First snippet',
    createdAt: new Date().toISOString(),
    contentType: 'plain_text',
    tags: [],
  },
  {
    id: 'item-2',
    title: 'Second Item',
    snippet: 'Second snippet',
    sourceDomain: 'test.com',
    createdAt: new Date().toISOString(),
    contentType: 'link',
    tags: [{ id: 'tag-1', name: 'web', color: '#3b82f6' }],
  },
  {
    id: 'item-3',
    title: 'Third Item',
    snippet: 'Third snippet',
    createdAt: new Date().toISOString(),
    contentType: 'note',
    tags: [],
  },
];

describe('ItemGrid', () => {
  it('renders all items in the grid', () => {
    render(<ItemGrid items={mockItems} />);

    expect(screen.getByText('First Item')).toBeInTheDocument();
    expect(screen.getByText('Second Item')).toBeInTheDocument();
    expect(screen.getByText('Third Item')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(<ItemGrid items={[]} />);

    expect(
      screen.getByText('No items yet. Start adding content to see it here.'),
    ).toBeInTheDocument();
  });

  it('has list role for accessibility', () => {
    render(<ItemGrid items={mockItems} />);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('passes onItemClick through to cards', () => {
    const handleClick = vi.fn();
    render(<ItemGrid items={mockItems} onItemClick={handleClick} />);

    fireEvent.click(screen.getByText('Second Item'));
    expect(handleClick).toHaveBeenCalledWith(mockItems[1]);
  });

  it('renders grid with correct aria-label', () => {
    render(<ItemGrid items={mockItems} />);

    expect(screen.getByLabelText('Items grid')).toBeInTheDocument();
  });
});
