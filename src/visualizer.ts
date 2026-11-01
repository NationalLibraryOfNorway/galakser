import { GalaxyGraph, GraphNode } from './graph';

export interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean;
}

export interface VisualizerOptions {
  onNodeSelect?: (node: GraphNode | null) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
}

export class GraphVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private graph: GalaxyGraph | null = null;
  private simNodes: SimNode[] = [];
  private simNodeMap = new Map<string, SimNode>();

  // Camera transform
  private panX = 0;
  private panY = 0;
  private scale = 1;

  // Physics & style settings (matching galaxy.py / st_agraph.py parameters)
  private spread = 1.2;
  private fontSize = 13;
  private showArrows = true;
  private physicsEnabled = true;
  private alpha = 1;

  // Interaction state
  private hoveredNode: SimNode | null = null;
  private selectedNode: SimNode | null = null;
  private draggedNode: SimNode | null = null;
  private isPanning = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerDownX = 0;
  private pointerDownY = 0;

  // Highlight sets (for cluster, clique, or path highlighting)
  private highlightedNodeIds = new Set<string>();
  private highlightedPathEdges = new Set<string>(); // "u->v" or "u--v"
  private highlightPathDirected = true;

  private animFrameId: number | null = null;
  private resizeObserver: ResizeObserver;
  private options: VisualizerOptions;

  // Touch pinch state
  private lastPinchDist: number | null = null;

  constructor(canvas: HTMLCanvasElement, options: VisualizerOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Kunne ikke opprette 2D-kontekst på canvas');
    this.ctx = ctx;
    this.options = options;

    this.setupEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
  }

  public setGraph(graph: GalaxyGraph) {
    this.graph = graph;
    this.selectedNode = null;
    this.hoveredNode = null;
    this.highlightedNodeIds.clear();
    this.highlightedPathEdges.clear();

    const nodes = Array.from(graph.nodes.values());
    const count = nodes.length;
    this.simNodes = [];
    this.simNodeMap.clear();

    // Group initial positions slightly by community angle so clusters form cleanly
    const clusterCount = Math.max(1, graph.clusters.length);
    const radiusSpread = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) * 0.28 || 180;

    nodes.forEach((n, idx) => {
      const clusterAngle = (2 * Math.PI * n.communityId) / clusterCount;
      const jitterAngle = (2 * Math.PI * idx) / Math.max(1, count);
      const r = radiusSpread * (0.35 + 0.65 * Math.random());
      const x = Math.cos(clusterAngle) * (radiusSpread * 0.45) + Math.cos(jitterAngle) * r * 0.5;
      const y = Math.sin(clusterAngle) * (radiusSpread * 0.45) + Math.sin(jitterAngle) * r * 0.5;

      // Node radius scaled by degree centrality (matching 100 * cent[i] in st_agraph.py)
      const radius = Math.max(6, Math.min(28, 6 + n.degreeCentrality * 34));

      const simNode: SimNode = {
        ...n,
        x,
        y,
        vx: 0,
        vy: 0,
        radius,
        pinned: false,
      };
      this.simNodes.push(simNode);
      this.simNodeMap.set(n.id, simNode);
    });

    this.resetView();
    this.alpha = 1;
    this.startLoop();
  }

  public setSettings(settings: {
    spread?: number;
    fontSize?: number;
    showArrows?: boolean;
    physicsEnabled?: boolean;
  }) {
    if (settings.spread !== undefined) {
      this.spread = settings.spread;
      this.alpha = Math.max(this.alpha, 0.6);
    }
    if (settings.fontSize !== undefined) this.fontSize = settings.fontSize;
    if (settings.showArrows !== undefined) this.showArrows = settings.showArrows;
    if (settings.physicsEnabled !== undefined) {
      this.physicsEnabled = settings.physicsEnabled;
      if (this.physicsEnabled) this.alpha = Math.max(this.alpha, 0.5);
    }
    this.startLoop();
  }

  public highlightSubset(nodeIds: Iterable<string> | null) {
    this.highlightedNodeIds.clear();
    this.highlightedPathEdges.clear();
    if (nodeIds) {
      for (const id of nodeIds) {
        this.highlightedNodeIds.add(id);
      }
    }
    this.render();
  }

  public highlightPath(path: string[], directed: boolean) {
    this.highlightedNodeIds.clear();
    this.highlightedPathEdges.clear();
    this.highlightPathDirected = directed;

    if (path.length > 0) {
      for (const id of path) {
        this.highlightedNodeIds.add(id);
      }
      for (let i = 0; i < path.length - 1; i++) {
        const u = path[i];
        const v = path[i + 1];
        this.highlightedPathEdges.add(`${u}->${v}`);
        if (!directed) {
          this.highlightedPathEdges.add(`${v}->${u}`);
        }
      }
    }
    this.render();
  }

  public selectNodeById(id: string | null) {
    if (!id) {
      this.selectedNode = null;
    } else {
      this.selectedNode = this.simNodeMap.get(id) ?? null;
    }
    this.options.onNodeSelect?.(this.selectedNode);
    this.render();
  }

  public resetView() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.panX = w / 2;
    this.panY = h / 2;
    this.scale = 1;
    this.render();
  }

  public zoomBy(factor: number) {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.zoomAt(w / 2, h / 2, factor);
  }

  public exportPNG(filename = 'ordgalakse.png') {
    this.render();
    const dataUrl = this.canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  private zoomAt(screenX: number, screenY: number, factor: number) {
    const nextScale = Math.max(0.18, Math.min(5, this.scale * factor));
    const ratio = nextScale / this.scale;
    this.panX = screenX - (screenX - this.panX) * ratio;
    this.panY = screenY - (screenY - this.panY) * ratio;
    this.scale = nextScale;
    this.render();
  }

  public resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width);
    const h = Math.max(300, rect.height);

    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      const prevW = this.canvas.width / dpr || w;
      const prevH = this.canvas.height / dpr || h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);

      if (this.panX === 0 && this.panY === 0) {
        this.panX = w / 2;
        this.panY = h / 2;
      } else {
        this.panX += (w - prevW) / 2;
        this.panY += (h - prevH) / 2;
      }
    }
    this.render();
  }

  private startLoop() {
    if (this.animFrameId !== null) return;
    const tick = () => {
      this.animFrameId = null;
      if (this.physicsEnabled && this.alpha > 0.008) {
        this.stepPhysics();
        this.alpha *= 0.985;
        this.render();
        this.animFrameId = requestAnimationFrame(tick);
      } else {
        this.render();
      }
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stepPhysics() {
    if (!this.graph || this.simNodes.length === 0) return;

    const nodes = this.simNodes;
    const N = nodes.length;
    const repulsionStrength = 950 * this.spread * this.spread;
    const springLength = 85 * this.spread;
    const springK = 0.045;
    const centerGravity = 0.012;

    // 1. All-pairs repulsion + collision avoidance
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const minDist = a.radius + b.radius + 14;

        // Coulomb repulsion
        let force = (repulsionStrength * this.alpha) / distSq;

        // Extra overlap separation
        if (dist < minDist) {
          force += (minDist - dist) * 0.35;
        }

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!a.pinned && a !== this.draggedNode) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (!b.pinned && b !== this.draggedNode) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    // 2. Spring attraction along edges
    for (const edge of this.graph.edges) {
      const s = this.simNodeMap.get(edge.source);
      const t = this.simNodeMap.get(edge.target);
      if (!s || !t) continue;

      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - springLength;
      const sameClusterBoost = s.communityId === t.communityId ? 1.35 : 0.85;
      const force = displacement * springK * sameClusterBoost * this.alpha;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!s.pinned && s !== this.draggedNode) {
        s.vx += fx;
        s.vy += fy;
      }
      if (!t.pinned && t !== this.draggedNode) {
        t.vx -= fx;
        t.vy -= fy;
      }
    }

    // 3. Center gravity and velocity integration
    for (const n of nodes) {
      if (n.pinned || n === this.draggedNode) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }

      n.vx -= n.x * centerGravity * this.alpha;
      n.vy -= n.y * centerGravity * this.alpha;

      // Damping
      n.vx *= 0.78;
      n.vy *= 0.78;

      // Clamp velocity
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > 28) {
        n.vx = (n.vx / speed) * 28;
        n.vy = (n.vy / speed) * 28;
      }

      n.x += n.vx;
      n.y += n.vy;
    }
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.panX) / this.scale,
      y: (sy - this.panY) / this.scale,
    };
  }

  private findNodeAt(sx: number, sy: number): SimNode | null {
    const { x, y } = this.screenToWorld(sx, sy);
    for (let i = this.simNodes.length - 1; i >= 0; i--) {
      const n = this.simNodes[i];
      const hitRadius = n.radius + 5 / this.scale;
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n;
      }
    }
    return null;
  }

  private setupEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      this.pointerDownX = sx;
      this.pointerDownY = sy;
      this.lastPointerX = sx;
      this.lastPointerY = sy;

      const hit = this.findNodeAt(sx, sy);
      if (hit) {
        this.draggedNode = hit;
        this.alpha = Math.max(this.alpha, 0.35);
        this.startLoop();
      } else {
        this.isPanning = true;
      }
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.draggedNode) {
        const world = this.screenToWorld(sx, sy);
        this.draggedNode.x = world.x;
        this.draggedNode.y = world.y;
        this.alpha = Math.max(this.alpha, 0.25);
        this.startLoop();
        return;
      }

      if (this.isPanning) {
        this.panX += sx - this.lastPointerX;
        this.panY += sy - this.lastPointerY;
        this.lastPointerX = sx;
        this.lastPointerY = sy;
        this.render();
        return;
      }

      const hit = this.findNodeAt(sx, sy);
      if (hit !== this.hoveredNode) {
        this.hoveredNode = hit;
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        this.render();
      }
    });

    const endPointer = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const movedDist = Math.hypot(sx - this.pointerDownX, sy - this.pointerDownY);

      if (movedDist < 5) {
        const hit = this.findNodeAt(sx, sy);
        this.selectedNode = hit;
        if (hit) {
          this.highlightedNodeIds.clear();
          this.highlightedPathEdges.clear();
        }
        this.options.onNodeSelect?.(hit);
      }

      this.draggedNode = null;
      this.isPanning = false;
      this.render();
    };

    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);

    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = this.findNodeAt(sx, sy);
      if (hit) {
        this.options.onNodeDoubleClick?.(hit);
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoomAt(sx, sy, factor);
      },
      { passive: false }
    );

    // Pinch-to-zoom on touch devices
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          this.lastPinchDist = Math.hypot(dx, dy);
        }
      },
      { passive: true }
    );

    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 2 && this.lastPinchDist !== null) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          if (dist > 10) {
            const rect = this.canvas.getBoundingClientRect();
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            this.zoomAt(midX, midY, dist / this.lastPinchDist);
            this.lastPinchDist = dist;
          }
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener('touchend', () => {
      this.lastPinchDist = null;
    });
  }

  public render() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!this.graph || this.simNodes.length === 0) {
      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.font = '500 15px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Ingen noder funnet for dette søket.', width / 2, height / 2);
      ctx.restore();
      return;
    }

    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // Determine active focus (hovered node, selected node, or external highlight set)
    const focusNode = this.hoveredNode ?? this.selectedNode;
    const activeNeighbors = new Set<string>();
    const hasExternalHighlight = this.highlightedNodeIds.size > 0;

    if (focusNode && !hasExternalHighlight) {
      activeNeighbors.add(focusNode.id);
      const undir = this.graph.adjUndirected.get(focusNode.id);
      if (undir) {
        for (const nbr of undir.keys()) activeNeighbors.add(nbr);
      }
    }

    // 1. Draw Edges (Curved smooth edges as in st_agraph.py)
    for (const edge of this.graph.edges) {
      const s = this.simNodeMap.get(edge.source);
      const t = this.simNodeMap.get(edge.target);
      if (!s || !t) continue;

      const isPathEdge =
        this.highlightedPathEdges.has(`${s.id}->${t.id}`) ||
        (!this.highlightPathDirected && this.highlightedPathEdges.has(`${t.id}->${s.id}`));

      const isFocusedEdge =
        focusNode && !hasExternalHighlight && (s.id === focusNode.id || t.id === focusNode.id);

      const isSubsetEdge =
        hasExternalHighlight &&
        this.highlightedPathEdges.size === 0 &&
        this.highlightedNodeIds.has(s.id) &&
        this.highlightedNodeIds.has(t.id);

      const dimmed =
        (focusNode && !hasExternalHighlight && !isFocusedEdge) ||
        (hasExternalHighlight && !isPathEdge && !isSubsetEdge);

      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Slight curve offset so bidirectional edges are both clearly visible
      const curveOffset = Math.min(22, dist * 0.12);
      const mx = (s.x + t.x) / 2 - (dy / dist) * curveOffset;
      const my = (s.y + t.y) / 2 + (dx / dist) * curveOffset;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(mx, my, t.x, t.y);

      if (isPathEdge) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3 / Math.sqrt(this.scale);
        ctx.globalAlpha = 0.98;
      } else if (isFocusedEdge || isSubsetEdge) {
        ctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7';
        ctx.lineWidth = 2 / Math.sqrt(this.scale);
        ctx.globalAlpha = 0.9;
      } else {
        ctx.strokeStyle = isDark ? '#475569' : '#93c5fd';
        ctx.lineWidth = 1.15 / Math.sqrt(this.scale);
        ctx.globalAlpha = dimmed ? 0.14 : 0.48;
      }
      ctx.stroke();

      // Draw directional arrowhead near target node boundary
      if (this.showArrows && (!dimmed || isPathEdge)) {
        const angle = Math.atan2(t.y - my, t.x - mx);
        const tipX = t.x - Math.cos(angle) * (t.radius + 2);
        const tipY = t.y - Math.sin(angle) * (t.radius + 2);
        const arrowLen = (isPathEdge ? 9 : 6.5) / Math.sqrt(this.scale);

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - arrowLen * Math.cos(angle - Math.PI / 6),
          tipY - arrowLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          tipX - arrowLen * Math.cos(angle + Math.PI / 6),
          tipY - arrowLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
      }
    }

    // 2. Draw Nodes & Labels
    for (const node of this.simNodes) {
      const isFocused =
        (!hasExternalHighlight && (!focusNode || activeNeighbors.has(node.id))) ||
        (hasExternalHighlight && this.highlightedNodeIds.has(node.id));

      const isPrimary =
        node === this.hoveredNode ||
        node === this.selectedNode ||
        (hasExternalHighlight && this.highlightedNodeIds.has(node.id));

      ctx.globalAlpha = isFocused ? 1 : 0.2;

      // Outer glow for selected/highlighted nodes
      if (isPrimary) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 4.5, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      ctx.lineWidth = isPrimary ? 2.4 / Math.sqrt(this.scale) : 1.2 / Math.sqrt(this.scale);
      ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff';
      ctx.stroke();

      // Node label
      if (this.fontSize > 0) {
        const fontPx = Math.max(9, this.fontSize / Math.pow(this.scale, 0.25));
        ctx.font = `${isPrimary ? 700 : 500} ${fontPx}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const labelY = node.y - node.radius - 7;
        // Subtle text halo for legibility over edges
        ctx.lineWidth = 3.2 / Math.sqrt(this.scale);
        ctx.strokeStyle = isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)';
        ctx.strokeText(node.id, node.x, labelY);

        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.fillText(node.id, node.x, labelY);
      }
    }

    ctx.restore();
  }
}
