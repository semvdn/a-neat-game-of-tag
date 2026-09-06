import { ACTION_SPACE, STATE_VECTOR_SIZE } from '../constants';

export type NeatRole = 'chaser' | 'evader' | 'general';
export type NodeGeneType = 'input' | 'hidden' | 'output';

export interface NodeGene {
  id: number;
  type: NodeGeneType;
  bias: number;
  /** Feed-forward depth in [0,1]. Inputs=0, outputs=1; hidden nodes are strictly between. */
  depth?: number;
}

export interface ConnectionGene {
  innovation: number;
  inNode: number;
  outNode: number;
  weight: number;
  enabled: boolean;
  /** Recurrent links read the source node's previous-step value and are excluded from the DAG. */
  recurrent?: boolean;
}

export interface NeatGenomeData {
  id: string;
  role: NeatRole;
  generation: number;
  nodes: NodeGene[];
  connections: ConnectionGene[];
  fitness?: number;
  speciesId?: number;
}

export interface InnovationTrackerCheckpoint {
  nextInnovation: number;
  nextNodeId: number;
  edgeInnovations: Array<[string, number]>;
  splitNodes: Array<[number, number]>;
}

export interface NeatSpeciesCheckpoint {
  id: number;
  representative: NeatGenomeData;
  createdGeneration: number;
  age: number;
  bestFitnessEver: number;
  performanceEma: number;
  bestPerformanceEma: number;
  lastImprovedGeneration: number;
  stagnant: boolean;
}

export interface NeatPopulationCheckpoint {
  version: 1;
  role: 'chaser' | 'evader';
  generation: number;
  compatibilityThreshold: number;
  speciesCounter: number;
  extinctSpeciesSinceLastEvolution: number;
  genomes: NeatGenomeData[];
  species: NeatSpeciesCheckpoint[];
  innovationTracker: InnovationTrackerCheckpoint;
}

export interface NeatGenerationMetrics {
  role: 'chaser' | 'evader';
  generation: number;
  bestFitness: number;
  averageFitness: number;
  minFitness: number;
  speciesCount: number;
  reproductiveSpeciesCount: number;
  youngSpeciesCount: number;
  stagnantSpeciesCount: number;
  extinctSpeciesCount: number;
  oldestSpeciesAge: number;
  averageSpeciesAge: number;
  averageNodes: number;
  averageConnections: number;
  averageHiddenNodes: number;
  averageHiddenLayers: number;
  averageRecurrentConnections: number;
  championNodes: number;
  championConnections: number;
  championHiddenNodes: number;
  championHiddenLayers: number;
  championRecurrentConnections: number;
  compatibilityThreshold: number;
  timestamp: number;
}

export type NetworkArchitecturePreset =
  | 'minimal'
  | 'compact'
  | 'deep'
  | 'wide'
  | 'memory_lite'
  | 'memory_balanced'
  | 'memory_evolve'
  | 'memory_fixed'
  | 'memory_deep'
  | 'custom';

export interface NetworkArchitectureConfig {
  preset: NetworkArchitecturePreset;
  /** Generation-1 feed-forward hidden layer widths, from input side to output side. */
  hiddenLayers: number[];
  /** Allow mutation to introduce additional feed-forward depth. */
  evolveHiddenLayers: boolean;
  /** Hard cap on distinct hidden feed-forward depths, including the starting layers. */
  maxHiddenLayers: number;
  /** Allow mutation to add hidden nodes within existing layers. */
  evolveHiddenNodes: boolean;
  /** Hard cap on total hidden nodes, including all starting hidden nodes. */
  maxHiddenNodes: number;
  /** Deterministic fraction of candidate feed-forward connections instantiated initially. */
  connectionDensity: number;
  /** Add direct input -> output skip links even when hidden layers exist. */
  inputOutputSkip: boolean;
  /** Add skip links across non-adjacent hidden layers. */
  hiddenLayerSkips: boolean;
  /** Scale of uniformly sampled initial weights. */
  initialWeightScale: number;
  /** Mutation probability for adding one hidden node inside an existing layer. */
  addNodeRate: number;
  /** Mutation probability for adding a new feed-forward hidden layer by splitting an edge. */
  addLayerRate: number;
  /** Mutation probability for adding one ordinary feed-forward connection. */
  addConnectionRate: number;
  /** Number of recurrent previous-step connections instantiated in generation 1. */
  initialRecurrentConnections: number;
  /** Allow NEAT to add recurrent connections after generation 1. */
  evolveRecurrentConnections: boolean;
  /** Hard cap on enabled+disabled recurrent connection genes in a genome. */
  maxRecurrentConnections: number;
  /** Mutation probability for adding one recurrent connection. */
  addRecurrentConnectionRate: number;
}

export interface NetworkArchitectureSuiteConfig {
  linkedRoles: boolean;
  chaser: NetworkArchitectureConfig;
  runner: NetworkArchitectureConfig;
}

export const NETWORK_ARCHITECTURE_PRESETS: Record<Exclude<NetworkArchitecturePreset, 'custom'>, NetworkArchitectureConfig> = {
  // Feed-forward controls. These remain useful baselines when testing whether recurrence actually
  // improves tag behaviour rather than merely increasing network size.
  minimal: {
    preset: 'minimal', hiddenLayers: [], evolveHiddenLayers: true, maxHiddenLayers: 4, evolveHiddenNodes: true, maxHiddenNodes: 64,
    connectionDensity: 1, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.5,
    addNodeRate: 0.03, addLayerRate: 0.012, addConnectionRate: 0.08,
    initialRecurrentConnections: 0, evolveRecurrentConnections: false, maxRecurrentConnections: 0, addRecurrentConnectionRate: 0,
  },
  compact: {
    preset: 'compact', hiddenLayers: [12], evolveHiddenLayers: true, maxHiddenLayers: 4, evolveHiddenNodes: true, maxHiddenNodes: 72,
    connectionDensity: 0.75, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.25,
    addNodeRate: 0.025, addLayerRate: 0.01, addConnectionRate: 0.06,
    initialRecurrentConnections: 0, evolveRecurrentConnections: false, maxRecurrentConnections: 0, addRecurrentConnectionRate: 0,
  },
  deep: {
    preset: 'deep', hiddenLayers: [16, 12], evolveHiddenLayers: true, maxHiddenLayers: 5, evolveHiddenNodes: true, maxHiddenNodes: 96,
    connectionDensity: 0.65, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.15,
    addNodeRate: 0.02, addLayerRate: 0.008, addConnectionRate: 0.05,
    initialRecurrentConnections: 0, evolveRecurrentConnections: false, maxRecurrentConnections: 0, addRecurrentConnectionRate: 0,
  },
  wide: {
    preset: 'wide', hiddenLayers: [24, 16], evolveHiddenLayers: true, maxHiddenLayers: 5, evolveHiddenNodes: true, maxHiddenNodes: 128,
    connectionDensity: 0.55, inputOutputSkip: true, hiddenLayerSkips: true, initialWeightScale: 1.0,
    addNodeRate: 0.018, addLayerRate: 0.007, addConnectionRate: 0.045,
    initialRecurrentConnections: 0, evolveRecurrentConnections: false, maxRecurrentConnections: 0, addRecurrentConnectionRate: 0,
  },

  // Recurrent presets are intentionally conservative. One-step memory is powerful enough that a
  // small number of recurrent genes can materially change behaviour, so caps grow more slowly than
  // the feed-forward topology caps.
  memory_lite: {
    preset: 'memory_lite', hiddenLayers: [12], evolveHiddenLayers: true, maxHiddenLayers: 3, evolveHiddenNodes: true, maxHiddenNodes: 64,
    connectionDensity: 0.70, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.15,
    addNodeRate: 0.02, addLayerRate: 0.006, addConnectionRate: 0.05,
    initialRecurrentConnections: 4, evolveRecurrentConnections: true, maxRecurrentConnections: 16, addRecurrentConnectionRate: 0.008,
  },
  memory_balanced: {
    preset: 'memory_balanced', hiddenLayers: [16, 12], evolveHiddenLayers: true, maxHiddenLayers: 4, evolveHiddenNodes: true, maxHiddenNodes: 96,
    connectionDensity: 0.60, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.0,
    addNodeRate: 0.018, addLayerRate: 0.005, addConnectionRate: 0.045,
    initialRecurrentConnections: 8, evolveRecurrentConnections: true, maxRecurrentConnections: 32, addRecurrentConnectionRate: 0.012,
  },
  memory_evolve: {
    preset: 'memory_evolve', hiddenLayers: [16, 12], evolveHiddenLayers: true, maxHiddenLayers: 4, evolveHiddenNodes: true, maxHiddenNodes: 96,
    connectionDensity: 0.60, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.0,
    addNodeRate: 0.018, addLayerRate: 0.005, addConnectionRate: 0.045,
    initialRecurrentConnections: 0, evolveRecurrentConnections: true, maxRecurrentConnections: 32, addRecurrentConnectionRate: 0.015,
  },
  memory_fixed: {
    preset: 'memory_fixed', hiddenLayers: [16, 12], evolveHiddenLayers: false, maxHiddenLayers: 2, evolveHiddenNodes: false, maxHiddenNodes: 28,
    connectionDensity: 0.65, inputOutputSkip: true, hiddenLayerSkips: false, initialWeightScale: 1.0,
    addNodeRate: 0, addLayerRate: 0, addConnectionRate: 0,
    initialRecurrentConnections: 12, evolveRecurrentConnections: false, maxRecurrentConnections: 12, addRecurrentConnectionRate: 0,
  },
  memory_deep: {
    preset: 'memory_deep', hiddenLayers: [20, 16, 12], evolveHiddenLayers: true, maxHiddenLayers: 5, evolveHiddenNodes: true, maxHiddenNodes: 128,
    connectionDensity: 0.50, inputOutputSkip: true, hiddenLayerSkips: true, initialWeightScale: 0.9,
    addNodeRate: 0.015, addLayerRate: 0.004, addConnectionRate: 0.035,
    initialRecurrentConnections: 12, evolveRecurrentConnections: true, maxRecurrentConnections: 48, addRecurrentConnectionRate: 0.01,
  },
};

