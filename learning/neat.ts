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

export interface NeatGenerationMetrics {
  role: 'chaser' | 'evader';
  generation: number;
  bestFitness: number;
  averageFitness: number;
  minFitness: number;
  speciesCount: number;
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

  constructor(public readonly role: 'chaser' | 'evader', public readonly config: NeatConfig = { ...DEFAULT_NEAT_CONFIG }) {
    this.tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.compatibilityThreshold = config.compatibilityThreshold;
    for (let i = 0; i < config.populationSize; i++) {
      const genome = createMinimalGenome(`${role}_g1_${i}`, role, this.tracker, 1);
      // Initial diversity is weight-level; topology starts minimal as in canonical NEAT.
      this.genomes.push(genome);
    }
  }

  public reset() {
    this.generation = 1;
    this.tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.compatibilityThreshold = this.config.compatibilityThreshold;
    this.speciesCounter = 0;
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
    this.generation = Math.max(1, champion.generation || 1);
    this.genomes = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      const clone = cloneGenome(champion, `${this.role}_g${this.generation}_${i}`);
      clone.role = this.role;
      clone.fitness = 0;
      if (i > 0) mutateGenome(clone, this.tracker, this.config);
      this.genomes.push(clone);
    }
  }

  private speciate(): Species[] {
    const species: Species[] = [];
    for (const genome of this.genomes) {
      let assigned: Species | undefined;
      for (const candidate of species) {
        if (compatibilityDistance(genome, candidate.representative, { ...this.config, compatibilityThreshold: this.compatibilityThreshold }) < this.compatibilityThreshold) {
          assigned = candidate;
          break;
        }
      }
      if (!assigned) {
        assigned = { id: ++this.speciesCounter, representative: cloneGenome(genome), members: [] };
        species.push(assigned);
      }
      genome.speciesId = assigned.id;
      assigned.members.push(genome);
    }

    if (species.length > this.config.targetSpecies + 1) this.compatibilityThreshold = Math.min(10, this.compatibilityThreshold + 0.15);
    else if (species.length < this.config.targetSpecies - 1) this.compatibilityThreshold = Math.max(0.5, this.compatibilityThreshold - 0.15);
    return species;
  }

  public evolve(): { metrics: NeatGenerationMetrics; champion: NeatGenomeData } {
    if (this.genomes.some(g => !Number.isFinite(g.fitness))) throw new Error(`Cannot evolve ${this.role}: every genome needs a finite fitness`);

    const species = this.speciate();
    const sorted = [...this.genomes].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
    const champion = cloneGenome(sorted[0], `${this.role}_champion_g${this.generation}`);

    const fitnesses = this.genomes.map(g => g.fitness ?? 0);
    const metrics: NeatGenerationMetrics = {
      role: this.role,
      generation: this.generation,
      bestFitness: Math.max(...fitnesses),
      averageFitness: fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length,
      minFitness: Math.min(...fitnesses),
      speciesCount: species.length,
      averageNodes: this.genomes.reduce((s, g) => s + g.nodes.length, 0) / this.genomes.length,
      averageConnections: this.genomes.reduce((s, g) => s + g.connections.filter(c => c.enabled).length, 0) / this.genomes.length,
      championNodes: champion.nodes.length,
      championConnections: champion.connections.filter(c => c.enabled).length,
      compatibilityThreshold: this.compatibilityThreshold,
      timestamp: Date.now(),
    };

    const speciesScore = (s: Species) => {
      const mean = s.members.reduce((sum, g) => sum + Math.max(0, g.fitness ?? 0), 0) / s.members.length;
      return mean + 1e-6;
    };

    const nextGeneration = this.generation + 1;
    const next: NeatGenomeData[] = [];

    // Preserve a global champion and one elite from every substantial species.
    const globalElite = cloneGenome(champion, `${this.role}_g${nextGeneration}_0`);
    globalElite.generation = nextGeneration;
    globalElite.fitness = 0;
    globalElite.speciesId = undefined;
    next.push(globalElite);
    const speciesByBest = [...species].sort(
      (a, b) => Math.max(...b.members.map(g => g.fitness ?? 0)) - Math.max(...a.members.map(g => g.fitness ?? 0))
    );
    for (const s of speciesByBest) {
      if (next.length >= this.config.populationSize) break;
      if (s.members.length < this.config.elitismMinSpeciesSize) continue;
      const elite = [...s.members].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0))[0];
      if (elite.id === champion.id) continue;
      const eliteClone = cloneGenome(elite, `${this.role}_g${nextGeneration}_${next.length}`);
      eliteClone.generation = nextGeneration;
      eliteClone.fitness = 0;
      eliteClone.speciesId = undefined;
      next.push(eliteClone);
    }

    while (next.length < this.config.populationSize) {
      const selectedSpecies = roulette(species, speciesScore);
      const parentA = tournament(selectedSpecies.members, this.config.tournamentSize);
      let child: NeatGenomeData;

      if (Math.random() < this.config.crossoverRate) {
        let parentB: NeatGenomeData;
        if (Math.random() < this.config.interspeciesMatingRate && species.length > 1) {
          const otherSpecies = roulette(species.filter(s => s.id !== selectedSpecies.id), speciesScore);
          parentB = tournament(otherSpecies.members, this.config.tournamentSize);
        } else {
          parentB = tournament(selectedSpecies.members, this.config.tournamentSize);
        }
        child = crossover(parentA, parentB, `${this.role}_g${nextGeneration}_${next.length}`, nextGeneration);
      } else {
        child = cloneGenome(parentA, `${this.role}_g${nextGeneration}_${next.length}`);
        child.generation = nextGeneration;
        child.fitness = 0;
      }

      mutateGenome(child, this.tracker, this.config);
      child.fitness = 0;
      child.speciesId = undefined;
      next.push(child);
    }

    this.genomes = next;
    this.generation = nextGeneration;
    return { metrics, champion };
  }
}
