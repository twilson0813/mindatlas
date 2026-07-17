import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ItemCard, Item } from './ItemCard';

const baseItem: Item = {
  id: 'item-1',
  title: 'Test Article',
  snippet: 'This is a test snippet for the item card component',
  sourceDomain: 'blog.example.com',
  createdAt: new Date().toISOString(),
  contentType: 'link',
  tags: [
    { id: 'tag-1', name: 'react', color: '#61dafb' },
    { id: 'tag-2', name: 'typescript', color: '#3178c6' },
  ],
};

describe('ItemCard', () => {
  it('renders title, snippet, and source domain', () => {
    render(<ItemCard item={baseItem} />);

    expect(screen.getByText('Test Article')).toBeInTheDocument();
    expect(
      screen.getByText('This is a test snippet for the item card component'),
    ).toBeInTheDocument();
    expect(screen.getByText('blog.example.com')).toBeInTheDocument();
  });

  it('renders category badges for all tags', () => {
    render(<ItemCard item={baseItem} />);

    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('renders timestamp', () => {
    render(<ItemCard item={baseItem} />);

    // "just now" or "Xm ago" depending on exact timing
    const timeEl = screen.getByRole('button').querySelector('time');
    expect(timeEl).toBeInTheDocument();
    expect(timeEl?.getAttribute('datetime')).toBe(baseItem.createdAt);
  });

  it('renders thumbnail when provided', () => {
    const itemWithThumb: Item = {
      ...baseItem,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };
    render(<ItemCard item={itemWithThumb} />);

    const img = screen.getByAltText('Thumbnail for Test Article');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
  });

  it('does not render thumbnail when not provided', () => {
    const itemNoThumb: Item = { ...baseItem, thumbnailUrl: undefined };
    render(<ItemCard item={itemNoThumb} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const handleClick = vi.fn();
    render(<ItemCard item={baseItem} onClick={handleClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledWith(baseItem);
  });

  it('calls onClick on Enter keypress', () => {
    const handleClick = vi.fn();
    render(<ItemCard item={baseItem} onClick={handleClick} />);

    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(handleClick).toHaveBeenCalledWith(baseItem);
  });

  it('renders without tags section when no tags', () => {
    const itemNoTags: Item = { ...baseItem, tags: [] };
    render(<ItemCard item={itemNoTags} />);

    expect(screen.queryByText('#')).not.toBeInTheDocument();
  });

  it('has accessible aria-label', () => {
    render(<ItemCard item={baseItem} />);

    expect(screen.getByLabelText('Item: Test Article')).toBeInTheDocument();
  });
});