export const NETWORK_ARCHITECTURE_PRESET_INFO: Record<Exclude<NetworkArchitecturePreset, 'custom'>, { label: string; summary: string; use: string }> = {
  minimal: { label: 'Minimal NEAT', summary: 'No starting hidden layer or memory.', use: 'Control baseline; fastest training.' },
  compact: { label: 'Compact 12', summary: 'One small feed-forward hidden layer.', use: 'Low-cost nonlinear baseline.' },
  deep: { label: 'Deep 16→12', summary: 'Two feed-forward layers with moderate growth headroom.', use: 'Best feed-forward comparison for memory presets.' },
  wide: { label: 'Wide 24→16', summary: 'Wider feed-forward network with hidden skip links.', use: 'Tests capacity without temporal memory.' },
  memory_lite: { label: 'Memory Lite', summary: '12 hidden nodes + 4 recurrent links, evolving to 16.', use: 'Cheapest recurrent test; good first memory experiment.' },
  memory_balanced: { label: 'Memory Balanced', summary: '16→12 hidden layers + 8 recurrent links, evolving to 32.', use: 'Recommended general-purpose recurrent preset.' },
  memory_evolve: { label: 'Memory Discovery', summary: 'Starts feed-forward; recurrence may evolve up to 32 links.', use: 'Tests whether evolution chooses memory when it is useful.' },
  memory_fixed: { label: 'Fixed Memory Control', summary: 'Fixed 16→12 topology with exactly 12 recurrent links.', use: 'Clean control for memory benefit without structural growth.' },
  memory_deep: { label: 'Deep Memory', summary: '20→16→12 with 12 recurrent links, evolving to 48.', use: 'High-capacity temporal experiment; slower and harder to evolve.' },
};

export type NetworkArchitectureSuitePreset = 'ff_control' | 'balanced_memory' | 'chaser_memory' | 'runner_memory' | 'tactical_asymmetric';

export const NETWORK_ARCHITECTURE_SUITE_PRESETS: Record<NetworkArchitectureSuitePreset, { label: string; summary: string; config: NetworkArchitectureSuiteConfig }> = {
  ff_control: {
    label: 'FF control',
    summary: 'Deep feed-forward 16→12 for both roles; no recurrence.',
    config: { linkedRoles: true, chaser: { ...NETWORK_ARCHITECTURE_PRESETS.deep, hiddenLayers: [16, 12] }, runner: { ...NETWORK_ARCHITECTURE_PRESETS.deep, hiddenLayers: [16, 12] } },
  },
  balanced_memory: {
    label: 'Balanced memory',
    summary: 'Recommended: Memory Balanced for both Chaser and Runner.',
    config: { linkedRoles: true, chaser: { ...NETWORK_ARCHITECTURE_PRESETS.memory_balanced, hiddenLayers: [16, 12] }, runner: { ...NETWORK_ARCHITECTURE_PRESETS.memory_balanced, hiddenLayers: [16, 12] } },
  },
  chaser_memory: {
    label: 'Chaser memory specialist',
    summary: 'Memory Balanced Chaser vs Deep feed-forward Runner.',
    config: { linkedRoles: false, chaser: { ...NETWORK_ARCHITECTURE_PRESETS.memory_balanced, hiddenLayers: [16, 12] }, runner: { ...NETWORK_ARCHITECTURE_PRESETS.deep, hiddenLayers: [16, 12] } },
  },
  runner_memory: {
    label: 'Runner memory specialist',
    summary: 'Deep feed-forward Chaser vs Memory Balanced Runner.',
    config: { linkedRoles: false, chaser: { ...NETWORK_ARCHITECTURE_PRESETS.deep, hiddenLayers: [16, 12] }, runner: { ...NETWORK_ARCHITECTURE_PRESETS.memory_balanced, hiddenLayers: [16, 12] } },
  },
  tactical_asymmetric: {
    label: 'Tactical asymmetric',
    summary: 'Deep Memory Chaser vs Memory Lite Runner; richer pursuit planning without over-sizing the Runner.',
    config: { linkedRoles: false, chaser: { ...NETWORK_ARCHITECTURE_PRESETS.memory_deep, hiddenLayers: [20, 16, 12] }, runner: { ...NETWORK_ARCHITECTURE_PRESETS.memory_lite, hiddenLayers: [12] } },
  },
};

export const DEFAULT_NETWORK_ARCHITECTURE_SUITE: NetworkArchitectureSuiteConfig = {
  linkedRoles: true,
  chaser: { ...NETWORK_ARCHITECTURE_PRESETS.minimal, hiddenLayers: [] },
  runner: { ...NETWORK_ARCHITECTURE_PRESETS.minimal, hiddenLayers: [] },
};

export function sanitizeNetworkArchitectureConfig(value?: Partial<NetworkArchitectureConfig>): NetworkArchitectureConfig {
  const preset = value?.preset && ['minimal','compact','deep','wide','memory_lite','memory_balanced','memory_evolve','memory_fixed','memory_deep','custom'].includes(value.preset)
    ? value.preset as NetworkArchitecturePreset
    : 'custom';
  const widths = Array.isArray(value?.hiddenLayers) ? value!.hiddenLayers! : [];
  const hiddenLayers = widths.slice(0, 6).map(width => Math.max(1, Math.min(64, Math.round(Number(width) || 1))));
  const initialHiddenNodes = hiddenLayers.reduce((a, b) => a + b, 0);
  const requestedMaxLayers = Math.round(Number(value?.maxHiddenLayers));
  const requestedMaxNodes = Math.round(Number(value?.maxHiddenNodes));
  const density = Number(value?.connectionDensity);
  const scale = Number(value?.initialWeightScale);
  const addNode = Number(value?.addNodeRate);
  const addLayer = Number(value?.addLayerRate);
  const addConnection = Number(value?.addConnectionRate);
  const initialRecurrent = Math.round(Number(value?.initialRecurrentConnections));
  const requestedMaxRecurrent = Math.round(Number(value?.maxRecurrentConnections));
  const addRecurrent = Number(value?.addRecurrentConnectionRate);
  const maxHiddenLayers = Math.max(hiddenLayers.length, Number.isFinite(requestedMaxLayers) ? Math.min(8, Math.max(0, requestedMaxLayers)) : Math.max(hiddenLayers.length, 4));
  const maxHiddenNodes = Math.max(initialHiddenNodes, Number.isFinite(requestedMaxNodes) ? Math.min(384, Math.max(0, requestedMaxNodes)) : Math.max(initialHiddenNodes, 96));
  const initialStatefulNodes = initialHiddenNodes + ACTION_SPACE.length;
  const initialRecurrentCandidateCount = initialStatefulNodes * initialStatefulNodes;
  const recurrentInitial = Number.isFinite(initialRecurrent) ? Math.min(256, initialRecurrentCandidateCount, Math.max(0, initialRecurrent)) : 0;
  const maxRecurrentConnections = Math.max(recurrentInitial, Number.isFinite(requestedMaxRecurrent) ? Math.min(512, Math.max(0, requestedMaxRecurrent)) : recurrentInitial);
  return {
    preset,
    hiddenLayers,
    evolveHiddenLayers: value?.evolveHiddenLayers !== false,
    maxHiddenLayers,
    evolveHiddenNodes: value?.evolveHiddenNodes !== false,
    maxHiddenNodes,
    connectionDensity: Number.isFinite(density) ? Math.max(0.1, Math.min(1, density)) : 1,
    inputOutputSkip: value?.inputOutputSkip !== false,
    hiddenLayerSkips: value?.hiddenLayerSkips === true,
    initialWeightScale: Number.isFinite(scale) ? Math.max(0.1, Math.min(3, scale)) : 1.5,
    addNodeRate: Number.isFinite(addNode) ? Math.max(0, Math.min(0.2, addNode)) : 0.03,
    addLayerRate: Number.isFinite(addLayer) ? Math.max(0, Math.min(0.1, addLayer)) : 0.01,
    addConnectionRate: Number.isFinite(addConnection) ? Math.max(0, Math.min(0.3, addConnection)) : 0.08,
    initialRecurrentConnections: recurrentInitial,
    evolveRecurrentConnections: value?.evolveRecurrentConnections === true,
    maxRecurrentConnections,
    addRecurrentConnectionRate: Number.isFinite(addRecurrent) ? Math.max(0, Math.min(0.2, addRecurrent)) : 0.02,
  };
}

