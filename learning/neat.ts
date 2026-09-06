import { ACTION_SPACE, STATE_VECTOR_SIZE } from '../constants';

export type NeatRole = 'chaser' | 'evader' | 'general';
export type NodeGeneType = 'input' | 'hidden' | 'output';

export interface NodeGene {
  id: number;
  type: NodeGeneType;
  bias: number;
}

export interface ConnectionGene {
  innovation: number;
  inNode: number;
  outNode: number;
  weight: number;
  enabled: boolean;
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
  championNodes: number;
  championConnections: number;
  compatibilityThreshold: number;
  timestamp: number;
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
  addConnectionRate: number;
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
  addConnectionRate: 0.08,
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
};

const cloneNodes = (nodes: NodeGene[]) => nodes.map(n => ({ ...n }));
const cloneConnections = (connections: ConnectionGene[]) => connections.map(c => ({ ...c }));
const randomWeight = () => (Math.random() * 2 - 1) * 1.5;

export class InnovationTracker {
  private nextInnovation = 0;
  private nextNodeId: number;
  private edgeInnovations = new Map<string, number>();
  private splitNodes = new Map<number, number>();

  constructor(initialNodeCount: number) {
    this.nextNodeId = initialNodeCount;
  }

  public getInnovation(inNode: number, outNode: number): number {
    const key = `${inNode}->${outNode}`;
    const existing = this.edgeInnovations.get(key);
    if (existing !== undefined) return existing;
    const innovation = this.nextInnovation++;
    this.edgeInnovations.set(key, innovation);
    return innovation;
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
      const key = `${conn.inNode}->${conn.outNode}`;
      this.edgeInnovations.set(key, conn.innovation);
      this.nextInnovation = Math.max(this.nextInnovation, conn.innovation + 1);
    }
  }
}

export function createMinimalGenome(
  id: string,
  role: NeatRole,
  tracker: InnovationTracker,
  generation = 1,
  inputCount = STATE_VECTOR_SIZE,
  outputCount = ACTION_SPACE.length
): NeatGenomeData {
  const nodes: NodeGene[] = [];
  for (let i = 0; i < inputCount; i++) nodes.push({ id: i, type: 'input', bias: 0 });
  for (let o = 0; o < outputCount; o++) nodes.push({ id: inputCount + o, type: 'output', bias: randomWeight() * 0.15 });

  const connections: ConnectionGene[] = [];
  for (let i = 0; i < inputCount; i++) {
    for (let o = 0; o < outputCount; o++) {
      const outNode = inputCount + o;
      connections.push({
        innovation: tracker.getInnovation(i, outNode),
        inNode: i,
        outNode,
        weight: randomWeight(),
        enabled: true,
      });
    }
  }

  return { id, role, generation, nodes, connections, fitness: 0 };
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
  private readonly values: Float64Array;
  private readonly outputScratch: number[];

  constructor(public readonly genome: NeatGenomeData) {
    const nodeById = new Map(genome.nodes.map((node, index) => [node.id, { node, index }]));
    const enabled = genome.connections.filter(c => c.enabled && nodeById.has(c.inNode) && nodeById.has(c.outNode));
    const orderedIds = topologicalOrder(genome.nodes, enabled);

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
    this.values = new Float64Array(genome.nodes.length);
    this.outputScratch = new Array(this.outputSlots.length).fill(0);

    for (let i = 0; i < genome.nodes.length; i++) this.biases[i] = genome.nodes[i].bias;
    for (const conn of enabled) {
      const source = nodeById.get(conn.inNode)!.index;
      const target = nodeById.get(conn.outNode)!.index;
      this.incomingSources[target].push(source);
      this.incomingWeights[target].push(conn.weight);
    }
  }

  /** Fast, allocation-free activation. The returned array is reused by this network. */
  public activateFast(inputs: ArrayLike<number>): readonly number[] {
    if (inputs.length !== this.inputSlots.length) {
      throw new Error(`NEAT network expected ${this.inputSlots.length} inputs, received ${inputs.length}`);
    }

    const values = this.values;
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
      const clamped = sum < -20 ? -20 : sum > 20 ? 20 : sum;
      values[slot] = 2 / (1 + Math.exp(-4.9 * clamped)) - 1;
    }

    for (let i = 0; i < this.outputSlots.length; i++) this.outputScratch[i] = values[this.outputSlots[i]] || 0;
    return this.outputScratch;
  }

  /** Compatibility API for visual/debug code that may retain the returned values. */
  public activate(inputs: number[]): number[] {
    return Array.from(this.activateFast(inputs));
  }
}

