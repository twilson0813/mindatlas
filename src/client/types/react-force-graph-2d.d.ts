declare module 'react-force-graph-2d' {
  import { ComponentType } from 'react';

  interface NodeObject {
    id: string | number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number;
    fy?: number;
    [key: string]: unknown;
  }

  interface LinkObject {
    source: string | number | NodeObject;
    target: string | number | NodeObject;
    [key: string]: unknown;
  }

  interface GraphData {
    nodes: NodeObject[];
    links: LinkObject[];
  }

  interface ForceGraphProps {
    graphData?: GraphData;
    width?: number;
    height?: number;
    backgroundColor?: string;
    nodeLabel?: string | ((node: NodeObject) => string);
    nodeColor?: string | ((node: NodeObject) => string);
    nodeVal?: string | number | ((node: NodeObject) => number);
    nodeRelSize?: number;
    linkColor?: string | ((link: LinkObject) => string);
    linkWidth?: string | number | ((link: LinkObject) => number);
    linkLabel?: string | ((link: LinkObject) => string);
    linkDirectionalArrowLength?: number;
    linkDirectionalArrowRelPos?: number;
    onNodeClick?: (node: NodeObject, event: MouseEvent) => void;
    onNodeHover?: (node: NodeObject | null, prevNode: NodeObject | null) => void;
    onLinkClick?: (link: LinkObject, event: MouseEvent) => void;
    cooldownTicks?: number;
    warmupTicks?: number;
    enableZoomInteraction?: boolean;
    enablePanInteraction?: boolean;
    enableNodeDrag?: boolean;
    d3AlphaDecay?: number;
    d3VelocityDecay?: number;
  }

  const ForceGraph2D: ComponentType<ForceGraphProps>;
  export default ForceGraph2D;
}