export function sanitizeNetworkArchitectureSuite(value?: Partial<NetworkArchitectureSuiteConfig>): NetworkArchitectureSuiteConfig {
  const linkedRoles = value?.linkedRoles !== false;
  const chaser = sanitizeNetworkArchitectureConfig(value?.chaser);
  const runner = linkedRoles ? { ...chaser, hiddenLayers: [...chaser.hiddenLayers] } : sanitizeNetworkArchitectureConfig(value?.runner);
  return { linkedRoles, chaser, runner };
}

export interface NeatConfig {
  populationSize: number;
  compatibilityThreshold: number;
  targetSpecies: number;
  compatibilityExcessCoeff: number;
  compatibilityDisjointCoeff: number;
  compatibilityWeightCoeff: number;
  crossoverRate: number;
  weightMutationRate: number;
  weightPerturbRate: number;
  weightPerturbScale: number;
  addNodeRate: number;
  addLayerRate: number;
  addConnectionRate: number;
  addRecurrentConnectionRate: number;
  toggleConnectionRate: number;
  interspeciesMatingRate: number;
  tournamentSize: number;
  elitismMinSpeciesSize: number;
  speciesSurvivalThreshold: number;
  speciesStagnationGenerations: number;
  youngSpeciesProtectionGenerations: number;
  protectedSpeciesCount: number;
  stagnationEmaAlpha: number;
  stagnationImprovementEpsilon: number;
  initialArchitecture: NetworkArchitectureConfig;
}

export const DEFAULT_NEAT_CONFIG: NeatConfig = {
  populationSize: 48,
  compatibilityThreshold: 3.0,
  targetSpecies: 8,
  compatibilityExcessCoeff: 1.0,
  compatibilityDisjointCoeff: 1.0,
  compatibilityWeightCoeff: 0.4,
  crossoverRate: 0.75,
  weightMutationRate: 0.8,
  weightPerturbRate: 0.9,
  weightPerturbScale: 0.5,
  addNodeRate: 0.03,
  addLayerRate: 0.01,
  addConnectionRate: 0.08,
  addRecurrentConnectionRate: 0.02,
  toggleConnectionRate: 0.01,
  interspeciesMatingRate: 0.02,
  tournamentSize: 3,
  elitismMinSpeciesSize: 4,
  speciesSurvivalThreshold: 0.5,
  speciesStagnationGenerations: 20,
  youngSpeciesProtectionGenerations: 5,
  protectedSpeciesCount: 2,
  stagnationEmaAlpha: 0.25,
  stagnationImprovementEpsilon: 0.01,
  initialArchitecture: { ...NETWORK_ARCHITECTURE_PRESETS.minimal, hiddenLayers: [] },
};

const cloneNodes = (nodes: NodeGene[]) => nodes.map(n => ({ ...n }));
const cloneConnections = (connections: ConnectionGene[]) => connections.map(c => ({ ...c }));
const randomWeight = (scale = 1.5) => (Math.random() * 2 - 1) * scale;

export class InnovationTracker {
  private nextInnovation = 0;
  private nextNodeId: number;
  private edgeInnovations = new Map<string, number>();
  private splitNodes = new Map<number, number>();

  constructor(initialNodeCount: number) {
    this.nextNodeId = initialNodeCount;
  }

  public getInnovation(inNode: number, outNode: number, recurrent = false): number {
    const key = recurrent ? `R:${inNode}->${outNode}` : `${inNode}->${outNode}`;
    const existing = this.edgeInnovations.get(key);
    if (existing !== undefined) return existing;
    const innovation = this.nextInnovation++;
    this.edgeInnovations.set(key, innovation);
    return innovation;
  }

  public allocateNode(): number {
    return this.nextNodeId++;
  }

  public getNodeForSplit(connectionInnovation: number): number {
    const existing = this.splitNodes.get(connectionInnovation);
    if (existing !== undefined) return existing;
    const nodeId = this.nextNodeId++;
    this.splitNodes.set(connectionInnovation, nodeId);
    return nodeId;
  }

  public exportCheckpoint(): InnovationTrackerCheckpoint {
    return {
      nextInnovation: this.nextInnovation,
      nextNodeId: this.nextNodeId,
      edgeInnovations: [...this.edgeInnovations.entries()],
      splitNodes: [...this.splitNodes.entries()],
    };
  }

  public restoreCheckpoint(checkpoint: InnovationTrackerCheckpoint): void {
    if (!checkpoint || !Number.isFinite(checkpoint.nextInnovation) || !Number.isFinite(checkpoint.nextNodeId)) {
      throw new Error('Invalid NEAT innovation tracker checkpoint');
    }
    this.nextInnovation = Math.max(0, Math.floor(checkpoint.nextInnovation));
    this.nextNodeId = Math.max(STATE_VECTOR_SIZE + ACTION_SPACE.length, Math.floor(checkpoint.nextNodeId));
    this.edgeInnovations = new Map(checkpoint.edgeInnovations || []);
    this.splitNodes = new Map(checkpoint.splitNodes || []);
  }

  public observeGenome(genome: NeatGenomeData) {
    for (const node of genome.nodes) {
      this.nextNodeId = Math.max(this.nextNodeId, node.id + 1);
    }
    for (const conn of genome.connections) {
      const key = conn.recurrent ? `R:${conn.inNode}->${conn.outNode}` : `${conn.inNode}->${conn.outNode}`;
      this.edgeInnovations.set(key, conn.innovation);
      this.nextInnovation = Math.max(this.nextInnovation, conn.innovation + 1);
    }
  }
}

function deterministicConnectionSelected(fromId: number, toId: number, density: number): boolean {
  if (density >= 0.999) return true;
  let h = Math.imul(fromId + 1, 0x45d9f3b) ^ Math.imul(toId + 11, 0x119de1f3);
  h ^= h >>> 16;
  const unit = (h >>> 0) / 4294967296;
  return unit < density;
}

function connectLayerPair(
  connections: ConnectionGene[],
  tracker: InnovationTracker,
  sources: number[],
  targets: number[],
  density: number,
  weightScale: number
) {
  const existing = new Set(connections.map(c => `${c.inNode}->${c.outNode}`));
  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    let targetHasIncoming = false;
    for (let si = 0; si < sources.length; si++) {
      const source = sources[si];
      if (!deterministicConnectionSelected(source, target, density)) continue;
      const key = `${source}->${target}`;
      if (existing.has(key)) continue;
      existing.add(key);
      targetHasIncoming = true;
      connections.push({ innovation: tracker.getInnovation(source, target), inNode: source, outNode: target, weight: randomWeight(weightScale), enabled: true });
    }
    // At low density, guarantee that every target is reachable from the immediately preceding layer.
    if (!targetHasIncoming && sources.length > 0) {
      const source = sources[ti % sources.length];
      const key = `${source}->${target}`;
      if (!existing.has(key)) {
        existing.add(key);
        connections.push({ innovation: tracker.getInnovation(source, target), inNode: source, outNode: target, weight: randomWeight(weightScale), enabled: true });
      }
    }
  }
}

