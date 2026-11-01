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

export interface CliqueClusterShare {
  clusterId: number;
  clusterLabel: string;
  color: string;
  count: number;
  share: number;
  words: string[];
}

export interface CliqueGroup {
  key: string; // e.g. "3-1", "4-1"
  k: number;
  index: number;
  label: string; // Top-2 central words, e.g. "is-snø"
  distinctWord?: string; // 3rd central word when label matches parent
  color: string;
  words: string[];
  parentKey: string | null;
  childrenKeys: string[];
  clusterSpread: CliqueClusterShare[];
}

export interface OverlapClusterGroup {
  id: number;
  label: string;
  origLabel: string;
  overlapCount: number;
  jaccardScore: number;
  color: string;
  words: string[];
  addedWords: string[];
  cliqueAddedWords: string[];
  inSetCover: boolean;
  setCoverNewlyAdded: number;
}

export interface OverlapAnalysis {
  clusters: OverlapClusterGroup[];
  setCoverCount: number;
  dualNodeCount: number;
  dualEdgeCount: number;
  dualClusterCount: number;
  nodesWithOverlap: number;
  overlapPercentage: number;
  meanClustersPerNode: number;
  maxClustersPerNode: number;
  nodeToClusters: Map<string, string[]>;
  bridgeWords: { word: string; clusters: string[] }[];
  cpmCoveredNodes: number;
  cpmCoveragePercentage: number;
  cpmMeanClustersPerNode: number;
}

