import React from 'react';
import '../styles/detail.css';

interface CategoryWithConfidence {
  name: string;
  confidence: number;
  color?: string;
}

interface RelatedItem {
  id: string;
  title: string;
  snippet: string;
  relationshipType: string;
}

export interface ItemDetailData {
  id: string;
  title: string;
  content: string;
  contentType: string;
  sourceDomain?: string;
  createdAt: string;
  categories: CategoryWithConfidence[];
  relatedItems: RelatedItem[];
}

interface ItemDetailProps {
  item: ItemDetailData;
  onClose?: () => void;
  onRelatedItemClick?: (itemId: string) => void;
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getConfidenceLevel(score: number): string {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

export function ItemDetail({ item, onClose, onRelatedItemClick }: ItemDetailProps) {
  return (
    <article className="item-detail" aria-label={`Details for ${item.title}`}>
      <header className="item-detail__header">
        <div className="item-detail__title-row">
          <h2 className="item-detail__title">{item.title}</h2>
          {onClose && (
            <button className="item-detail__close" onClick={onClose} aria-label="Close item detail">
              ✕
            </button>
          )}
        </div>
        <div className="item-detail__meta">
          <span className="item-detail__type">{item.contentType}</span>
          {item.sourceDomain && <span className="item-detail__source">{item.sourceDomain}</span>}
          <time className="item-detail__date" dateTime={item.createdAt}>
            {formatDate(item.createdAt)}
          </time>
        </div>
      </header>

      <section className="item-detail__content" aria-label="Item content">
        <p>{item.content}</p>
      </section>

      {item.categories.length > 0 && (
        <section className="item-detail__categories" aria-label="Assigned categories">
          <h3 className="item-detail__section-title">Categories</h3>
          <ul className="item-detail__category-list">
            {item.categories.map((cat) => (
              <li key={cat.name} className="item-detail__category-item">
                <span
                  className="item-detail__category-badge"
                  style={{ borderColor: cat.color || 'var(--color-accent)' }}
                >
                  #{cat.name}
                </span>
                <span
                  className={`item-detail__confidence item-detail__confidence--${getConfidenceLevel(cat.confidence)}`}
                  title={`Confidence: ${formatConfidence(cat.confidence)}`}
                >
                  {formatConfidence(cat.confidence)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.relatedItems.length > 0 && (
        <section className="item-detail__related" aria-label="Related items">
          <h3 className="item-detail__section-title">Related Items</h3>
          <ul className="item-detail__related-list">
            {item.relatedItems.map((related) => (
              <li key={related.id} className="item-detail__related-item">
                <button
                  className="item-detail__related-button"
                  onClick={() => onRelatedItemClick?.(related.id)}
                  aria-label={`View related item: ${related.title}`}
                >
                  <span className="item-detail__related-title">{related.title}</span>
                  <span className="item-detail__related-type">{related.relationshipType}</span>
                  <span className="item-detail__related-snippet">{related.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