function addInitialRecurrentConnections(
  connections: ConnectionGene[],
  tracker: InnovationTracker,
  nodes: NodeGene[],
  count: number,
  weightScale: number
) {
  if (count <= 0) return;
  const stateful = nodes.filter(n => n.type !== 'input');
  const candidates: Array<{ from: NodeGene; to: NodeGene; score: number }> = [];
  for (const from of stateful) {
    for (const to of stateful) {
      let h = Math.imul(from.id + 17, 0x45d9f3b) ^ Math.imul(to.id + 31, 0x119de1f3);
      h ^= h >>> 16;
      candidates.push({ from, to, score: h >>> 0 });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.from.id - b.from.id || a.to.id - b.to.id);
  const take = Math.min(count, candidates.length);
  for (let i = 0; i < take; i++) {
    const { from, to } = candidates[i];
    connections.push({
      innovation: tracker.getInnovation(from.id, to.id, true),
      inNode: from.id,
      outNode: to.id,
      weight: randomWeight(weightScale),
      enabled: true,
      recurrent: true,
    });
  }
}

function nodeDepth(node: NodeGene): number {
  if (node.type === 'input') return 0;
  if (node.type === 'output') return 1;
  return Number.isFinite(node.depth) ? Math.max(1e-6, Math.min(1 - 1e-6, node.depth!)) : 0.5;
}

function ensureGenomeDepths(genome: NeatGenomeData): void {
  if (genome.nodes.every(n => n.type !== 'hidden' || Number.isFinite(n.depth))) return;
  const incoming = new Map<number, number[]>();
  for (const conn of genome.connections) {
    if (!conn.enabled || conn.recurrent) continue;
    const arr = incoming.get(conn.outNode) || [];
    arr.push(conn.inNode);
    incoming.set(conn.outNode, arr);
  }
  const rank = new Map<number, number>();
  for (const node of genome.nodes) if (node.type === 'input') rank.set(node.id, 0);
  let changed = true;
  for (let pass = 0; pass < genome.nodes.length && changed; pass++) {
    changed = false;
    for (const node of genome.nodes) {
      if (node.type === 'input') continue;
      const preds = incoming.get(node.id) || [];
      let best = 0;
      let ready = preds.length === 0;
      for (const pred of preds) {
        const pr = rank.get(pred);
        if (pr === undefined) { ready = false; continue; }
        ready = true;
        best = Math.max(best, pr + 1);
      }
      if (ready && rank.get(node.id) !== best) { rank.set(node.id, best); changed = true; }
    }
  }
  let maxHiddenRank = 1;
  for (const node of genome.nodes) if (node.type === 'hidden') maxHiddenRank = Math.max(maxHiddenRank, rank.get(node.id) || 1);
  for (const node of genome.nodes) {
    if (node.type === 'input') node.depth = 0;
    else if (node.type === 'output') node.depth = 1;
    else if (!Number.isFinite(node.depth)) node.depth = Math.max(1e-6, Math.min(1 - 1e-6, (rank.get(node.id) || 1) / (maxHiddenRank + 1)));
  }
}

function hiddenLayerDepths(genome: NeatGenomeData): number[] {
  const depths = new Set<number>();
  for (const node of genome.nodes) if (node.type === 'hidden') depths.add(Number(nodeDepth(node).toFixed(9)));
  return [...depths].sort((a, b) => a - b);
}

function hiddenNodeCount(genome: NeatGenomeData): number {
  let count = 0;
  for (const node of genome.nodes) if (node.type === 'hidden') count++;
  return count;
}

function recurrentConnectionCount(genome: NeatGenomeData): number {
  let count = 0;
  for (const conn of genome.connections) if (conn.recurrent) count++;
  return count;
}

export function initialNodeCountForArchitecture(
  architecture: NetworkArchitectureConfig,
  inputCount = STATE_VECTOR_SIZE,
  outputCount = ACTION_SPACE.length
): number {
  return inputCount + outputCount + sanitizeNetworkArchitectureConfig(architecture).hiddenLayers.reduce((a, b) => a + b, 0);
}

export function createGenomeWithArchitecture(
  id: string,
  role: NeatRole,
  tracker: InnovationTracker,
  generation = 1,
  inputCount = STATE_VECTOR_SIZE,
  outputCount = ACTION_SPACE.length,
  architecture: NetworkArchitectureConfig = NETWORK_ARCHITECTURE_PRESETS.minimal
): NeatGenomeData {
  const arch = sanitizeNetworkArchitectureConfig(architecture);
  const nodes: NodeGene[] = [];
  const inputIds: number[] = [];
  const outputIds: number[] = [];
  for (let i = 0; i < inputCount; i++) { nodes.push({ id: i, type: 'input', bias: 0, depth: 0 }); inputIds.push(i); }
  for (let o = 0; o < outputCount; o++) {
    const nodeId = inputCount + o;
    nodes.push({ id: nodeId, type: 'output', bias: randomWeight(arch.initialWeightScale) * 0.1, depth: 1 });
    outputIds.push(nodeId);
  }

  let nextNodeId = inputCount + outputCount;
  const hiddenLayerIds: number[][] = [];
  for (let layerIndex = 0; layerIndex < arch.hiddenLayers.length; layerIndex++) {
    const width = arch.hiddenLayers[layerIndex];
    const depth = (layerIndex + 1) / (arch.hiddenLayers.length + 1);
    const layer: number[] = [];
    for (let i = 0; i < width; i++) {
      const nodeId = nextNodeId++;
      nodes.push({ id: nodeId, type: 'hidden', bias: randomWeight(arch.initialWeightScale) * 0.1, depth });
      layer.push(nodeId);
    }
    hiddenLayerIds.push(layer);
  }

  const connections: ConnectionGene[] = [];
  if (hiddenLayerIds.length === 0) {
    connectLayerPair(connections, tracker, inputIds, outputIds, arch.connectionDensity, arch.initialWeightScale);
  } else {
    connectLayerPair(connections, tracker, inputIds, hiddenLayerIds[0], arch.connectionDensity, arch.initialWeightScale);
    for (let layer = 0; layer < hiddenLayerIds.length - 1; layer++) {
      connectLayerPair(connections, tracker, hiddenLayerIds[layer], hiddenLayerIds[layer + 1], arch.connectionDensity, arch.initialWeightScale);
    }
    connectLayerPair(connections, tracker, hiddenLayerIds[hiddenLayerIds.length - 1], outputIds, arch.connectionDensity, arch.initialWeightScale);
    if (arch.inputOutputSkip) connectLayerPair(connections, tracker, inputIds, outputIds, arch.connectionDensity, arch.initialWeightScale);
    if (arch.hiddenLayerSkips && hiddenLayerIds.length > 1) {
      for (let fromLayer = 0; fromLayer < hiddenLayerIds.length - 1; fromLayer++) {
        for (let toLayer = fromLayer + 2; toLayer < hiddenLayerIds.length; toLayer++) {
          connectLayerPair(connections, tracker, hiddenLayerIds[fromLayer], hiddenLayerIds[toLayer], arch.connectionDensity * 0.5, arch.initialWeightScale);
        }
      }
    }
  }
  addInitialRecurrentConnections(connections, tracker, nodes, arch.initialRecurrentConnections, arch.initialWeightScale);
  return { id, role, generation, nodes, connections, fitness: 0 };
}

export function createMinimalGenome(
  id: string,
  role: NeatRole,
  tracker: InnovationTracker,
  generation = 1,
  inputCount = STATE_VECTOR_SIZE,
  outputCount = ACTION_SPACE.length
): NeatGenomeData {
  return createGenomeWithArchitecture(id, role, tracker, generation, inputCount, outputCount, NETWORK_ARCHITECTURE_PRESETS.minimal);
}

export function cloneGenome(genome: NeatGenomeData, id = genome.id): NeatGenomeData {
  return {
    ...genome,
    id,
    nodes: cloneNodes(genome.nodes),
    connections: cloneConnections(genome.connections),
  };
}

/** Compiled acyclic phenotype. Compilation is paid once when the genome changes.
 *
 * The hot activation path intentionally uses dense numeric arrays rather than Maps. During training
 * this function runs millions of times; avoiding per-activation Maps/objects cuts GC pressure and
 * lets modern JS engines optimize the loop much more aggressively.
 */
export class NeatNetwork {
  private readonly inputSlots: number[];
  private readonly outputSlots: number[];
  private readonly evalSlots: number[];
  private readonly biases: Float64Array;
  private readonly incomingSources: number[][];
  private readonly incomingWeights: number[][];
  private readonly recurrentSources: number[][];
  private readonly recurrentWeights: number[][];
  private readonly values: Float64Array;
  private readonly outputScratch: number[];
  private readonly recurrentContexts = new Map<number, Float64Array>();
  private readonly hasRecurrent: boolean;

  constructor(public readonly genome: NeatGenomeData) {
    ensureGenomeDepths(genome);
    const nodeById = new Map(genome.nodes.map((node, index) => [node.id, { node, index }]));
    const enabled = genome.connections.filter(c => c.enabled && nodeById.has(c.inNode) && nodeById.has(c.outNode));
    const feedForward = enabled.filter(c => !c.recurrent);
    const recurrent = enabled.filter(c => c.recurrent);
    const orderedIds = topologicalOrder(genome.nodes, feedForward);

    this.inputSlots = genome.nodes
      .filter(n => n.type === 'input')
      .sort((a, b) => a.id - b.id)
      .map(n => nodeById.get(n.id)!.index);
    this.outputSlots = genome.nodes
      .filter(n => n.type === 'output')
      .sort((a, b) => a.id - b.id)
      .map(n => nodeById.get(n.id)!.index);
    this.evalSlots = orderedIds
      .map(id => nodeById.get(id)!.index)
      .filter(slot => genome.nodes[slot].type !== 'input');

    this.biases = new Float64Array(genome.nodes.length);
    this.incomingSources = Array.from({ length: genome.nodes.length }, () => [] as number[]);
    this.incomingWeights = Array.from({ length: genome.nodes.length }, () => [] as number[]);
    this.recurrentSources = Array.from({ length: genome.nodes.length }, () => [] as number[]);
    this.recurrentWeights = Array.from({ length: genome.nodes.length }, () => [] as number[]);
    this.values = new Float64Array(genome.nodes.length);
    this.outputScratch = new Array(this.outputSlots.length).fill(0);
    this.hasRecurrent = recurrent.length > 0;

    for (let i = 0; i < genome.nodes.length; i++) this.biases[i] = genome.nodes[i].bias;
    for (const conn of feedForward) {
      const source = nodeById.get(conn.inNode)!.index;
      const target = nodeById.get(conn.outNode)!.index;
      this.incomingSources[target].push(source);
      this.incomingWeights[target].push(conn.weight);
    }
    for (const conn of recurrent) {
      const source = nodeById.get(conn.inNode)!.index;
      const target = nodeById.get(conn.outNode)!.index;
      this.recurrentSources[target].push(source);
      this.recurrentWeights[target].push(conn.weight);
    }
  }

  public resetState(contextId?: number): void {
    if (contextId === undefined) {
      for (const state of this.recurrentContexts.values()) state.fill(0);
    } else {
      const state = this.recurrentContexts.get(contextId);
      if (state) state.fill(0);
    }
  }

  /** Fast activation. Recurrent links read the previous activation of the same physical-agent context. */
  public activateFast(inputs: ArrayLike<number>, contextId = 0): readonly number[] {
    if (inputs.length !== this.inputSlots.length) {
      throw new Error(`NEAT network expected ${this.inputSlots.length} inputs, received ${inputs.length}`);
    }

    const values = this.values;
    const previous = this.hasRecurrent
      ? (this.recurrentContexts.get(contextId) || new Float64Array(values.length))
      : null;
    for (let i = 0; i < this.inputSlots.length; i++) {
      const value = inputs[i];
      values[this.inputSlots[i]] = Number.isFinite(value) ? value : 0;
    }

    for (let orderIndex = 0; orderIndex < this.evalSlots.length; orderIndex++) {
      const slot = this.evalSlots[orderIndex];
      let sum = this.biases[slot];
      const sources = this.incomingSources[slot];
      const weights = this.incomingWeights[slot];
      for (let i = 0; i < sources.length; i++) sum += values[sources[i]] * weights[i];
      if (previous) {
        const recurrentSources = this.recurrentSources[slot];
        const recurrentWeights = this.recurrentWeights[slot];
        for (let i = 0; i < recurrentSources.length; i++) sum += previous[recurrentSources[i]] * recurrentWeights[i];
      }
      const clamped = sum < -20 ? -20 : sum > 20 ? 20 : sum;
      values[slot] = 2 / (1 + Math.exp(-4.9 * clamped)) - 1;
    }

    if (previous) {
      previous.set(values);
      this.recurrentContexts.set(contextId, previous);
    }
    for (let i = 0; i < this.outputSlots.length; i++) this.outputScratch[i] = values[this.outputSlots[i]] || 0;
    return this.outputScratch;
  }

  /** Compatibility API for visual/debug code that may retain the returned values. */
  public activate(inputs: number[], contextId = 0): number[] {
    return Array.from(this.activateFast(inputs, contextId));
  }
}

function topologicalOrder(nodes: NodeGene[], connections: ConnectionGene[]): number[] {
  const indegree = new Map<number, number>(nodes.map(n => [n.id, 0]));
  const outgoing = new Map<number, number[]>();
  for (const conn of connections) {
    if (conn.recurrent) continue;
    indegree.set(conn.outNode, (indegree.get(conn.outNode) || 0) + 1);
    const arr = outgoing.get(conn.inNode) || [];
    arr.push(conn.outNode);
    outgoing.set(conn.inNode, arr);
  }

  const queue = nodes.filter(n => (indegree.get(n.id) || 0) === 0).map(n => n.id).sort((a, b) => a - b);
  const result: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const target of outgoing.get(id) || []) {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        queue.push(target);
        queue.sort((a, b) => a - b);
      }
    }
  }

  if (result.length !== nodes.length) throw new Error('Cannot compile NEAT genome: cyclic feed-forward connection detected');
  return result;
}

