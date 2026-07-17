import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';

export interface MapNode {
  id: string;
  label: string;
  category?: string;
  color?: string;
}

export interface MapEdge {
  source: string;
  target: string;
  relationshipType: string;
  strength?: number;
}

export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

interface MapViewerProps {
  map: MapData;
  width?: number;
  height?: number;
  onNodeClick?: (nodeId: string) => void;
}

const DEFAULT_NODE_COLOR = '#6366f1';
const LINK_COLOR = '#3d4259';
const HIGHLIGHT_COLOR = '#818cf8';

// Dynamically load react-force-graph-2d only in browser environments with canvas support
function useForceGraph() {
  const [ForceGraph, setForceGraph] = useState<React.ComponentType<Record<string, unknown>> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      try {
        const mod = await import('react-force-graph-2d');
        if (!cancelled) {
          setForceGraph(() => mod.default);
        }
      } catch {
        // Fallback to static view if graph library cannot be loaded
      }
    }

    loadGraph();
    return () => {
      cancelled = true;
    };
  }, []);

  return ForceGraph;
}

export function MapViewer({ map, width = 800, height = 600, onNodeClick }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width, height });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const ForceGraph2D = useForceGraph();

  // Resize observer for responsive sizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          setDimensions({ width: w, height: h });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: map.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        color: node.color || DEFAULT_NODE_COLOR,
        category: node.category,
      })),
      links: map.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relationshipType: edge.relationshipType,
        strength: edge.strength ?? 1,
      })),
    }),
    [map],
  );

  const handleNodeClick = useCallback(
    (node: { id?: string | number }) => {
      if (node.id && onNodeClick) {
        onNodeClick(String(node.id));
      }
    },
    [onNodeClick],
  );

  const handleNodeHover = useCallback((node: { id?: string | number } | null) => {
    setHoveredNode(node?.id ? String(node.id) : null);
  }, []);

  const nodeColor = useCallback(
    (node: { id?: string | number; color?: string }) => {
      if (hoveredNode && String(node.id) === hoveredNode) {
        return HIGHLIGHT_COLOR;
      }
      return (node.color as string) || DEFAULT_NODE_COLOR;
    },
    [hoveredNode],
  );

  const nodeLabel = useCallback((node: { label?: string; category?: string }) => {
    const label = (node.label as string) || '';
    const category = node.category ? ` (${node.category})` : '';
    return `${label}${category}`;
  }, []);

  if (map.nodes.length === 0) {
    return (
      <div
        className="map-viewer map-viewer--empty"
        ref={containerRef}
        role="img"
        aria-label="Empty map visualization"
      >
        <p className="map-viewer__empty-message">
          No items to display. Add items to see your knowledge map.
        </p>
      </div>
    );
  }

  // Fallback for environments where ForceGraph2D is not available (tests, SSR)
  if (!ForceGraph2D) {
    return (
      <div
        className="map-viewer"
        ref={containerRef}
        role="img"
        aria-label={`Knowledge map with ${map.nodes.length} items and ${map.edges.length} connections`}
        data-testid="map-viewer"
      >
        <div className="map-viewer__static">
          <p className="map-viewer__node-count">
            {map.nodes.length} nodes, {map.edges.length} connections
          </p>
          <ul className="map-viewer__node-list" aria-label="Map nodes">
            {map.nodes.map((node) => (
              <li key={node.id} className="map-viewer__node-item">
                <button
                  onClick={() => onNodeClick?.(node.id)}
                  className="map-viewer__node-button"
                  aria-label={`View item: ${node.label}`}
                >
                  {node.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div
      className="map-viewer"
      ref={containerRef}
      role="img"
      aria-label={`Interactive knowledge map with ${map.nodes.length} items and ${map.edges.length} connections`}
      data-testid="map-viewer"
    >
      <ForceGraph2D
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="transparent"
        nodeLabel={nodeLabel}
        nodeColor={nodeColor}
        nodeRelSize={6}
        linkColor={() => LINK_COLOR}
        linkWidth={(link: { strength?: number }) => (link.strength as number) || 1}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        enableNodeDrag={true}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
