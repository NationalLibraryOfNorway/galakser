import './style.css';
import {
  CorpusType,
  fetchGalaxyGraph,
  findAllSimplePaths,
  findShortestPath,
  GalaxyGraph,
  GraphNode,
} from './graph';
import { GraphVisualizer } from './visualizer';

// DOM Elements
const form = document.getElementById('galaxy-form') as HTMLFormElement;
const wordsInput = document.getElementById('words-input') as HTMLInputElement;
const corpusSelect = document.getElementById('corpus-select') as HTMLSelectElement;
const cutoffInput = document.getElementById('cutoff-input') as HTMLInputElement;
const cutoffOutput = document.getElementById('cutoff-output') as HTMLOutputElement;
const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;
const statusBadge = document.getElementById('status-badge') as HTMLElement;

const canvas = document.getElementById('galaxy-canvas') as HTMLCanvasElement;
const spreadRange = document.getElementById('spread-range') as HTMLInputElement;
const fontsizeRange = document.getElementById('fontsize-range') as HTMLInputElement;
const arrowsToggle = document.getElementById('arrows-toggle') as HTMLInputElement;
const zoomInBtn = document.getElementById('zoom-in-btn') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out-btn') as HTMLButtonElement;
const resetViewBtn = document.getElementById('reset-view-btn') as HTMLButtonElement;
const exportPngBtn = document.getElementById('export-png-btn') as HTMLButtonElement;

// Node Inspector
const inspector = document.getElementById('node-inspector') as HTMLElement;
const inspDot = document.getElementById('insp-dot') as HTMLElement;
const inspTitle = document.getElementById('insp-title') as HTMLElement;
const inspCluster = document.getElementById('insp-cluster') as HTMLElement;
const inspDeg = document.getElementById('insp-deg') as HTMLElement;
const inspCent = document.getElementById('insp-cent') as HTMLElement;
const inspBetw = document.getElementById('insp-betw') as HTMLElement;
const inspCloseBtn = document.getElementById('insp-close-btn') as HTMLButtonElement;
const inspFromBtn = document.getElementById('insp-from-btn') as HTMLButtonElement;
const inspToBtn = document.getElementById('insp-to-btn') as HTMLButtonElement;
const inspAddWordBtn = document.getElementById('insp-add-word-btn') as HTMLButtonElement;
const inspSoloWordBtn = document.getElementById('insp-solo-word-btn') as HTMLButtonElement;

// Tabs & Containers
const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const clustersContainer = document.getElementById('clusters-container') as HTMLElement;
const clearHighlightBtn = document.getElementById('clear-highlight-btn') as HTMLButtonElement;
const cliquesContainer = document.getElementById('cliques-container') as HTMLElement;
const centralityTbody = document.getElementById('centrality-tbody') as HTMLElement;
const centralityHeaders = document.querySelectorAll<HTMLTableCellElement>(
  '.centrality-table th[data-sort]'
);
const pathFromInput = document.getElementById('path-from-input') as HTMLInputElement;
const pathToInput = document.getElementById('path-to-input') as HTMLInputElement;
const findPathBtn = document.getElementById('find-path-btn') as HTMLButtonElement;
const nodesDatalist = document.getElementById('graph-nodes-datalist') as HTMLDataListElement;
const pathsResults = document.getElementById('paths-results') as HTMLElement;
const installPwaBtn = document.getElementById('install-pwa-btn') as HTMLButtonElement;

// State
let currentGraph: GalaxyGraph | null = null;
let currentSelectedNode: GraphNode | null = null;
let sortField: 'id' | 'degreeCentrality' | 'betweennessCentrality' | 'closenessCentrality' =
  'degreeCentrality';
let sortAsc = false;

// Initialize Visualizer
const visualizer = new GraphVisualizer(canvas, {
  onNodeSelect: (node) => {
    currentSelectedNode = node;
    updateInspector(node);
  },
  onNodeDoubleClick: (node) => {
    wordsInput.value = node.id;
    loadGalaxy();
  },
});

// Listen for OS theme changes to re-render canvas colors immediately
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  visualizer.render();
});