function topologicalOrder(nodes: NodeGene[], connections: ConnectionGene[]): number[] {
  const indegree = new Map<number, number>(nodes.map(n => [n.id, 0]));
  const outgoing = new Map<number, number[]>();
  for (const conn of connections) {
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

  // Mutations explicitly prevent cycles. If imported data is cyclic, fail loudly instead of silently changing semantics.
  if (result.length !== nodes.length) throw new Error('Cannot compile NEAT genome: recurrent/cyclic connection detected');
  return result;
}

function pathExists(genome: NeatGenomeData, start: number, target: number): boolean {
  const outgoing = new Map<number, number[]>();
  for (const conn of genome.connections) {
    if (!conn.enabled) continue;
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
  if (Math.random() < config.weightMutationRate) mutateWeights(genome, config);
  if (Math.random() < config.addConnectionRate) addConnectionMutation(genome, tracker);
  if (Math.random() < config.addNodeRate) addNodeMutation(genome, tracker);
  if (Math.random() < config.toggleConnectionRate && genome.connections.length > 0) {
    const conn = genome.connections[Math.floor(Math.random() * genome.connections.length)];
    if (conn.enabled) {
      conn.enabled = false;
    } else if (!pathExists(genome, conn.outNode, conn.inNode)) {
      // Re-enabling a historical gene must not turn the feed-forward phenotype recurrent.
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

  for (let attempt = 0; attempt < 40; attempt++) {
    const from = sources[Math.floor(Math.random() * sources.length)];
    const to = targets[Math.floor(Math.random() * targets.length)];
    if (from.id === to.id) continue;
    if (genome.connections.some(c => c.inNode === from.id && c.outNode === to.id)) continue;
    // Adding from -> to is legal only if to cannot already reach from.
    if (pathExists(genome, to.id, from.id)) continue;

    genome.connections.push({
      innovation: tracker.getInnovation(from.id, to.id),
      inNode: from.id,
      outNode: to.id,
      weight: randomWeight(),
      enabled: true,
    });
    return true;
  }
  return false;
}

function addNodeMutation(genome: NeatGenomeData, tracker: InnovationTracker): boolean {
  const candidates = genome.connections.filter(c => c.enabled);
  if (candidates.length === 0) return false;
  const split = candidates[Math.floor(Math.random() * candidates.length)];
  split.enabled = false;

  const newNodeId = tracker.getNodeForSplit(split.innovation);
  if (!genome.nodes.some(n => n.id === newNodeId)) genome.nodes.push({ id: newNodeId, type: 'hidden', bias: 0 });
  genome.connections.push({
    innovation: tracker.getInnovation(split.inNode, newNodeId),
    inNode: split.inNode,
    outNode: newNodeId,
    weight: 1,
    enabled: true,
  });
  genome.connections.push({
    innovation: tracker.getInnovation(newNodeId, split.outNode),
    inNode: newNodeId,
    outNode: split.outNode,
    weight: split.weight,
    enabled: true,
  });
  return true;
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
    if (gene.enabled) {
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
    this.tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.compatibilityThreshold = config.compatibilityThreshold;
    for (let i = 0; i < config.populationSize; i++) {
      const genome = createMinimalGenome(`${role}_g1_${i}`, role, this.tracker, 1);
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
    this.tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.compatibilityThreshold = this.config.compatibilityThreshold;
    this.speciesCounter = 0;
    this.speciesRecords.clear();
    this.extinctSpeciesSinceLastEvolution = 0;
    this.genomes = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      this.genomes.push(createMinimalGenome(`${this.role}_g1_${i}`, this.role, this.tracker, 1));
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
      championNodes: champion.nodes.length,
      championConnections: champion.connections.filter(c => c.enabled).length,
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