function pathExists(genome: NeatGenomeData, start: number, target: number): boolean {
  const outgoing = new Map<number, number[]>();
  for (const conn of genome.connections) {
    if (!conn.enabled || conn.recurrent) continue;
    const arr = outgoing.get(conn.inNode) || [];
    arr.push(conn.outNode);
    outgoing.set(conn.inNode, arr);
  }
  const stack = [start];
  const seen = new Set<number>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of outgoing.get(current) || []) stack.push(next);
  }
  return false;
}

export function mutateGenome(genome: NeatGenomeData, tracker: InnovationTracker, config: NeatConfig): void {
  ensureGenomeDepths(genome);
  const arch = sanitizeNetworkArchitectureConfig(config.initialArchitecture);
  if (Math.random() < config.weightMutationRate) mutateWeights(genome, config);
  if (Math.random() < config.addConnectionRate) addConnectionMutation(genome, tracker);
  if (arch.evolveHiddenNodes && Math.random() < config.addNodeRate) addNodeWithinLayerMutation(genome, tracker, arch.maxHiddenNodes);
  if (arch.evolveHiddenLayers && Math.random() < config.addLayerRate) addLayerMutation(genome, tracker, arch.maxHiddenLayers, arch.maxHiddenNodes);
  if (arch.evolveRecurrentConnections && Math.random() < config.addRecurrentConnectionRate) {
    addRecurrentConnectionMutation(genome, tracker, arch.maxRecurrentConnections);
  }
  if (Math.random() < config.toggleConnectionRate && genome.connections.length > 0) {
    const conn = genome.connections[Math.floor(Math.random() * genome.connections.length)];
    if (conn.enabled) {
      conn.enabled = false;
    } else if (conn.recurrent || !pathExists(genome, conn.outNode, conn.inNode)) {
      conn.enabled = true;
    }
  }
}

function mutateWeights(genome: NeatGenomeData, config: NeatConfig) {
  for (const conn of genome.connections) {
    if (Math.random() > 0.9) continue;
    if (Math.random() < config.weightPerturbRate) conn.weight += (Math.random() * 2 - 1) * config.weightPerturbScale;
    else conn.weight = randomWeight();
    conn.weight = Math.max(-5, Math.min(5, conn.weight));
  }
  for (const node of genome.nodes) {
    if (node.type !== 'input' && Math.random() < 0.1) node.bias = Math.max(-3, Math.min(3, node.bias + (Math.random() * 2 - 1) * 0.25));
  }
}

function addConnectionMutation(genome: NeatGenomeData, tracker: InnovationTracker): boolean {
  const sources = genome.nodes.filter(n => n.type !== 'output');
  const targets = genome.nodes.filter(n => n.type !== 'input');
  if (sources.length === 0 || targets.length === 0) return false;

  for (let attempt = 0; attempt < 60; attempt++) {
    const from = sources[Math.floor(Math.random() * sources.length)];
    const to = targets[Math.floor(Math.random() * targets.length)];
    if (from.id === to.id) continue;
    if (nodeDepth(from) >= nodeDepth(to)) continue;
    if (genome.connections.some(c => !c.recurrent && c.inNode === from.id && c.outNode === to.id)) continue;
    if (pathExists(genome, to.id, from.id)) continue;

    genome.connections.push({
      innovation: tracker.getInnovation(from.id, to.id),
      inNode: from.id,
      outNode: to.id,
      weight: randomWeight(),
      enabled: true,
      recurrent: false,
    });
    return true;
  }
  return false;
}

function addNodeWithinLayerMutation(genome: NeatGenomeData, tracker: InnovationTracker, maxHiddenNodes: number): boolean {
  if (hiddenNodeCount(genome) >= maxHiddenNodes) return false;
  const depths = hiddenLayerDepths(genome);
  if (depths.length === 0) return false;
  const depth = depths[Math.floor(Math.random() * depths.length)];
  const earlier = genome.nodes.filter(n => nodeDepth(n) < depth - 1e-9);
  const later = genome.nodes.filter(n => nodeDepth(n) > depth + 1e-9 && n.type !== 'input');
  if (earlier.length === 0 || later.length === 0) return false;
  const newNodeId = tracker.allocateNode();
  genome.nodes.push({ id: newNodeId, type: 'hidden', bias: 0, depth });

  const incoming = earlier[Math.floor(Math.random() * earlier.length)];
  const outgoing = later[Math.floor(Math.random() * later.length)];
  genome.connections.push({ innovation: tracker.getInnovation(incoming.id, newNodeId), inNode: incoming.id, outNode: newNodeId, weight: randomWeight(), enabled: true, recurrent: false });
  genome.connections.push({ innovation: tracker.getInnovation(newNodeId, outgoing.id), inNode: newNodeId, outNode: outgoing.id, weight: randomWeight(), enabled: true, recurrent: false });
  return true;
}