// Read initial parameters from URL query string if present
function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const w = params.get('words');
  const c = params.get('corpus') as CorpusType | null;
  const lim = params.get('cutoff');

  if (w) wordsInput.value = w;
  if (c && ['all', 'bok', 'avis', 'eng', 'ger'].includes(c)) corpusSelect.value = c;
  if (lim) {
    const n = Math.max(10, Math.min(24, Number(lim) || 16));
    cutoffInput.value = String(n);
    cutoffOutput.textContent = String(n);
  }
}

function syncUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('words', wordsInput.value.trim());
  url.searchParams.set('corpus', corpusSelect.value);
  url.searchParams.set('cutoff', cutoffInput.value);
  window.history.replaceState({}, '', url.toString());
}

cutoffInput.addEventListener('input', () => {
  cutoffOutput.textContent = cutoffInput.value;
});

// Graph Toolbar Controls
spreadRange.addEventListener('input', () => {
  visualizer.setSettings({ spread: Number(spreadRange.value) });
});

fontsizeRange.addEventListener('input', () => {
  visualizer.setSettings({ fontSize: Number(fontsizeRange.value) });
});

arrowsToggle.addEventListener('change', () => {
  visualizer.setSettings({ showArrows: arrowsToggle.checked });
});

zoomInBtn.addEventListener('click', () => visualizer.zoomBy(1.22));
zoomOutBtn.addEventListener('click', () => visualizer.zoomBy(1 / 1.22));
resetViewBtn.addEventListener('click', () => visualizer.resetView());
exportPngBtn.addEventListener('click', () => {
  const slug = wordsInput.value.trim().replace(/[^a-zA-Z0-9æøåÆØÅ_-]+/g, '_') || 'galakse';
  visualizer.exportPNG(`galakse_${slug}.png`);
});

clearHighlightBtn.addEventListener('click', () => {
  visualizer.highlightSubset(null);
  clearHighlightBtn.hidden = true;
  document.querySelectorAll('.group-card.active').forEach((el) => el.classList.remove('active'));
});

// Node Inspector Actions
function updateInspector(node: GraphNode | null) {
  if (!node) {
    inspector.hidden = true;
    return;
  }
  inspector.hidden = false;
  inspDot.style.backgroundColor = node.color;
  inspTitle.textContent = node.id;
  inspCluster.textContent = `Cluster: ${node.communityLabel || 'Ukjent'}`;
  inspDeg.textContent = `${node.totalDegree} (inn ${node.inDegree} / ut ${node.outDegree})`;
  inspCent.textContent = node.degreeCentrality.toFixed(3);
  inspBetw.textContent = node.betweennessCentrality.toFixed(3);
}

inspCloseBtn.addEventListener('click', () => {
  visualizer.selectNodeById(null);
});

inspFromBtn.addEventListener('click', () => {
  if (!currentSelectedNode) return;
  pathFromInput.value = currentSelectedNode.id;
  switchTab('paths');
  runPathSearch();
});

inspToBtn.addEventListener('click', () => {
  if (!currentSelectedNode) return;
  pathToInput.value = currentSelectedNode.id;
  switchTab('paths');
  runPathSearch();
});

inspAddWordBtn.addEventListener('click', () => {
  if (!currentSelectedNode) return;
  const existing = wordsInput.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!existing.includes(currentSelectedNode.id)) {
    existing.push(currentSelectedNode.id);
    wordsInput.value = existing.join(', ');
    loadGalaxy();
  }
});

inspSoloWordBtn.addEventListener('click', () => {
  if (!currentSelectedNode) return;
  wordsInput.value = currentSelectedNode.id;
  loadGalaxy();
});

// Tab switching
function switchTab(tabName: string) {
  tabBtns.forEach((btn) => {
    const isTarget = btn.dataset.tab === tabName;
    btn.setAttribute('aria-selected', String(isTarget));
  });
  const panes: Record<string, HTMLElement | null> = {
    clusters: document.getElementById('tab-clusters'),
    cliques: document.getElementById('tab-cliques'),
    centrality: document.getElementById('tab-centrality'),
    paths: document.getElementById('tab-paths'),
  };
  for (const [key, pane] of Object.entries(panes)) {
    if (pane) pane.hidden = key !== tabName;
  }
}

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab) switchTab(btn.dataset.tab);
  });
});

