import React from 'react';
import { CategoryBadge } from './CategoryBadge';

export interface ItemTag {
  id: string;
  name: string;
  color: string;
  confidence?: number;
}

export interface Item {
  id: string;
  title: string;
  snippet: string;
  sourceDomain?: string;
  thumbnailUrl?: string;
  createdAt: string;
  contentType: string;
  tags: ItemTag[];
}

export interface ItemCardProps {
  item: Item;
  onClick?: (item: Item) => void;
}

/**
 * Card component displaying an item's thumbnail, title, snippet,
 * source domain, timestamp, and category/tag badges.
 */
export function ItemCard({ item, onClick }: ItemCardProps) {
  const handleClick = () => {
    onClick?.(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(item);
    }
  };

  return (
    <article
      className="item-card"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Item: ${item.title}`}
    >
      {item.thumbnailUrl && (
        <img
          className="item-card-thumbnail"
          src={item.thumbnailUrl}
          alt={`Thumbnail for ${item.title}`}
          loading="lazy"
        />
      )}
      <div className="item-card-body">
        <h3 className="item-card-title">{item.title}</h3>
        <p className="item-card-snippet">{item.snippet}</p>
        <div className="item-card-meta">
          {item.sourceDomain && <span className="item-card-source">{item.sourceDomain}</span>}
          <time className="item-card-timestamp" dateTime={item.createdAt}>
            {formatTimestamp(item.createdAt)}
          </time>
        </div>
        {item.tags.length > 0 && (
          <div className="item-card-tags">
            {item.tags.map((tag) => (
              <CategoryBadge key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}
