import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CategoryBadge } from './CategoryBadge';

describe('CategoryBadge', () => {
  it('renders the category name', () => {
    render(<CategoryBadge name="javascript" color="#f7df1e" />);

    expect(screen.getByText('javascript')).toBeInTheDocument();
  });

  it('renders hashtag prefix', () => {
    render(<CategoryBadge name="design" color="#6366f1" />);

    expect(screen.getByText('#')).toBeInTheDocument();
  });

  it('applies color as text color', () => {
    render(<CategoryBadge name="react" color="#61dafb" />);

    const badge = screen.getByLabelText('Category: react');
    expect(badge).toHaveStyle({ color: '#61dafb' });
  });

  it('applies background color with alpha transparency', () => {
    render(<CategoryBadge name="node" color="#339933" />);

    const badge = screen.getByLabelText('Category: node');
    expect(badge).toHaveStyle({ backgroundColor: 'rgba(51, 153, 51, 0.15)' });
  });

  it('handles 3-character hex colors', () => {
    render(<CategoryBadge name="short" color="#f00" />);

    const badge = screen.getByLabelText('Category: short');
    expect(badge).toHaveStyle({ color: '#f00' });
    expect(badge).toHaveStyle({ backgroundColor: 'rgba(255, 0, 0, 0.15)' });
  });

  it('has accessible aria-label', () => {
    render(<CategoryBadge name="testing" color="#22c55e" />);

    expect(screen.getByLabelText('Category: testing')).toBeInTheDocument();
  });
});