// Render Clusters Tab
function renderClusters(graph: GalaxyGraph) {
  clustersContainer.innerHTML = '';
  if (graph.clusters.length === 0) {
    clustersContainer.innerHTML = `<p style="color: var(--text-muted)">Ingen clustre funnet.</p>`;
    return;
  }

  for (const cluster of graph.clusters) {
    const card = document.createElement('div');
    card.className = 'group-card';

    const header = document.createElement('div');
    header.className = 'group-header';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.innerHTML = `<span class="color-dot" style="background-color: ${cluster.color}"></span><span>${cluster.label}</span>`;
    title.title = 'Klikk for å utheve hele clusteret i grafen';
    title.addEventListener('click', () => {
      document.querySelectorAll('.group-card.active').forEach((el) => el.classList.remove('active'));
      card.classList.add('active');
      visualizer.highlightSubset(cluster.words);
      clearHighlightBtn.hidden = false;
    });

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = `${cluster.words.length} ord`;

    header.append(title, count);

    const pillList = document.createElement('div');
    pillList.className = 'word-pill-list';

    for (const word of cluster.words) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'word-pill';
      pill.textContent = word;
      pill.addEventListener('click', () => {
        visualizer.highlightSubset(null);
        clearHighlightBtn.hidden = true;
        visualizer.selectNodeById(word);
      });
      pillList.appendChild(pill);
    }

    card.append(header, pillList);
    clustersContainer.appendChild(card);
  }
}

// Render Cliques Tab
function renderCliques(graph: GalaxyGraph) {
  cliquesContainer.innerHTML = '';
  if (graph.cliques.length === 0) {
    cliquesContainer.innerHTML = `<p style="color: var(--text-muted)">Ingen k-klikkstrukturer (k ≥ 3) funnet i denne grafen.</p>`;
    return;
  }

  for (const clique of graph.cliques) {
    const card = document.createElement('div');
    card.className = 'group-card';

    const header = document.createElement('div');
    header.className = 'group-header';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = `Klikk ${clique.key} (k=${clique.k})`;
    title.title = 'Klikk for å utheve klikken i grafen';
    title.addEventListener('click', () => {
      document.querySelectorAll('.group-card.active').forEach((el) => el.classList.remove('active'));
      card.classList.add('active');
      visualizer.highlightSubset(clique.words);
      clearHighlightBtn.hidden = false;
    });

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = `${clique.words.length} ord`;

    header.append(title, count);

    const pillList = document.createElement('div');
    pillList.className = 'word-pill-list';

    for (const word of clique.words) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'word-pill';
      pill.textContent = word;
      pill.addEventListener('click', () => {
        visualizer.highlightSubset(null);
        visualizer.selectNodeById(word);
      });
      pillList.appendChild(pill);
    }

    card.append(header, pillList);
    cliquesContainer.appendChild(card);
  }
}

// Render Centrality Table Tab
function renderCentralityTable(graph: GalaxyGraph) {
  centralityTbody.innerHTML = '';
  const nodes = Array.from(graph.nodes.values());
  if (nodes.length === 0) return;

  const maxDeg = Math.max(0.001, ...nodes.map((n) => n.degreeCentrality));
  const maxBetw = Math.max(0.001, ...nodes.map((n) => n.betweennessCentrality));
  const maxClose = Math.max(0.001, ...nodes.map((n) => n.closenessCentrality));

  nodes.sort((a, b) => {
    let cmp = 0;
    if (sortField === 'id') {
      cmp = a.id.localeCompare(b.id, 'nb');
    } else {
      cmp = a[sortField] - b[sortField];
    }
    return sortAsc ? cmp : -cmp;
  });

  for (const n of nodes) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => {
      visualizer.selectNodeById(n.id);
    });

    const degWidth = Math.round((n.degreeCentrality / maxDeg) * 46);
    const betwWidth = Math.round((n.betweennessCentrality / maxBetw) * 46);
    const closeWidth = Math.round((n.closenessCentrality / maxClose) * 46);

    tr.innerHTML = `
      <td>
        <span class="color-dot" style="background-color: ${n.color}; margin-inline-end: 0.35rem; vertical-align: middle;"></span>
        <strong>${n.id}</strong>
      </td>
      <td class="bar-cell">
        <span class="bar-fill" style="inline-size: ${degWidth}px"></span>${n.degreeCentrality.toFixed(3)}
      </td>
      <td class="bar-cell">
        <span class="bar-fill" style="inline-size: ${betwWidth}px"></span>${n.betweennessCentrality.toFixed(3)}
      </td>
      <td class="bar-cell">
        <span class="bar-fill" style="inline-size: ${closeWidth}px"></span>${n.closenessCentrality.toFixed(3)}
      </td>
    `;
    centralityTbody.appendChild(tr);
  }
}

