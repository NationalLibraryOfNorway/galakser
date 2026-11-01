export type CorpusType = 'all' | 'bok' | 'avis' | 'eng' | 'ger';

export interface GraphNode {
  id: string;
  size: number;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  undirectedDegree: number;
  degreeCentrality: number;
  betweennessCentrality: number;
  closenessCentrality: number;
  communityId: number;
  communityLabel: string;
  color: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface ClusterGroup {
  id: number;
  label: string;
  color: string;
  words: string[];
}

export interface CliqueGroup {
  key: string; // e.g. "3-1", "4-1"
  k: number;
  index: number;
  words: string[];
}

export interface GalaxyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjDirected: Map<string, Map<string, number>>;
  adjReverse: Map<string, Map<string, number>>;
  adjUndirected: Map<string, Map<string, number>>;
  clusters: ClusterGroup[];
  cliques: CliqueGroup[];
}

export const CLUSTER_COLORS = [
  '#DC143C', // Crimson
  '#FF8C00', // DarkOrange
  '#2E8B57', // SeaGreen
  '#1E90FF', // DodgerBlue
  '#9932CC', // DarkOrchid
  '#D2691E', // Chocolate
  '#00CED1', // DarkTurquoise
  '#e11d48', // Rose
  '#65a30d', // Lime
  '#0284c7', // Sky
  '#7c3aed', // Violet
  '#d97706', // Amber
  '#0d9488', // Teal
];

const NB_GALAXY_API = 'https://api.nb.no/dhlab/nb_ngram_galaxies/galaxies/query';
const ALNUM_REGEX = /^[\p{L}\p{N}]+$/u;

interface RawApiNode {
  name: string;
  size?: number;
}

interface RawApiLink {
  source: number;
  target: number;
  value: number;
}

interface RawApiResponse {
  nodes?: RawApiNode[];
  links?: RawApiLink[];
}

