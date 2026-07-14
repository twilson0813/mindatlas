import React from 'react';
import { ItemCard, Item } from './ItemCard';

export interface ItemGridProps {
  items: Item[];
  onItemClick?: (item: Item) => void;
}

/**
 * Responsive masonry-style grid layout for item cards.
 * Uses CSS columns for the masonry effect, adapting column count
 * based on viewport width (1 column on mobile up to 5 on ultra-wide).
 */
export function ItemGrid({ items, onItemClick }: ItemGridProps) {
  if (items.length === 0) {
    return (
      <div className="item-grid-empty" role="status">
        <p>No items yet. Start adding content to see it here.</p>
      </div>
    );
  }

  return (
    <div className="item-grid" role="list" aria-label="Items grid">
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <ItemCard item={item} onClick={onItemClick} />
        </div>
      ))}
    </div>
  );
}