function addLayerMutation(genome: NeatGenomeData, tracker: InnovationTracker, maxHiddenLayers: number, maxHiddenNodes: number): boolean {
  if (hiddenLayerDepths(genome).length >= maxHiddenLayers || hiddenNodeCount(genome) >= maxHiddenNodes) return false;
  const existingDepths = new Set(hiddenLayerDepths(genome).map(d => d.toFixed(9)));
  const candidates = genome.connections.filter(c => {
    if (!c.enabled || c.recurrent) return false;
    const from = genome.nodes.find(n => n.id === c.inNode);
    const to = genome.nodes.find(n => n.id === c.outNode);
    if (!from || !to) return false;
    const midpoint = (nodeDepth(from) + nodeDepth(to)) / 2;
    return midpoint > 1e-6 && midpoint < 1 - 1e-6 && !existingDepths.has(midpoint.toFixed(9));
  });
  if (candidates.length === 0) return false;
  const split = candidates[Math.floor(Math.random() * candidates.length)];
  const from = genome.nodes.find(n => n.id === split.inNode)!;
  const to = genome.nodes.find(n => n.id === split.outNode)!;
  const depth = (nodeDepth(from) + nodeDepth(to)) / 2;
  split.enabled = false;
  const newNodeId = tracker.getNodeForSplit(split.innovation);
  if (!genome.nodes.some(n => n.id === newNodeId)) genome.nodes.push({ id: newNodeId, type: 'hidden', bias: 0, depth });
  genome.connections.push({ innovation: tracker.getInnovation(split.inNode, newNodeId), inNode: split.inNode, outNode: newNodeId, weight: 1, enabled: true, recurrent: false });
  genome.connections.push({ innovation: tracker.getInnovation(newNodeId, split.outNode), inNode: newNodeId, outNode: split.outNode, weight: split.weight, enabled: true, recurrent: false });
  return true;
}

function addRecurrentConnectionMutation(genome: NeatGenomeData, tracker: InnovationTracker, maxRecurrentConnections: number): boolean {
  if (maxRecurrentConnections <= 0 || recurrentConnectionCount(genome) >= maxRecurrentConnections) return false;
  const stateful = genome.nodes.filter(n => n.type !== 'input');
  if (stateful.length === 0) return false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const from = stateful[Math.floor(Math.random() * stateful.length)];
    const to = stateful[Math.floor(Math.random() * stateful.length)];
    if (genome.connections.some(c => c.recurrent && c.inNode === from.id && c.outNode === to.id)) continue;
    genome.connections.push({
      innovation: tracker.getInnovation(from.id, to.id, true),
      inNode: from.id,
      outNode: to.id,
      weight: randomWeight(),
      enabled: true,
      recurrent: true,
    });
    return true;
  }
  return false;
}

export function compatibilityDistance(a: NeatGenomeData, b: NeatGenomeData, config: NeatConfig): number {
  const aGenes = new Map(a.connections.map(g => [g.innovation, g]));
  const bGenes = new Map(b.connections.map(g => [g.innovation, g]));
  const maxA = a.connections.reduce((m, g) => Math.max(m, g.innovation), -1);
  const maxB = b.connections.reduce((m, g) => Math.max(m, g.innovation), -1);
  const innovations = new Set([...aGenes.keys(), ...bGenes.keys()]);

  let excess = 0;
  let disjoint = 0;
  let matching = 0;
  let weightDifference = 0;

  for (const innovation of innovations) {
    const ga = aGenes.get(innovation);
    const gb = bGenes.get(innovation);
    if (ga && gb) {
      matching++;
      weightDifference += Math.abs(ga.weight - gb.weight);
    } else if ((ga && innovation > maxB) || (gb && innovation > maxA)) {
      excess++;
    } else {
      disjoint++;
    }
  }

  const maxGenes = Math.max(a.connections.length, b.connections.length);
  const normalizer = Math.max(1, maxGenes < 20 ? 1 : Math.sqrt(maxGenes));
  const avgWeightDifference = matching > 0 ? weightDifference / matching : 0;
  return (
    config.compatibilityExcessCoeff * (excess / normalizer) +
    config.compatibilityDisjointCoeff * (disjoint / normalizer) +
    config.compatibilityWeightCoeff * avgWeightDifference
  );
}

export function crossover(a: NeatGenomeData, b: NeatGenomeData, childId: string, generation: number): NeatGenomeData {
  const aFitness = a.fitness ?? 0;
  const bFitness = b.fitness ?? 0;
  let fitter = a;
  let other = b;
  if (bFitness > aFitness) {
    fitter = b;
    other = a;
  }
  const equalFitness = Math.abs(aFitness - bFitness) < 1e-9;

  const otherGenes = new Map(other.connections.map(g => [g.innovation, g]));
  const childConnections: ConnectionGene[] = [];

  for (const gene of fitter.connections) {
    const matching = otherGenes.get(gene.innovation);
    let chosen = gene;
    if (matching && Math.random() < 0.5) chosen = matching;
    const inherited = { ...chosen };
    if (matching && (!gene.enabled || !matching.enabled)) inherited.enabled = Math.random() >= 0.75;
    childConnections.push(inherited);
  }

  if (equalFitness) {
    const fitterInnovations = new Set(fitter.connections.map(g => g.innovation));
    for (const gene of other.connections) {
      if (!fitterInnovations.has(gene.innovation) && Math.random() < 0.5) childConnections.push({ ...gene });
    }
  }

  const nodeIds = new Set<number>();
  for (const conn of childConnections) {
    nodeIds.add(conn.inNode);
    nodeIds.add(conn.outNode);
  }
  for (const n of fitter.nodes) if (n.type === 'input' || n.type === 'output') nodeIds.add(n.id);

  const fitterNodes = new Map(fitter.nodes.map(n => [n.id, n]));
  const otherNodes = new Map(other.nodes.map(n => [n.id, n]));
  const childNodes: NodeGene[] = [...nodeIds].sort((x, y) => x - y).map(id => {
    const first = fitterNodes.get(id);
    const second = otherNodes.get(id);
    if (first && second && Math.random() < 0.5) return { ...second };
    if (first) return { ...first };
    if (second) return { ...second };
    throw new Error(`Missing node ${id} during NEAT crossover`);
  });

  const safeConnections: ConnectionGene[] = [];
  for (const raw of childConnections.sort((x, y) => x.innovation - y.innovation)) {
    const gene = { ...raw };
    if (gene.enabled && !gene.recurrent) {
      const partial: NeatGenomeData = {
        id: childId,
        role: fitter.role,
        generation,
        nodes: childNodes,
        connections: safeConnections,
      };
      if (pathExists(partial, gene.outNode, gene.inNode)) gene.enabled = false;
    }
    safeConnections.push(gene);
  }

  return {
    id: childId,
    role: fitter.role,
    generation,
    nodes: childNodes,
    connections: safeConnections,
    fitness: 0,
  };
}

interface Species {
  id: number;
  representative: NeatGenomeData;
  members: NeatGenomeData[];
  createdGeneration: number;
  age: number;
  bestFitnessEver: number;
  performanceEma: number;
  bestPerformanceEma: number;
  lastImprovedGeneration: number;
  stagnant: boolean;
}

function selectSpeciesRepresentative(members: NeatGenomeData[], config: NeatConfig): NeatGenomeData {
  if (members.length === 1) return cloneGenome(members[0]);
  let best = members[0];
  let bestDistance = Infinity;
  for (const candidate of members) {
    let totalDistance = 0;
    for (const other of members) {
      if (candidate === other) continue;
      totalDistance += compatibilityDistance(candidate, other, config);
    }
    if (totalDistance < bestDistance) {
      bestDistance = totalDistance;
      best = candidate;
    }
  }
  return cloneGenome(best);
}

function allocateSpeciesOffspring(
  species: Species[],
  score: (species: Species) => number,
  populationSize: number
): Map<number, number> {
  const allocation = new Map<number, number>();
  if (species.length === 0) return allocation;

  // Give every surviving lineage one slot first. This prevents a newly-created or
  // temporarily weak species from disappearing purely due to rounding noise.
  const guaranteed = Math.min(populationSize, species.length);
  for (let i = 0; i < guaranteed; i++) allocation.set(species[i].id, 1);
  let remaining = populationSize - guaranteed;
  if (remaining <= 0) return allocation;

  const weights = species.map(s => Math.max(1e-9, score(s)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const fractions: Array<{ id: number; fraction: number }> = [];
  let assigned = 0;

  for (let i = 0; i < species.length; i++) {
    const exact = totalWeight > 0 ? (weights[i] / totalWeight) * remaining : remaining / species.length;
    const whole = Math.floor(exact);
    allocation.set(species[i].id, (allocation.get(species[i].id) ?? 0) + whole);
    assigned += whole;
    fractions.push({ id: species[i].id, fraction: exact - whole });
  }

  fractions.sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remaining - assigned; i++) {
    const id = fractions[i % fractions.length].id;
    allocation.set(id, (allocation.get(id) ?? 0) + 1);
  }
  return allocation;
}

function tournament(members: NeatGenomeData[], size: number): NeatGenomeData {
  let best = members[Math.floor(Math.random() * members.length)];
  for (let i = 1; i < size; i++) {
    const candidate = members[Math.floor(Math.random() * members.length)];
    if ((candidate.fitness ?? -Infinity) > (best.fitness ?? -Infinity)) best = candidate;
  }
  return best;
}

function roulette<T>(items: T[], weight: (item: T) => number): T {
  const weights = items.map(i => Math.max(1e-9, weight(i)));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return items[i];
  }
  return items[items.length - 1];
}