export async function fetchGalaxyGraph(
  terms: string,
  cutoff: number = 16,
  corpus: CorpusType = 'all',
  leaves: number = 0
): Promise<GalaxyGraph> {
  const params = new URLSearchParams({
    terms: terms.trim(),
    leaves: String(leaves),
    limit: String(cutoff),
    corpus,
  });

  const response = await fetch(`${NB_GALAXY_API}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`API-feil (${response.status}): Kunne ikke hente galaksedata.`);
  }

  const raw: RawApiResponse = await response.json();
  return buildGalaxyGraph(raw);
}

export function buildGalaxyGraph(raw: RawApiResponse): GalaxyGraph {
  const rawNodes = raw.nodes ?? [];
  const rawLinks = raw.links ?? [];

  const adjDirected = new Map<string, Map<string, number>>();
  const adjReverse = new Map<string, Map<string, number>>();
  const adjUndirected = new Map<string, Map<string, number>>();
  const nodeSizes = new Map<string, number>();

  const ensureNode = (name: string, size = 10) => {
    if (!adjDirected.has(name)) adjDirected.set(name, new Map());
    if (!adjReverse.has(name)) adjReverse.set(name, new Map());
    if (!adjUndirected.has(name)) adjUndirected.set(name, new Map());
    if (!nodeSizes.has(name)) nodeSizes.set(name, size);
  };

  for (const link of rawLinks) {
    const sNode = rawNodes[link.source];
    const tNode = rawNodes[link.target];
    if (!sNode || !tNode) continue;

    const source = String(sNode.name ?? '');
    const target = String(tNode.name ?? '');

    // Replicate Python's source.isalnum() and target.isalnum() and remove self-loops
    if (!ALNUM_REGEX.test(source) || !ALNUM_REGEX.test(target)) continue;
    if (source === target) continue;

    const weight = Math.abs(Number(link.value) || 1);
    ensureNode(source, sNode.size ?? 10);
    ensureNode(target, tNode.size ?? 10);

    adjDirected.get(source)!.set(target, weight);
    adjReverse.get(target)!.set(source, weight);

    // In NetworkX G.to_undirected(), edge weight is set from directed edges
    const prevUndir = adjUndirected.get(source)!.get(target) ?? 0;
    const undirWeight = Math.max(prevUndir, weight);
    adjUndirected.get(source)!.set(target, undirWeight);
    adjUndirected.get(target)!.set(source, undirWeight);
  }

  const edges: GraphEdge[] = [];
  for (const [u, targets] of adjDirected.entries()) {
    for (const [v, weight] of targets.entries()) {
      edges.push({ source: u, target: v, weight });
    }
  }

  const nodeIds = Array.from(adjDirected.keys());
  const N = nodeIds.length;

  // Compute Centralities
  const betweenness = computeBetweennessCentrality(nodeIds, adjDirected);
  const closeness = computeClosenessCentrality(nodeIds, adjUndirected);

  const nodes = new Map<string, GraphNode>();
  for (const id of nodeIds) {
    const outDegree = adjDirected.get(id)?.size ?? 0;
    const inDegree = adjReverse.get(id)?.size ?? 0;
    const totalDegree = inDegree + outDegree;
    const undirectedDegree = adjUndirected.get(id)?.size ?? 0;
    // NetworkX nx.degree_centrality(G) on DiGraph uses (in_degree + out_degree) / (N - 1)
    const degreeCentrality = N > 1 ? totalDegree / (N - 1) : 0;

    nodes.set(id, {
      id,
      size: nodeSizes.get(id) ?? 10,
      inDegree,
      outDegree,
      totalDegree,
      undirectedDegree,
      degreeCentrality,
      betweennessCentrality: betweenness.get(id) ?? 0,
      closenessCentrality: closeness.get(id) ?? 0,
      communityId: 0,
      communityLabel: '',
      color: CLUSTER_COLORS[0],
    });
  }

  // Detect Louvain communities & name clusters like gnl.community_dict(G)
  const clusters = computeLouvainClusters(nodes, adjUndirected);

  // Compute k-clique communities like gnl.kcliques(G.to_undirected())
  const cliques = computeKCliqueCommunities(nodeIds, adjUndirected);

  return {
    nodes,
    edges,
    adjDirected,
    adjReverse,
    adjUndirected,
    clusters,
    cliques,
  };
}

/**
 * Brandes' algorithm for unweighted shortest-path betweenness centrality on a directed graph,
 * matching nx.betweenness_centrality(G) used by dhlab.nbtext.central_betweenness_characters.
 */
function computeBetweennessCentrality(
  nodeIds: string[],
  adjDirected: Map<string, Map<string, number>>
): Map<string, number> {
  const cb = new Map<string, number>();
  for (const v of nodeIds) cb.set(v, 0);
  const N = nodeIds.length;
  if (N <= 2) return cb;

  for (const s of nodeIds) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();

    for (const v of nodeIds) {
      pred.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
    }

    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: string[] = [s];
    let qIdx = 0;

    while (qIdx < queue.length) {
      const v = queue[qIdx++];
      stack.push(v);
      const dv = dist.get(v)!;
      const sigV = sigma.get(v)!;
      const neighbors = adjDirected.get(v);
      if (!neighbors) continue;

      for (const w of neighbors.keys()) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dv + 1);
        }
        if (dist.get(w)! === dv + 1) {
          sigma.set(w, sigma.get(w)! + sigV);
          pred.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const v of nodeIds) delta.set(v, 0);

    while (stack.length > 0) {
      const w = stack.pop()!;
      const coeff = (1 + delta.get(w)!) / sigma.get(w)!;
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + sigma.get(v)! * coeff);
      }
      if (w !== s) {
        cb.set(w, cb.get(w)! + delta.get(w)!);
      }
    }
  }

  // Normalize for directed graph: 1 / ((N - 1) * (N - 2))
  const scale = 1 / ((N - 1) * (N - 2));
  for (const [v, val] of cb.entries()) {
    cb.set(v, val * scale);
  }
  return cb;
}

/**
 * Wasserman and Faust improved closeness centrality on undirected graph (matching nx.closeness_centrality)
 */
function computeClosenessCentrality(
  nodeIds: string[],
  adjUndirected: Map<string, Map<string, number>>
): Map<string, number> {
  const cc = new Map<string, number>();
  const N = nodeIds.length;
  if (N <= 1) {
    for (const v of nodeIds) cc.set(v, 0);
    return cc;
  }

  for (const s of nodeIds) {
    const dist = new Map<string, number>();
    dist.set(s, 0);
    const queue: string[] = [s];
    let qIdx = 0;
    let totsp = 0;

    while (qIdx < queue.length) {
      const u = queue[qIdx++];
      const du = dist.get(u)!;
      const neighbors = adjUndirected.get(u);
      if (!neighbors) continue;
      for (const w of neighbors.keys()) {
        if (!dist.has(w)) {
          dist.set(w, du + 1);
          totsp += du + 1;
          queue.push(w);
        }
      }
    }

    const reachable = dist.size;
    if (totsp > 0 && N > 1) {
      const sNorm = ((reachable - 1) / totsp) * ((reachable - 1) / (N - 1));
      cc.set(s, sNorm);
    } else {
      cc.set(s, 0);
    }
  }

  return cc;
}

/**
 * Louvain modularity maximization on the undirected weighted graph,
 * followed by cluster naming by top-2 degree nodes as in gnl.community_dict(G).
 */
function computeLouvainClusters(
  nodes: Map<string, GraphNode>,
  adjUndirected: Map<string, Map<string, number>>
): ClusterGroup[] {
  const nodeIds = Array.from(nodes.keys());
  if (nodeIds.length === 0) return [];

  // Calculate total edge weight m (sum of all undirected weights / 2)
  let m2 = 0; // 2 * m
  const kWeight = new Map<string, number>();
  for (const u of nodeIds) {
    let wSum = 0;
    const nbrs = adjUndirected.get(u);
    if (nbrs) {
      for (const w of nbrs.values()) {
        wSum += w;
      }
    }
    kWeight.set(u, wSum);
    m2 += wSum;
  }

  if (m2 === 0) {
    // Fallback if no edges
    const words = nodeIds.slice();
    return [
      {
        id: 0,
        label: words.slice(0, 2).join('-'),
        color: CLUSTER_COLORS[0],
        words,
      },
    ];
  }

  // Initialize each node in its own community
  const commOf = new Map<string, number>();
  const sigmaTot = new Map<number, number>();
  nodeIds.forEach((u, idx) => {
    commOf.set(u, idx);
    sigmaTot.set(idx, kWeight.get(u)!);
  });

  // Iterative local moving phase (Louvain Phase 1 with multiple passes)
  let improved = true;
  let iter = 0;
  while (improved && iter < 25) {
    improved = false;
    iter++;

    for (const u of nodeIds) {
      const cOld = commOf.get(u)!;
      const ku = kWeight.get(u)!;

      // Remove u from its current community
      sigmaTot.set(cOld, (sigmaTot.get(cOld) ?? 0) - ku);
      commOf.set(u, -1);

      // Compute weights from u to neighboring communities
      const commWeights = new Map<number, number>();
      commWeights.set(cOld, 0);
      const nbrs = adjUndirected.get(u);
      if (nbrs) {
        for (const [v, w] of nbrs.entries()) {
          const cv = commOf.get(v)!;
          if (cv >= 0) {
            commWeights.set(cv, (commWeights.get(cv) ?? 0) + w);
          }
        }
      }

      let bestComm = cOld;
      let bestGain = -Infinity;

      for (const [cCand, kIn] of commWeights.entries()) {
        const tot = sigmaTot.get(cCand) ?? 0;
        // Modularity gain delta Q (up to positive factor)
        const gain = kIn - (tot * ku) / m2;
        if (gain > bestGain + 1e-12) {
          bestGain = gain;
          bestComm = cCand;
        }
      }

      commOf.set(u, bestComm);
      sigmaTot.set(bestComm, (sigmaTot.get(bestComm) ?? 0) + ku);
      if (bestComm !== cOld) {
        improved = true;
      }
    }
  }

  // Group nodes by community
  const rawGroups = new Map<number, string[]>();
  for (const u of nodeIds) {
    const c = commOf.get(u)!;
    if (!rawGroups.has(c)) rawGroups.set(c, []);
    rawGroups.get(c)!.push(u);
  }

  // Sort nodes inside each community by total degree in G (descending), matching gnl.community_dict(G)
  const clusterList: { words: string[]; maxDegree: number }[] = [];
  for (const memberIds of rawGroups.values()) {
    const filtered = memberIds.filter((id) => (nodes.get(id)?.totalDegree ?? 0) > 0);
    if (filtered.length === 0) continue;
    filtered.sort((a, b) => {
      const diff = (nodes.get(b)?.totalDegree ?? 0) - (nodes.get(a)?.totalDegree ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b, 'nb');
    });
    clusterList.push({
      words: filtered,
      maxDegree: nodes.get(filtered[0])?.totalDegree ?? 0,
    });
  }

  // Sort clusters by size / prominence for consistent presentation
  clusterList.sort((a, b) => b.words.length - a.words.length || b.maxDegree - a.maxDegree);

  const clusters: ClusterGroup[] = clusterList.map((group, idx) => {
    const label = group.words.slice(0, 2).join('-');
    const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
    for (const word of group.words) {
      const node = nodes.get(word);
      if (node) {
        node.communityId = idx;
        node.communityLabel = label;
        node.color = color;
      }
    }
    return {
      id: idx,
      label,
      color,
      words: group.words,
    };
  });

  return clusters;
}

/**
 * Finds all maximal cliques using Bron-Kerbosch with pivoting, then computes
 * k-clique communities (percolation) for k = 3, 4, ... matching gnl.kcliques(G.to_undirected()).
 */
function computeKCliqueCommunities(
  nodeIds: string[],
  adjUndirected: Map<string, Map<string, number>>
): CliqueGroup[] {
  const neighborSets = new Map<string, Set<string>>();
  for (const u of nodeIds) {
    neighborSets.set(u, new Set(adjUndirected.get(u)?.keys() ?? []));
  }

  const maximalCliques: string[][] = [];

  function bronKerbosch(R: string[], P: Set<string>, X: Set<string>) {
    if (P.size === 0 && X.size === 0) {
      if (R.length >= 3) {
        maximalCliques.push(R.slice());
      }
      return;
    }

    // Choose pivot u in P union X that maximizes |P intersect N(u)|
    let pivot: string | null = null;
    let maxCount = -1;
    const unionPX = [...P, ...X];
    for (const u of unionPX) {
      const nbrs = neighborSets.get(u)!;
      let count = 0;
      for (const v of P) {
        if (nbrs.has(v)) count++;
      }
      if (count > maxCount) {
        maxCount = count;
        pivot = u;
      }
    }

    const pivotNbrs = pivot ? neighborSets.get(pivot)! : new Set<string>();
    const candidates = [...P].filter((v) => !pivotNbrs.has(v));

    for (const v of candidates) {
      const vNbrs = neighborSets.get(v)!;
      const nextP = new Set<string>();
      for (const w of P) {
        if (vNbrs.has(w)) nextP.add(w);
      }
      const nextX = new Set<string>();
      for (const w of X) {
        if (vNbrs.has(w)) nextX.add(w);
      }

      R.push(v);
      bronKerbosch(R, nextP, nextX);
      R.pop();

      P.delete(v);
      X.add(v);
    }
  }

  bronKerbosch([], new Set(nodeIds), new Set());

  if (maximalCliques.length === 0) return [];

  const maxCliqueSize = Math.max(...maximalCliques.map((c) => c.length));
  const cliqueGroups: CliqueGroup[] = [];

  for (let k = 3; k <= maxCliqueSize; k++) {
    const eligible = maximalCliques
      .filter((c) => c.length >= k)
      .map((c) => new Set(c));

    if (eligible.length === 0) break;

    const m = eligible.length;
    const visited = new Uint8Array(m);
    let compIdx = 1;

    for (let i = 0; i < m; i++) {
      if (visited[i]) continue;
      visited[i] = 1;
      const queue = [i];
      const communityNodes = new Set<string>(eligible[i]);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const setA = eligible[curr];

        for (let j = 0; j < m; j++) {
          if (visited[j]) continue;
          const setB = eligible[j];
          // Two cliques are adjacent in the clique graph if they share at least k - 1 nodes
          let intersectionCount = 0;
          for (const item of setA) {
            if (setB.has(item)) {
              intersectionCount++;
              if (intersectionCount >= k - 1) break;
            }
          }
          if (intersectionCount >= k - 1) {
            visited[j] = 1;
            queue.push(j);
            for (const item of setB) communityNodes.add(item);
          }
        }
      }

      const words = Array.from(communityNodes).sort((a, b) => a.localeCompare(b, 'nb'));
      cliqueGroups.push({
        key: `${k}-${compIdx}`,
        k,
        index: compIdx,
        words,
      });
      compIdx++;
    }
  }

  return cliqueGroups;
}

/**
 * Shortest path between source and target (directed or undirected), matching path() in st_agraph.py.
 */
export function findShortestPath(
  graph: GalaxyGraph,
  source: string,
  target: string,
  directed: boolean
): string[] {
  const s = source.trim();
  const t = target.trim();
  if (!graph.nodes.has(s) || !graph.nodes.has(t)) return [];
  if (s === t) return [s];

  const adj = directed ? graph.adjDirected : graph.adjUndirected;
  const parent = new Map<string, string>();
  const visited = new Set<string>([s]);
  const queue: string[] = [s];
  let qIdx = 0;

  while (qIdx < queue.length) {
    const u = queue[qIdx++];
    if (u === t) {
      const path: string[] = [t];
      let curr = t;
      while (curr !== s) {
        curr = parent.get(curr)!;
        path.push(curr);
      }
      return path.reverse();
    }

    const nbrs = adj.get(u);
    if (!nbrs) continue;
    for (const v of nbrs.keys()) {
      if (!visited.has(v)) {
        visited.add(v);
        parent.set(v, u);
        queue.push(v);
      }
    }
  }

  return [];
}

/**
 * All simple paths between source and target up to cutoff hops, matching paths() in st_agraph.py.
 */
export function findAllSimplePaths(
  graph: GalaxyGraph,
  source: string,
  target: string,
  directed: boolean,
  cutoff: number = 3,
  maxResults: number = 30
): string[][] {
  const s = source.trim();
  const t = target.trim();
  if (!graph.nodes.has(s) || !graph.nodes.has(t) || s === t) return [];

  const adj = directed ? graph.adjDirected : graph.adjUndirected;
  const results: string[][] = [];
  const visited = new Set<string>([s]);
  const currentPath: string[] = [s];

  function dfs(u: string, depth: number) {
    if (results.length >= maxResults) return;
    if (depth > cutoff) return;

    const nbrs = adj.get(u);
    if (!nbrs) return;

    for (const v of nbrs.keys()) {
      if (v === t) {
        results.push([...currentPath, t]);
        if (results.length >= maxResults) return;
      } else if (depth < cutoff && !visited.has(v)) {
        visited.add(v);
        currentPath.push(v);
        dfs(v, depth + 1);
        currentPath.pop();
        visited.delete(v);
      }
    }
  }

  dfs(s, 1);
  results.sort((a, b) => a.length - b.length);
  return results;
}