centralityHeaders.forEach((th) => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort as typeof sortField;
    if (!field) return;
    if (sortField === field) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = field === 'id';
    }
    centralityHeaders.forEach((h) => {
      const base = h.textContent?.replace(/[↑↓]/g, '').trim() ?? '';
      if (h === th) {
        h.textContent = `${base} ${sortAsc ? '↑' : '↓'}`;
      } else {
        h.textContent = base;
      }
    });
    if (currentGraph) renderCentralityTable(currentGraph);
  });
});

// Populate datalist and default Fra / Til words (matching st_agraph.py logic)
function initPathsTab(graph: GalaxyGraph) {
  nodesDatalist.innerHTML = '';
  const nodes = Array.from(graph.nodes.values()).sort(
    (a, b) => b.degreeCentrality - a.degreeCentrality
  );

  for (const n of nodes) {
    const opt = document.createElement('option');
    opt.value = n.id;
    nodesDatalist.appendChild(opt);
  }

  const ws = wordsInput.value
    .split(',')
    .map((s) => s.trim())
    .filter((w) => graph.nodes.has(w));

  if (ws.length >= 2) {
    pathFromInput.value = ws[0];
    pathToInput.value = ws[1];
  } else if (nodes.length >= 2) {
    pathFromInput.value = nodes[0].id;
    pathToInput.value = nodes[1].id;
  } else {
    pathFromInput.value = '';
    pathToInput.value = '';
  }

  runPathSearch(false);
}

function createPathChainElement(path: string[], directed: boolean): HTMLElement {
  const div = document.createElement('div');
  div.className = 'path-chain';
  div.title = 'Klikk for å utheve denne stien i grafen';
  const sep = directed ? '→' : '↔';

  path.forEach((word, idx) => {
    const span = document.createElement('strong');
    span.textContent = word;
    div.appendChild(span);
    if (idx < path.length - 1) {
      const arrow = document.createElement('span');
      arrow.className = 'path-arrow';
      arrow.textContent = sep;
      div.appendChild(arrow);
    }
  });

  div.addEventListener('click', () => {
    visualizer.highlightPath(path, directed);
    clearHighlightBtn.hidden = false;
  });

  return div;
}