export class NeatPopulation {
  public genomes: NeatGenomeData[] = [];
  public generation = 1;
  private tracker: InnovationTracker;
  private speciesCounter = 0;
  private compatibilityThreshold: number;
  private speciesRecords = new Map<number, Species>();
  private extinctSpeciesSinceLastEvolution = 0;

  constructor(public readonly role: 'chaser' | 'evader', public readonly config: NeatConfig = { ...DEFAULT_NEAT_CONFIG }) {
    const architecture = sanitizeNetworkArchitectureConfig(config.initialArchitecture);
    this.tracker = new InnovationTracker(initialNodeCountForArchitecture(architecture));
    this.compatibilityThreshold = config.compatibilityThreshold;
    for (let i = 0; i < config.populationSize; i++) {
      const genome = createGenomeWithArchitecture(`${role}_g1_${i}`, role, this.tracker, 1, STATE_VECTOR_SIZE, ACTION_SPACE.length, architecture);
      // Initial diversity is weight-level; topology starts minimal as in canonical NEAT.
      this.genomes.push(genome);
    }
  }

  public exportCheckpoint(): NeatPopulationCheckpoint {
    return {
      version: 1,
      role: this.role,
      generation: this.generation,
      compatibilityThreshold: this.compatibilityThreshold,
      speciesCounter: this.speciesCounter,
      extinctSpeciesSinceLastEvolution: this.extinctSpeciesSinceLastEvolution,
      genomes: this.genomes.map(genome => cloneGenome(genome)),
      species: [...this.speciesRecords.values()].map(species => ({
        id: species.id,
        representative: cloneGenome(species.representative),
        createdGeneration: species.createdGeneration,
        age: species.age,
        bestFitnessEver: species.bestFitnessEver,
        performanceEma: species.performanceEma,
        bestPerformanceEma: species.bestPerformanceEma,
        lastImprovedGeneration: species.lastImprovedGeneration,
        stagnant: species.stagnant,
      })),
      innovationTracker: this.tracker.exportCheckpoint(),
    };
  }

  public restoreCheckpoint(checkpoint: NeatPopulationCheckpoint): void {
    if (!checkpoint || checkpoint.version !== 1 || checkpoint.role !== this.role) {
      throw new Error(`Invalid ${this.role} NEAT population checkpoint`);
    }
    if (!Array.isArray(checkpoint.genomes) || checkpoint.genomes.length !== this.config.populationSize) {
      throw new Error(
        `Checkpoint ${this.role} population has ${checkpoint.genomes?.length ?? 0} genomes; expected ${this.config.populationSize}`
      );
    }
    for (const genome of checkpoint.genomes) {
      const inputCount = genome.nodes.filter(node => node.type === 'input').length;
      const outputCount = genome.nodes.filter(node => node.type === 'output').length;
      if (inputCount !== STATE_VECTOR_SIZE || outputCount !== ACTION_SPACE.length) {
        throw new Error(
          `Checkpoint ${this.role} genome ${genome.id} is incompatible: expected ${STATE_VECTOR_SIZE} inputs/${ACTION_SPACE.length} outputs`
        );
      }
    }

    this.generation = Math.max(1, Math.floor(checkpoint.generation));
    this.compatibilityThreshold = Math.max(0.5, Math.min(10, checkpoint.compatibilityThreshold));
    this.speciesCounter = Math.max(0, Math.floor(checkpoint.speciesCounter));
    this.extinctSpeciesSinceLastEvolution = Math.max(0, Math.floor(checkpoint.extinctSpeciesSinceLastEvolution || 0));
    this.genomes = checkpoint.genomes.map(genome => cloneGenome(genome));
    this.tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.tracker.restoreCheckpoint(checkpoint.innovationTracker);
    // Observe all restored genomes defensively in case a checkpoint came from a build that did not
    // persist one of the innovation maps completely. Existing innovations retain their ids.
    for (const genome of this.genomes) this.tracker.observeGenome(genome);

    this.speciesRecords.clear();
    for (const saved of checkpoint.species || []) {
      const species: Species = {
        id: saved.id,
        representative: cloneGenome(saved.representative),
        members: [],
        createdGeneration: saved.createdGeneration,
        age: saved.age,
        bestFitnessEver: saved.bestFitnessEver,
        performanceEma: saved.performanceEma,
        bestPerformanceEma: saved.bestPerformanceEma,
        lastImprovedGeneration: saved.lastImprovedGeneration,
        stagnant: saved.stagnant,
      };
      this.speciesRecords.set(species.id, species);
      this.speciesCounter = Math.max(this.speciesCounter, species.id);
    }
  }

