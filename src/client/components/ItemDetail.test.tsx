import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ItemDetail, ItemDetailData } from './ItemDetail';

const mockItem: ItemDetailData = {
  id: 'item-1',
  title: 'Test Item Title',
  content: 'This is the full content of the item for testing purposes.',
  contentType: 'note',
  sourceDomain: 'example.com',
  createdAt: '2024-03-15T10:30:00Z',
  categories: [
    { name: 'Technology', confidence: 0.92, color: '#6366f1' },
    { name: 'AI', confidence: 0.75, color: '#22c55e' },
    { name: 'Low Confidence', confidence: 0.3, color: '#ef4444' },
  ],
  relatedItems: [
    {
      id: 'item-2',
      title: 'Related Item One',
      snippet: 'A short snippet of the related item content.',
      relationshipType: 'similar_topic',
    },
    {
      id: 'item-3',
      title: 'Related Item Two',
      snippet: 'Another related snippet.',
      relationshipType: 'references',
    },
  ],
};

describe('ItemDetail', () => {
  it('renders item title and content', () => {
    render(<ItemDetail item={mockItem} />);

    expect(screen.getByText('Test Item Title')).toBeInTheDocument();
    expect(
      screen.getByText('This is the full content of the item for testing purposes.')
    ).toBeInTheDocument();
  });

  it('renders content type, source domain, and date', () => {
    render(<ItemDetail item={mockItem} />);

    expect(screen.getByText('note')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    // Date is formatted, so check for presence of time element
    const timeEl = screen.getByRole('article').querySelector('time');
    expect(timeEl).toHaveAttribute('datetime', '2024-03-15T10:30:00Z');
  });

  it('renders all categories with confidence scores', () => {
    render(<ItemDetail item={mockItem} />);

    expect(screen.getByText('#Technology')).toBeInTheDocument();
    expect(screen.getByText('#AI')).toBeInTheDocument();
    expect(screen.getByText('#Low Confidence')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('applies correct confidence level classes', () => {
    render(<ItemDetail item={mockItem} />);

    const highConfidence = screen.getByText('92%');
    expect(highConfidence).toHaveClass('item-detail__confidence--high');

    const medConfidence = screen.getByText('75%');
    expect(medConfidence).toHaveClass('item-detail__confidence--medium');

    const lowConfidence = screen.getByText('30%');
    expect(lowConfidence).toHaveClass('item-detail__confidence--low');
  });

  it('renders related items with titles and relationship types', () => {
    render(<ItemDetail item={mockItem} />);

    expect(screen.getByText('Related Item One')).toBeInTheDocument();
    expect(screen.getByText('similar_topic')).toBeInTheDocument();
    expect(screen.getByText('Related Item Two')).toBeInTheDocument();
    expect(screen.getByText('references')).toBeInTheDocument();
  });

  it('calls onRelatedItemClick when a related item is clicked', async () => {
    const onRelatedItemClick = vi.fn();
    const user = userEvent.setup();
    render(<ItemDetail item={mockItem} onRelatedItemClick={onRelatedItemClick} />);

    await user.click(
      screen.getByRole('button', { name: /view related item: related item one/i })
    );

    expect(onRelatedItemClick).toHaveBeenCalledWith('item-2');
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ItemDetail item={mockItem} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close item detail/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render close button if onClose is not provided', () => {
    render(<ItemDetail item={mockItem} />);
    expect(screen.queryByRole('button', { name: /close item detail/i })).not.toBeInTheDocument();
  });

  it('handles item with no categories', () => {
    const itemNoCategories: ItemDetailData = {
      ...mockItem,
      categories: [],
    };
    render(<ItemDetail item={itemNoCategories} />);

    expect(screen.queryByText('Categories')).not.toBeInTheDocument();
  });

  it('handles item with no related items', () => {
    const itemNoRelated: ItemDetailData = {
      ...mockItem,
      relatedItems: [],
    };
    render(<ItemDetail item={itemNoRelated} />);

    expect(screen.queryByText('Related Items')).not.toBeInTheDocument();
  });

  it('has appropriate ARIA labels for accessibility', () => {
    render(<ItemDetail item={mockItem} />);

    expect(
      screen.getByRole('article', { name: /details for test item title/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/item content/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/assigned categories/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/related items/i)).toBeInTheDocument();
  });
});