function runPathSearch(highlightFirst = true) {
  pathsResults.innerHTML = '';
  if (!currentGraph) return;

  const fra = pathFromInput.value.trim();
  const til = pathToInput.value.trim();
  if (!fra || !til) return;

  if (!currentGraph.nodes.has(fra) || !currentGraph.nodes.has(til)) {
    pathsResults.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">Fant ikke både «${fra}» og «${til}» i nåværende graf.</p>`;
    return;
  }

  const shortestDir = findShortestPath(currentGraph, fra, til, true);
  const shortestUndir = findShortestPath(currentGraph, fra, til, false);
  const multiDir = findAllSimplePaths(currentGraph, fra, til, true, 3, 15);
  const multiUndir = findAllSimplePaths(currentGraph, fra, til, false, 3, 15);

  // Box 1: Shortest paths
  const boxShortest = document.createElement('div');
  boxShortest.className = 'path-result-box';
  boxShortest.innerHTML = `<h4>Korteste sti (${fra} – ${til})</h4>`;

  const dirLabel = document.createElement('div');
  dirLabel.style.fontSize = '0.78rem';
  dirLabel.style.marginBottom = '0.25rem';
  dirLabel.textContent = 'Rettet (directed):';
  boxShortest.appendChild(dirLabel);

  if (shortestDir.length > 0) {
    boxShortest.appendChild(createPathChainElement(shortestDir, true));
  } else {
    const none = document.createElement('p');
    none.style.fontSize = '0.8rem';
    none.style.color = 'var(--text-muted)';
    none.style.margin = '0 0 0.5rem 0';
    none.textContent = 'Ingen rettet sti funnet (nopath).';
    boxShortest.appendChild(none);
  }

  const undirLabel = document.createElement('div');
  undirLabel.style.fontSize = '0.78rem';
  undirLabel.style.margin = '0.45rem 0 0.25rem 0';
  undirLabel.textContent = 'Urettet (undirected):';
  boxShortest.appendChild(undirLabel);

  if (shortestUndir.length > 0) {
    boxShortest.appendChild(createPathChainElement(shortestUndir, false));
  } else {
    const none = document.createElement('p');
    none.style.fontSize = '0.8rem';
    none.style.color = 'var(--text-muted)';
    none.style.margin = '0';
    none.textContent = 'Ingen urettet sti funnet (nopath).';
    boxShortest.appendChild(none);
  }

  pathsResults.appendChild(boxShortest);

  // Box 2: Multiple paths (cutoff <= 3 hops)
  const boxMulti = document.createElement('div');
  boxMulti.className = 'path-result-box';
  boxMulti.innerHTML = `<h4>Flere stier (inntil 3 steg)</h4>`;

  if (multiDir.length > 0) {
    const sub = document.createElement('div');
    sub.style.fontSize = '0.78rem';
    sub.style.marginBottom = '0.25rem';
    sub.textContent = `Rettede stier (${multiDir.length}):`;
    boxMulti.appendChild(sub);
    multiDir.slice(0, 8).forEach((p) => boxMulti.appendChild(createPathChainElement(p, true)));
  }

  if (multiUndir.length > 0) {
    const sub = document.createElement('div');
    sub.style.fontSize = '0.78rem';
    sub.style.margin = '0.45rem 0 0.25rem 0';
    sub.textContent = `Urettede stier (${multiUndir.length}):`;
    boxMulti.appendChild(sub);
    multiUndir.slice(0, 8).forEach((p) => boxMulti.appendChild(createPathChainElement(p, false)));
  }

  if (multiDir.length === 0 && multiUndir.length === 0) {
    const none = document.createElement('p');
    none.style.fontSize = '0.8rem';
    none.style.color = 'var(--text-muted)';
    none.textContent = 'Ingen stier innenfor 3 steg.';
    boxMulti.appendChild(none);
  }

  pathsResults.appendChild(boxMulti);

  if (highlightFirst) {
    if (shortestDir.length > 0) {
      visualizer.highlightPath(shortestDir, true);
      clearHighlightBtn.hidden = false;
    } else if (shortestUndir.length > 0) {
      visualizer.highlightPath(shortestUndir, false);
      clearHighlightBtn.hidden = false;
    }
  }
}

findPathBtn.addEventListener('click', () => runPathSearch(true));

// Main galaxy fetch handler
async function loadGalaxy() {
  const terms = wordsInput.value.trim();
  if (!terms) return;

  const corpus = corpusSelect.value as CorpusType;
  const cutoff = Number(cutoffInput.value) || 16;

  syncUrl();
  fetchBtn.disabled = true;
  statusBadge.textContent = 'Henter galakse fra NB DH-lab…';
  inspector.hidden = true;
  clearHighlightBtn.hidden = true;

  try {
    const graph = await fetchGalaxyGraph(terms, cutoff, corpus);
    currentGraph = graph;
    visualizer.setGraph(graph);

    renderClusters(graph);
    renderCliques(graph);
    renderCentralityTable(graph);
    initPathsTab(graph);

    statusBadge.textContent = `${graph.nodes.size} noder · ${graph.edges.length} kanter · ${graph.clusters.length} clustre`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ukjent feil';
    statusBadge.textContent = `Feil: ${msg}`;
  } finally {
    fetchBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  loadGalaxy();
});

corpusSelect.addEventListener('change', () => loadGalaxy());
cutoffInput.addEventListener('change', () => loadGalaxy());

// Register PWA Service Worker & Install Prompt
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Service worker registration optional in dev
    });
  });
}

let deferredPrompt: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installPwaBtn.hidden = false;
});

installPwaBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installPwaBtn.hidden = true;
});

// Start application
initFromUrl();
loadGalaxy();