  public reset() {
    this.generation = 1;
    const architecture = sanitizeNetworkArchitectureConfig(this.config.initialArchitecture);
    this.tracker = new InnovationTracker(initialNodeCountForArchitecture(architecture));
    this.compatibilityThreshold = this.config.compatibilityThreshold;
    this.speciesCounter = 0;
    this.speciesRecords.clear();
    this.extinctSpeciesSinceLastEvolution = 0;
    this.genomes = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      this.genomes.push(createGenomeWithArchitecture(`${this.role}_g1_${i}`, this.role, this.tracker, 1, STATE_VECTOR_SIZE, ACTION_SPACE.length, architecture));
    }
  }

  public seedFromChampion(champion: NeatGenomeData) {
    this.tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.tracker.observeGenome(champion);
    this.compatibilityThreshold = this.config.compatibilityThreshold;
    this.speciesCounter = 0;
    this.speciesRecords.clear();
    this.extinctSpeciesSinceLastEvolution = 0;
    this.generation = Math.max(1, champion.generation || 1);
    this.genomes = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      const clone = cloneGenome(champion, `${this.role}_g${this.generation}_${i}`);
      clone.role = this.role;
      clone.fitness = 0;
      clone.speciesId = undefined;
      if (i > 0) mutateGenome(clone, this.tracker, this.config);
      this.genomes.push(clone);
    }
  }

  private createSpecies(genome: NeatGenomeData): Species {
    const fitness = genome.fitness ?? 0;
    const species: Species = {
      id: ++this.speciesCounter,
      representative: cloneGenome(genome),
      members: [],
      createdGeneration: this.generation,
      age: 1,
      bestFitnessEver: fitness,
      performanceEma: 0,
      bestPerformanceEma: -Infinity,
      lastImprovedGeneration: this.generation,
      stagnant: false,
    };
    this.speciesRecords.set(species.id, species);
    return species;
  }

  private speciate(): Species[] {
    const candidateSpecies = [...this.speciesRecords.values()];
    for (const species of candidateSpecies) species.members = [];

    // Match against persistent representatives and choose the closest compatible
    // lineage, rather than the first compatible bucket. This makes species IDs much
    // more stable across long runs and reduces arbitrary assignment-order effects.
    for (const genome of this.genomes) {
      let assigned: Species | undefined;
      let bestDistance = Infinity;
      for (const candidate of candidateSpecies) {
        const distance = compatibilityDistance(genome, candidate.representative, this.config);
        if (distance < this.compatibilityThreshold && distance < bestDistance) {
          bestDistance = distance;
          assigned = candidate;
        }
      }
      if (!assigned) {
        assigned = this.createSpecies(genome);
        candidateSpecies.push(assigned);
      }
      genome.speciesId = assigned.id;
      assigned.members.push(genome);
    }

    // A lineage with no descendants is naturally extinct and should not remain as
    // a ghost representative that can capture unrelated future genomes.
    for (const species of [...this.speciesRecords.values()]) {
      if (species.members.length === 0) {
        this.speciesRecords.delete(species.id);
        this.extinctSpeciesSinceLastEvolution++;
      }
    }

    const activeSpecies = [...this.speciesRecords.values()];
    const populationFitness = this.genomes.map(g => g.fitness ?? 0);
    const populationMin = Math.min(...populationFitness);
    const populationMax = Math.max(...populationFitness);
    const populationRange = populationMax - populationMin;
    for (const species of activeSpecies) {
      const currentBest = Math.max(...species.members.map(g => g.fitness ?? -Infinity));
      species.age = this.generation - species.createdGeneration + 1;
      species.bestFitnessEver = Math.max(species.bestFitnessEver, currentBest);

      // Coevolutionary raw fitness is not stationary because the opponent pool changes
      // every generation. Stagnation therefore tracks a smoothed *relative* score
      // within the current population rather than comparing raw historical fitness.
      const relativeBest = populationRange > 1e-9
        ? (currentBest - populationMin) / populationRange
        : 0.5;
      const alpha = Math.max(0.01, Math.min(1, this.config.stagnationEmaAlpha));
      if (!Number.isFinite(species.bestPerformanceEma)) {
        species.performanceEma = relativeBest;
        species.bestPerformanceEma = relativeBest;
        species.lastImprovedGeneration = this.generation;
      } else {
        species.performanceEma = alpha * relativeBest + (1 - alpha) * species.performanceEma;
        if (species.performanceEma > species.bestPerformanceEma + this.config.stagnationImprovementEpsilon) {
          species.bestPerformanceEma = species.performanceEma;
          species.lastImprovedGeneration = this.generation;
        }
      }
      species.stagnant = (this.generation - species.lastImprovedGeneration) >= this.config.speciesStagnationGenerations;
      species.representative = selectSpeciesRepresentative(species.members, this.config);
    }

    if (activeSpecies.length > this.config.targetSpecies + 1) {
      this.compatibilityThreshold = Math.min(10, this.compatibilityThreshold + 0.15);
    } else if (activeSpecies.length < this.config.targetSpecies - 1) {
      this.compatibilityThreshold = Math.max(0.5, this.compatibilityThreshold - 0.15);
    }
    return activeSpecies;
  }

  public evolve(): { metrics: NeatGenerationMetrics; champion: NeatGenomeData } {
    if (this.genomes.some(g => !Number.isFinite(g.fitness))) throw new Error(`Cannot evolve ${this.role}: every genome needs a finite fitness`);

    this.extinctSpeciesSinceLastEvolution = 0;
    const species = this.speciate();
    const sorted = [...this.genomes].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
    const champion = cloneGenome(sorted[0], `${this.role}_champion_g${this.generation}`);

    const speciesByCurrentBest = [...species].sort(
      (a, b) => Math.max(...b.members.map(g => g.fitness ?? -Infinity)) - Math.max(...a.members.map(g => g.fitness ?? -Infinity))
    );
    const championSpeciesId = sorted[0].speciesId;
    const protectedIds = new Set<number>(speciesByCurrentBest.slice(0, Math.max(0, this.config.protectedSpeciesCount)).map(s => s.id));
    if (championSpeciesId !== undefined) protectedIds.add(championSpeciesId);

    const youngSpecies = species.filter(s => s.age <= this.config.youngSpeciesProtectionGenerations);
    let reproductiveSpecies = species.filter(s => !s.stagnant || protectedIds.has(s.id) || s.age <= this.config.youngSpeciesProtectionGenerations);
    if (reproductiveSpecies.length === 0 && speciesByCurrentBest.length > 0) reproductiveSpecies = [speciesByCurrentBest[0]];

    const stagnantSpeciesCount = species.filter(s => s.stagnant).length;
    const stagnantPruned = species.filter(s => s.stagnant && !protectedIds.has(s.id) && s.age > this.config.youngSpeciesProtectionGenerations);
    for (const dead of stagnantPruned) {
      this.speciesRecords.delete(dead.id);
      this.extinctSpeciesSinceLastEvolution++;
    }

    const fitnesses = this.genomes.map(g => g.fitness ?? 0);
    const speciesAges = species.map(s => s.age);
    const metrics: NeatGenerationMetrics = {
      role: this.role,
      generation: this.generation,
      bestFitness: Math.max(...fitnesses),
      averageFitness: fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length,
      minFitness: Math.min(...fitnesses),
      speciesCount: species.length,
      reproductiveSpeciesCount: reproductiveSpecies.length,
      youngSpeciesCount: youngSpecies.length,
      stagnantSpeciesCount,
      extinctSpeciesCount: this.extinctSpeciesSinceLastEvolution,
      oldestSpeciesAge: speciesAges.length ? Math.max(...speciesAges) : 0,
      averageSpeciesAge: speciesAges.length ? speciesAges.reduce((a, b) => a + b, 0) / speciesAges.length : 0,
      averageNodes: this.genomes.reduce((s, g) => s + g.nodes.length, 0) / this.genomes.length,
      averageConnections: this.genomes.reduce((s, g) => s + g.connections.filter(c => c.enabled).length, 0) / this.genomes.length,
      averageHiddenNodes: this.genomes.reduce((s, g) => s + hiddenNodeCount(g), 0) / this.genomes.length,
      averageHiddenLayers: this.genomes.reduce((s, g) => s + hiddenLayerDepths(g).length, 0) / this.genomes.length,
      averageRecurrentConnections: this.genomes.reduce((s, g) => s + recurrentConnectionCount(g), 0) / this.genomes.length,
      championNodes: champion.nodes.length,
      championConnections: champion.connections.filter(c => c.enabled).length,
      championHiddenNodes: hiddenNodeCount(champion),
      championHiddenLayers: hiddenLayerDepths(champion).length,
      championRecurrentConnections: recurrentConnectionCount(champion),
      compatibilityThreshold: this.compatibilityThreshold,
      timestamp: Date.now(),
    };

    // Shift the population as one unit if event-only fitness is negative. Species
    // allocation then uses mean adjusted fitness (canonical explicit fitness sharing),
    // so large species do not win merely by containing more genomes.
    const minPopulationFitness = Math.min(...fitnesses);
    const fitnessOffset = minPopulationFitness < 0 ? -minPopulationFitness : 0;
    const speciesScore = (s: Species) => {
      const mean = s.members.reduce(
        (sum, g) => sum + Math.max(0, (g.fitness ?? 0) + fitnessOffset),
        0
      ) / Math.max(1, s.members.length);
      return mean + 1e-6;
    };

    const offspring = allocateSpeciesOffspring(reproductiveSpecies, speciesScore, this.config.populationSize);
    const nextGeneration = this.generation + 1;
    const next: NeatGenomeData[] = [];

    for (const speciesLineage of reproductiveSpecies) {
      const quota = offspring.get(speciesLineage.id) ?? 0;
      if (quota <= 0) continue;

      const rankedMembers = [...speciesLineage.members].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
      const survivalCount = Math.max(1, Math.ceil(rankedMembers.length * Math.max(0.05, Math.min(1, this.config.speciesSurvivalThreshold))));
      const parentPool = rankedMembers.slice(0, survivalCount);
      let produced = 0;

      const containsGlobalChampion = speciesLineage.id === championSpeciesId;
      const shouldElite = containsGlobalChampion || speciesLineage.members.length >= this.config.elitismMinSpeciesSize || speciesLineage.age <= this.config.youngSpeciesProtectionGenerations;
      if (shouldElite && produced < quota) {
        const eliteSource = containsGlobalChampion ? sorted[0] : rankedMembers[0];
        const eliteClone = cloneGenome(eliteSource, `${this.role}_g${nextGeneration}_${next.length}`);
        eliteClone.generation = nextGeneration;
        eliteClone.fitness = 0;
        eliteClone.speciesId = speciesLineage.id;
        next.push(eliteClone);
        produced++;
      }

      while (produced < quota && next.length < this.config.populationSize) {
        const parentA = tournament(parentPool, this.config.tournamentSize);
        let child: NeatGenomeData;

        if (Math.random() < this.config.crossoverRate) {
          let parentB: NeatGenomeData;
          if (Math.random() < this.config.interspeciesMatingRate && reproductiveSpecies.length > 1) {
            const alternatives = reproductiveSpecies.filter(s => s.id !== speciesLineage.id);
            const otherSpecies = roulette(alternatives, speciesScore);
            const otherRanked = [...otherSpecies.members].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
            const otherSurvivalCount = Math.max(1, Math.ceil(otherRanked.length * Math.max(0.05, Math.min(1, this.config.speciesSurvivalThreshold))));
            parentB = tournament(otherRanked.slice(0, otherSurvivalCount), this.config.tournamentSize);
          } else {
            parentB = tournament(parentPool, this.config.tournamentSize);
          }
          child = crossover(parentA, parentB, `${this.role}_g${nextGeneration}_${next.length}`, nextGeneration);
        } else {
          child = cloneGenome(parentA, `${this.role}_g${nextGeneration}_${next.length}`);
          child.generation = nextGeneration;
          child.fitness = 0;
        }

        mutateGenome(child, this.tracker, this.config);
        child.fitness = 0;
        // Preserve the parental lineage hint for diagnostics; next generation's
        // actual species assignment is still decided by compatibility distance.
        child.speciesId = speciesLineage.id;
        next.push(child);
        produced++;
      }
    }

    // Rounding should already make an exact population. Keep a defensive fallback
    // so a malformed custom config cannot silently shrink the population.
    while (next.length < this.config.populationSize) {
      const fallbackSpecies = reproductiveSpecies[0] ?? speciesByCurrentBest[0];
      const source = fallbackSpecies?.members[0] ?? sorted[0];
      const child = cloneGenome(source, `${this.role}_g${nextGeneration}_${next.length}`);
      child.generation = nextGeneration;
      child.fitness = 0;
      mutateGenome(child, this.tracker, this.config);
      next.push(child);
    }
    if (next.length > this.config.populationSize) next.length = this.config.populationSize;

    this.genomes = next;
    this.generation = nextGeneration;
    return { metrics, champion };
  }
}
