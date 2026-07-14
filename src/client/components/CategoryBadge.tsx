import React from 'react';

export interface CategoryBadgeProps {
  name: string;
  color: string;
}

/**
 * Colored hashtag-style badge for displaying categories and tags.
 * Uses the provided color as both a subtle background tint and text color.
 */
export function CategoryBadge({ name, color }: CategoryBadgeProps) {
  const style: React.CSSProperties = {
    backgroundColor: hexToRgba(color, 0.15),
    color: color,
  };

  return (
    <span className="category-badge" style={style} aria-label={`Category: ${name}`}>
      <span className="category-badge-hash" aria-hidden="true">
        #
      </span>
      {name}
    </span>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  // Handle both 3 and 6 character hex codes
  const sanitized = hex.replace('#', '');
  let r: number, g: number, b: number;

  if (sanitized.length === 3) {
    r = parseInt(sanitized[0] + sanitized[0], 16);
    g = parseInt(sanitized[1] + sanitized[1], 16);
    b = parseInt(sanitized[2] + sanitized[2], 16);
  } else if (sanitized.length === 6) {
    r = parseInt(sanitized.slice(0, 2), 16);
    g = parseInt(sanitized.slice(2, 4), 16);
    b = parseInt(sanitized.slice(4, 6), 16);
  } else {
    // Fallback if color format is unexpected
    return `rgba(99, 102, 241, ${alpha})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