export interface GalaxyGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjDirected: Map<string, Map<string, number>>;
  adjReverse: Map<string, Map<string, number>>;
  adjUndirected: Map<string, Map<string, number>>;
  clusters: ClusterGroup[];
  cliques: CliqueGroup[];
  overlap: OverlapAnalysis;
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

    // In NetworkX G.to_undirected() / nx.Graph.add_edge, the undirected edge weight is set by the last edge encountered
    adjUndirected.get(source)!.set(target, weight);
    adjUndirected.get(target)!.set(source, weight);
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

  // Compute k-clique communities & inclusion tree like gnl.kcliques + gnl.subsetgraph
  const cliques = computeKCliqueCommunities(nodes, adjUndirected);

  // Compute Overlapping Clusters via Line Graph (Dual Graph) + Louvain + Clique-Informed Attachment
  const overlap = computeOverlapAnalysis(
    nodes,
    adjUndirected,
    clusters,
    cliques,
    'clique_hybrid',
    0.25
  );

  return {
    nodes,
    edges,
    adjDirected,
    adjReverse,
    adjUndirected,
    clusters,
    cliques,
    overlap,
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
 * Full multi-level Louvain modularity maximization (Phase 1 local moving + Phase 2 community aggregation),
 * matching community_louvain.best_partition / igraph.community_multilevel.
 * Input: array of adjacency maps (nodeIdx -> (neighborIdx -> weight)) for an undirected graph.
 * Returns: Int32Array of community IDs for each original node 0..N-1.
 */
function runMultilevelLouvain(initialAdj: Map<number, number>[]): Int32Array {
  const N = initialAdj.length;
  const finalComm = new Int32Array(N);
  for (let i = 0; i < N; i++) finalComm[i] = i;
  if (N === 0) return finalComm;

  let m2 = 0;
  for (let i = 0; i < N; i++) {
    for (const [j, w] of initialAdj[i].entries()) {
      m2 += i === j ? 2 * w : w;
    }
  }
  if (m2 <= 0) return finalComm;

  let currentAdj = initialAdj;
  let K = N;

  for (let level = 0; level < 10; level++) {
    const comm = new Int32Array(K);
    const sigmaTot = new Float64Array(K);
    const kNode = new Float64Array(K);
    const selfLoop = new Float64Array(K);

    for (let i = 0; i < K; i++) {
      comm[i] = i;
      let deg = 0;
      for (const [j, w] of currentAdj[i].entries()) {
        if (i === j) {
          deg += 2 * w;
          selfLoop[i] = w;
        } else {
          deg += w;
        }
      }
      kNode[i] = deg;
      sigmaTot[i] = deg;
    }

    let improved = true;
    let anyMovedInLevel = false;
    let iter = 0;

    while (improved && iter < 30) {
      improved = false;
      iter++;

      for (let i = 0; i < K; i++) {
        const cOld = comm[i];
        const ki = kNode[i];

        sigmaTot[cOld] -= ki;
        comm[i] = -1;

        const commWeights = new Map<number, number>();
        commWeights.set(cOld, 0);

        for (const [j, w] of currentAdj[i].entries()) {
          if (i === j) continue;
          const cj = comm[j];
          if (cj >= 0) {
            commWeights.set(cj, (commWeights.get(cj) ?? 0) + w);
          }
        }

        let bestComm = cOld;
        let bestGain = -Infinity;

        for (const [cCand, kIn] of commWeights.entries()) {
          // 2 * kIn - (sigmaTot[cCand] * ki) / (m2 / 2) === 2 * (kIn - (sigmaTot[cCand] * ki) / m2)
          const gain = kIn - (sigmaTot[cCand] * ki) / m2;
          if (gain > bestGain + 1e-12) {
            bestGain = gain;
            bestComm = cCand;
          }
        }

        comm[i] = bestComm;
        sigmaTot[bestComm] += ki;
        if (bestComm !== cOld) {
          improved = true;
          anyMovedInLevel = true;
        }
      }
    }

    // Renumber communities 0 .. C-1
    const renum = new Map<number, number>();
    let nextId = 0;
    for (let i = 0; i < K; i++) {
      const c = comm[i];
      if (!renum.has(c)) renum.set(c, nextId++);
      comm[i] = renum.get(c)!;
    }

    // Project back to original nodes
    for (let idx = 0; idx < N; idx++) {
      finalComm[idx] = comm[finalComm[idx]];
    }

    const C = nextId;
    if (!anyMovedInLevel || C === K || C <= 1) {
      break;
    }

    // Phase 2: Aggregate graph into C super-nodes
    const nextAdj: Map<number, number>[] = Array.from({ length: C }, () => new Map());
    for (let u = 0; u < K; u++) {
      const cu = comm[u];
      for (const [v, w] of currentAdj[u].entries()) {
        const cv = comm[v];
        if (u === v) {
          nextAdj[cu].set(cu, (nextAdj[cu].get(cu) ?? 0) + w);
        } else if (u < v) {
          if (cu === cv) {
            nextAdj[cu].set(cu, (nextAdj[cu].get(cu) ?? 0) + w);
          } else {
            nextAdj[cu].set(cv, (nextAdj[cu].get(cv) ?? 0) + w);
            nextAdj[cv].set(cu, (nextAdj[cv].get(cu) ?? 0) + w);
          }
        }
      }
    }

    currentAdj = nextAdj;
    K = C;
  }

  return finalComm;
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
  const N = nodeIds.length;
  if (N === 0) return [];

  const idToIdx = new Map<string, number>();
  nodeIds.forEach((id, i) => idToIdx.set(id, i));

  const indexedAdj: Map<number, number>[] = Array.from({ length: N }, () => new Map());
  for (let i = 0; i < N; i++) {
    const u = nodeIds[i];
    const nbrs = adjUndirected.get(u);
    if (nbrs) {
      for (const [v, w] of nbrs.entries()) {
        const j = idToIdx.get(v);
        if (j !== undefined) indexedAdj[i].set(j, w);
      }
    }
  }

  const partition = runMultilevelLouvain(indexedAdj);

  // Group nodes by community
  const rawGroups = new Map<number, string[]>();
  for (let i = 0; i < N; i++) {
    const c = partition[i];
    if (!rawGroups.has(c)) rawGroups.set(c, []);
    rawGroups.get(c)!.push(nodeIds[i]);
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
 * k-clique communities (percolation) for k = 3, 4, ... matching gnl.kcliques(G.to_undirected()),
 * names each clique by its top-2 central words, and builds the subset inclusion tree (gnl.subsetgraph).
 */
function computeKCliqueCommunities(
  nodes: Map<string, GraphNode>,
  adjUndirected: Map<string, Map<string, number>>
): CliqueGroup[] {
  const nodeIds = Array.from(nodes.keys());
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
    const levelCommunities: string[][] = [];

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

      // Sort words descending by centrality in G (matching gnl.subsetgraph / format_clusters_by_centrality)
      const words = Array.from(communityNodes).sort((a, b) => {
        const na = nodes.get(a);
        const nb = nodes.get(b);
        const degDiff = (nb?.undirectedDegree ?? 0) - (na?.undirectedDegree ?? 0);
        if (degDiff !== 0) return degDiff;
        const closeDiff = (nb?.closenessCentrality ?? 0) - (na?.closenessCentrality ?? 0);
        if (Math.abs(closeDiff) > 1e-9) return closeDiff;
        const totDiff = (nb?.totalDegree ?? 0) - (na?.totalDegree ?? 0);
        return totDiff !== 0 ? totDiff : a.localeCompare(b, 'nb');
      });

      levelCommunities.push(words);
    }

    // Order communities within level k by size descending
    levelCommunities.sort((a, b) => b.length - a.length);

    levelCommunities.forEach((words, idx) => {
      const compIdx = idx + 1;
      const label = words.slice(0, 2).join('-');

      // Compute cluster spread across Louvain communities
      const spreadMap = new Map<number, { label: string; color: string; words: string[] }>();
      for (const w of words) {
        const n = nodes.get(w);
        const cid = n?.communityId ?? 0;
        const clbl = n?.communityLabel || `Cluster ${cid}`;
        const ccol = n?.color || CLUSTER_COLORS[0];
        if (!spreadMap.has(cid)) {
          spreadMap.set(cid, { label: clbl, color: ccol, words: [] });
        }
        spreadMap.get(cid)!.words.push(w);
      }

      const clusterSpread: CliqueClusterShare[] = Array.from(spreadMap.entries())
        .map(([clusterId, info]) => ({
          clusterId,
          clusterLabel: info.label,
          color: info.color,
          count: info.words.length,
          share: words.length > 0 ? info.words.length / words.length : 0,
          words: info.words,
        }))
        .sort((a, b) => b.count - a.count);

      // Pick dominant color from the largest cluster share in this clique
      const color = clusterSpread[0]?.color ?? nodes.get(words[0])?.color ?? CLUSTER_COLORS[0];

      cliqueGroups.push({
        key: `${k}-${compIdx}`,
        k,
        index: compIdx,
        label,
        color,
        words,
        parentKey: null,
        childrenKeys: [],
        clusterSpread,
      });
    });
  }

  // Build hierarchical subset inclusion tree (matching gnl.subsetgraph(comms, centrals, labels=2))
  const byKey = new Map<string, CliqueGroup>();
  const wordSets = new Map<string, Set<string>>();
  for (const cg of cliqueGroups) {
    byKey.set(cg.key, cg);
    wordSets.set(cg.key, new Set(cg.words));
  }

  // Process from highest k down to k=3, finding immediate superset at a lower k
  const descByK = [...cliqueGroups].sort((a, b) => b.k - a.k || a.index - b.index);
  for (let i = 0; i < descByK.length; i++) {
    const child = descByK[i];
    const childSet = wordSets.get(child.key)!;

    for (let j = i + 1; j < descByK.length; j++) {
      const cand = descByK[j];
      if (cand.k >= child.k) continue;
      const candSet = wordSets.get(cand.key)!;

      let isSubset = true;
      for (const w of childSet) {
        if (!candSet.has(w)) {
          isSubset = false;
          break;
        }
      }

      if (isSubset) {
        child.parentKey = cand.key;
        cand.childrenKeys.push(child.key);
        if (child.label === cand.label && child.words.length >= 3) {
          child.distinctWord =
            child.words.slice(2).find((w) => w !== cand.distinctWord) ?? child.words[2];
        }
        break;
      }
    }
  }

  // Keep childrenKeys sorted in natural order (e.g. 4-1, 4-2, 4-3)
  for (const cg of cliqueGroups) {
    cg.childrenKeys.sort((a, b) => {
      const ca = byKey.get(a)!;
      const cb = byKey.get(b)!;
      return ca.k - cb.k || ca.index - cb.index;
    });
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

/**
 * Dual Graph (Line Graph) + Louvain + Attachment algorithm from Yoonsen/dual_graphs:
 * 1. Build undirected line graph Gd where each undirected edge e = {u, v} is a dual node,
 *    and two dual nodes are connected if they share a vertex in G.
 * 2. Run Louvain clustering on Gd and project each dual cluster back to its set of words.
 * 3. Attach dual clusters to original Louvain clusters ('best_overlap' or 'threshold').
 * 4. Order words in each overlapping cluster by degree centrality in G (format_clusters_by_centrality),
 *    name each cluster after its top-2 most central words, and compute Greedy Set Cover.
 */
export function computeOverlapAnalysis(
  nodes: Map<string, GraphNode>,
  adjUndirected: Map<string, Map<string, number>>,
  origClusters: ClusterGroup[],
  cliques: CliqueGroup[],
  strategy: 'clique_hybrid' | 'best_overlap' | 'threshold' = 'clique_hybrid',
  jaccardThreshold: number = 0.25
): OverlapAnalysis {
  // 1. Extract unique undirected edges in sorted word order (matching build_cooccurrence_from_coordinations)
  const sortedNodeIds = Array.from(nodes.keys()).sort();
  const wordToIdx = new Map<string, number>();
  sortedNodeIds.forEach((w, i) => wordToIdx.set(w, i));

  const dualNodes: [string, string][] = [];
  const nodeToDualEdges = new Map<string, number[]>();

  for (let i = 0; i < sortedNodeIds.length; i++) {
    const u = sortedNodeIds[i];
    const nbrs = adjUndirected.get(u);
    if (!nbrs) continue;
    const sortedNbrs = Array.from(nbrs.keys()).sort();
    for (const v of sortedNbrs) {
      const j = wordToIdx.get(v) ?? -1;
      if (i < j) {
        const edgeId = dualNodes.length;
        dualNodes.push([u, v]);
        if (!nodeToDualEdges.has(u)) nodeToDualEdges.set(u, []);
        if (!nodeToDualEdges.has(v)) nodeToDualEdges.set(v, []);
        nodeToDualEdges.get(u)!.push(edgeId);
        nodeToDualEdges.get(v)!.push(edgeId);
      }
    }
  }

  const totalNodes = Math.max(1, nodes.size);
  const k3Cliques = cliques.filter((c) => c.k === 3);
  const cpmCoveredSet = new Set<string>();
  let cpmSumMemberships = 0;
  for (const cg of k3Cliques) {
    cpmSumMemberships += cg.words.length;
    for (const w of cg.words) cpmCoveredSet.add(w);
  }
  const cpmCoveredNodes = cpmCoveredSet.size;
  const cpmCoveragePercentage = (100 * cpmCoveredNodes) / totalNodes;
  const cpmMeanClustersPerNode = cpmSumMemberships / totalNodes;

  const M = dualNodes.length;
  if (M === 0 || origClusters.length === 0) {
    return {
      clusters: [],
      setCoverCount: 0,
      dualNodeCount: 0,
      dualEdgeCount: 0,
      dualClusterCount: 0,
      nodesWithOverlap: 0,
      overlapPercentage: 0,
      meanClustersPerNode: 0,
      maxClustersPerNode: 0,
      nodeToClusters: new Map(),
      bridgeWords: [],
      cpmCoveredNodes,
      cpmCoveragePercentage,
      cpmMeanClustersPerNode,
    };
  }

  // 2. Build line graph adjacency list (unweighted, matching build_dual_graph in dual_graph_clustering.py)
  const dualAdj: Map<number, number>[] = Array.from({ length: M }, () => new Map());
  let dualEdgeCount = 0;

  for (const u of sortedNodeIds) {
    const incidentEdges = nodeToDualEdges.get(u);
    if (!incidentEdges) continue;
    const len = incidentEdges.length;
    for (let i = 0; i < len; i++) {
      const e1 = incidentEdges[i];
      for (let j = i + 1; j < len; j++) {
        const e2 = incidentEdges[j];
        if (!dualAdj[e1].has(e2)) {
          dualAdj[e1].set(e2, 1);
          dualAdj[e2].set(e1, 1);
          dualEdgeCount++;
        }
      }
    }
  }

  // 3. Run multi-level Louvain modularity optimization on the dual graph Gd
  const commOfDual = runMultilevelLouvain(dualAdj);

  // Map dual clusters to sets of original word nodes
  const dualClusterMap = new Map<number, Set<string>>();
  for (let edgeId = 0; edgeId < M; edgeId++) {
    const dc = commOfDual[edgeId];
    if (!dualClusterMap.has(dc)) dualClusterMap.set(dc, new Set());
    const [u, v] = dualNodes[edgeId];
    dualClusterMap.get(dc)!.add(u);
    dualClusterMap.get(dc)!.add(v);
  }

  const dualClusters = Array.from(dualClusterMap.values());

  const intersectCount = (setA: Set<string>, setB: Set<string>): number => {
    let inter = 0;
    for (const item of setA) {
      if (setB.has(item)) inter++;
    }
    return inter;
  };

  // 4. Match & attach dual clusters to original clusters (match_clusters_with_overlap)
  const rawOverlapClusters: {
    orig: ClusterGroup;
    overlapCount: number;
    jaccardScore: number;
    words: string[];
    addedWords: string[];
    cliqueAddedWords: string[];
  }[] = [];

  for (const orig of origClusters) {
    const origSet = new Set(orig.words);
    const combinedSet = new Set(orig.words);
    const cliqueAddedSet = new Set<string>();
    let bestOverlap = 0;
    let bestJaccard = 0;

    if (strategy === 'best_overlap' || strategy === 'clique_hybrid') {
      let bestDual: Set<string> | null = null;

      for (const dSet of dualClusters) {
        const inter = intersectCount(origSet, dSet);
        if (inter === 0) continue;
        const union = origSet.size + dSet.size - inter;
        const jacc = union > 0 ? inter / union : 0;

        if (inter > bestOverlap || (inter === bestOverlap && jacc > bestJaccard)) {
          bestOverlap = inter;
          bestJaccard = jacc;
          bestDual = dSet;
        }
      }

      if (bestDual) {
        for (const w of bestDual) combinedSet.add(w);
      }

      // Clique-informed bridge attachment: if a 3-clique has >= 2 core nodes in origSet,
      // attach any node w in that clique that forms at least one triangle (>= 2 links) with the core
      if (strategy === 'clique_hybrid') {
        for (const cl of k3Cliques) {
          const coreInOrig = cl.words.filter((w) => origSet.has(w));
          if (coreInOrig.length < 2) continue;
          for (const w of cl.words) {
            if (origSet.has(w)) continue;
            const nbrs = adjUndirected.get(w);
            if (!nbrs) continue;
            const linksToCore = coreInOrig.filter((u) => nbrs.has(u)).length;
            if (linksToCore >= 2) {
              if (!combinedSet.has(w)) cliqueAddedSet.add(w);
              combinedSet.add(w);
            }
          }
        }
      }
    } else {
      // 'threshold' strategy: attach all dual clusters with Jaccard >= jaccardThreshold
      for (const dSet of dualClusters) {
        const inter = intersectCount(origSet, dSet);
        if (inter === 0) continue;
        const union = origSet.size + dSet.size - inter;
        const jacc = union > 0 ? inter / union : 0;
        if (jacc > bestJaccard) {
          bestJaccard = jacc;
          bestOverlap = inter;
        }
        if (jacc >= jaccardThreshold) {
          for (const w of dSet) combinedSet.add(w);
        }
      }
    }

    // 5. Sort words by undirected degree in G (matching format_clusters_by_centrality(G, ..., 'degree'))
    const sortedWords = Array.from(combinedSet).sort((a, b) => {
      const degDiff =
        (nodes.get(b)?.undirectedDegree ?? 0) - (nodes.get(a)?.undirectedDegree ?? 0);
      if (degDiff !== 0) return degDiff;
      const totDiff = (nodes.get(b)?.totalDegree ?? 0) - (nodes.get(a)?.totalDegree ?? 0);
      return totDiff !== 0 ? totDiff : a.localeCompare(b, 'nb');
    });

    const addedWords = sortedWords.filter((w) => !origSet.has(w));
    const cliqueAddedWords = sortedWords.filter((w) => cliqueAddedSet.has(w));
    rawOverlapClusters.push({
      orig,
      overlapCount: bestOverlap,
      jaccardScore: bestJaccard,
      words: sortedWords,
      addedWords,
      cliqueAddedWords,
    });
  }

  // Sort clusters descending by size (matching format_clusters_by_centrality)
  rawOverlapClusters.sort((a, b) => b.words.length - a.words.length);

  const usedLabels = new Set<string>();
  const overlapClusters: OverlapClusterGroup[] = rawOverlapClusters.map((rc, idx) => {
    let baseLabel = rc.words.slice(0, 2).join('-');
    let label = baseLabel;
    let suffix = 2;
    while (usedLabels.has(label)) {
      label = rc.words[2] ? `${baseLabel}-${rc.words[2]}` : `${baseLabel} (${suffix++})`;
      if (usedLabels.has(label)) {
        label = `${baseLabel} (${suffix++})`;
      }
    }
    usedLabels.add(label);

    return {
      id: idx,
      label,
      origLabel: rc.orig.label,
      overlapCount: rc.overlapCount,
      jaccardScore: rc.jaccardScore,
      color: rc.orig.color,
      words: rc.words,
      addedWords: rc.addedWords,
      cliqueAddedWords: rc.cliqueAddedWords,
      inSetCover: false,
      setCoverNewlyAdded: 0,
    };
  });

  // 6. Compute Greedy Set Cover (Section 5 of drodling_grafer.ipynb)
  const uncovered = new Set<string>(nodes.keys());
  let setCoverCount = 0;

  while (uncovered.size > 0) {
    let bestCluster: OverlapClusterGroup | null = null;
    let bestNewNodes: string[] = [];

    for (const oc of overlapClusters) {
      if (oc.inSetCover) continue;
      const newNodes = oc.words.filter((w) => uncovered.has(w));
      if (newNodes.length > bestNewNodes.length) {
        bestNewNodes = newNodes;
        bestCluster = oc;
      }
    }

    if (!bestCluster || bestNewNodes.length === 0) break;
    bestCluster.inSetCover = true;
    bestCluster.setCoverNewlyAdded = bestNewNodes.length;
    setCoverCount++;
    for (const w of bestNewNodes) uncovered.delete(w);
  }

  // 7. Compute node-to-clusters mapping and overlap statistics
  const nodeToClusters = new Map<string, string[]>();
  for (const id of nodes.keys()) {
    nodeToClusters.set(id, []);
  }
  for (const oc of overlapClusters) {
    for (const w of oc.words) {
      nodeToClusters.get(w)?.push(oc.label);
    }
  }

  let nodesWithOverlap = 0;
  let sumClusters = 0;
  let maxClustersPerNode = 0;
  const bridgeWords: { word: string; clusters: string[] }[] = [];

  for (const [word, clList] of nodeToClusters.entries()) {
    const count = clList.length;
    sumClusters += count;
    if (count > maxClustersPerNode) maxClustersPerNode = count;
    if (count > 1) {
      nodesWithOverlap++;
      bridgeWords.push({ word, clusters: clList });
    }
  }

  bridgeWords.sort((a, b) => {
    const diff = b.clusters.length - a.clusters.length;
    if (diff !== 0) return diff;
    return (
      (nodes.get(b.word)?.undirectedDegree ?? 0) - (nodes.get(a.word)?.undirectedDegree ?? 0)
    );
  });

  return {
    clusters: overlapClusters,
    setCoverCount,
    dualNodeCount: M,
    dualEdgeCount,
    dualClusterCount: dualClusters.length,
    nodesWithOverlap,
    overlapPercentage: (100 * nodesWithOverlap) / totalNodes,
    meanClustersPerNode: sumClusters / totalNodes,
    maxClustersPerNode,
    nodeToClusters,
    bridgeWords,
    cpmCoveredNodes,
    cpmCoveragePercentage,
    cpmMeanClustersPerNode,
  };
}
