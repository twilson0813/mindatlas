import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

// Mock react-force-graph-2d to avoid canvas/WebGL dependencies in jsdom
vi.mock('react-force-graph-2d', () => ({
  default: null,
}));

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

import { MapViewer, MapData } from './MapViewer';

const mockMap: MapData = {
  nodes: [
    { id: 'node-1', label: 'First Item', category: 'Tech', color: '#6366f1' },
    { id: 'node-2', label: 'Second Item', category: 'Science', color: '#22c55e' },
    { id: 'node-3', label: 'Third Item', category: 'Tech' },
  ],
  edges: [
    { source: 'node-1', target: 'node-2', relationshipType: 'similar', strength: 0.8 },
    { source: 'node-2', target: 'node-3', relationshipType: 'references', strength: 0.5 },
  ],
};

describe('MapViewer', () => {
  it('renders empty state when no nodes exist', () => {
    const emptyMap: MapData = { nodes: [], edges: [] };
    render(<MapViewer map={emptyMap} />);

    expect(screen.getByText(/no items to display/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /empty map visualization/i })).toBeInTheDocument();
  });

  it('renders node count and connection count in static fallback', () => {
    render(<MapViewer map={mockMap} />);

    expect(screen.getByText('3 nodes, 2 connections')).toBeInTheDocument();
  });

  it('renders all nodes as clickable items in static fallback', () => {
    render(<MapViewer map={mockMap} />);

    expect(screen.getByRole('button', { name: /view item: first item/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view item: second item/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view item: third item/i })).toBeInTheDocument();
  });

  it('calls onNodeClick when a node is clicked', async () => {
    const onNodeClick = vi.fn();
    const user = userEvent.setup();
    render(<MapViewer map={mockMap} onNodeClick={onNodeClick} />);

    await user.click(screen.getByRole('button', { name: /view item: first item/i }));
    expect(onNodeClick).toHaveBeenCalledWith('node-1');
  });

  it('has appropriate ARIA label with node and edge counts', () => {
    render(<MapViewer map={mockMap} />);

    expect(
      screen.getByRole('img', { name: /knowledge map with 3 items and 2 connections/i }),
    ).toBeInTheDocument();
  });

  it('renders a list of nodes accessible via aria label', () => {
    render(<MapViewer map={mockMap} />);

    expect(screen.getByRole('list', { name: /map nodes/i })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders the map-viewer test id', () => {
    render(<MapViewer map={mockMap} />);
    expect(screen.getByTestId('map-viewer')).toBeInTheDocument();
  });
});
