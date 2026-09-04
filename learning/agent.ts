import { ACTION_SPACE, STATE_VECTOR_SIZE } from '../constants';
import {
  InnovationTracker,
  NeatNetwork,
  cloneGenome,
  createMinimalGenome,
  type NeatGenomeData,
  type NeatRole,
} from './neat';

// Kept as an alias so the existing App persistence/worker plumbing needs only a small migration.
export type AgentWeights = NeatGenomeData;

/**
 * Runtime phenotype wrapper for a NEAT genome.
 *
 * Learning intentionally does NOT happen here. Evolution is population-level and is owned by
 * trainingWorker.ts. Keeping this class lets the visual simulation consume the latest champion through
 * the same chooseAction/getWeights persistence surface used elsewhere in the app.
 */
export class LearningAgent {
  private genome: NeatGenomeData;
  private network: NeatNetwork;
  public role: NeatRole;

  constructor(role: NeatRole = 'general', genome?: NeatGenomeData) {
    this.role = role;
    if (genome) {
      this.genome = cloneGenome(genome);
    } else {
      const tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
      this.genome = createMinimalGenome(`${role}_runtime`, role, tracker, 1);
    }
    this.network = new NeatNetwork(this.genome);
  }

  public resetWeights() {
    const tracker = new InnovationTracker(STATE_VECTOR_SIZE + ACTION_SPACE.length);
    this.genome = createMinimalGenome(`${this.role}_runtime`, this.role, tracker, 1);
    this.network = new NeatNetwork(this.genome);
  }

  public getWeights(): AgentWeights {
    return cloneGenome(this.genome);
  }

  public setWeights(weights: AgentWeights) {
    if (!weights || !Array.isArray(weights.nodes) || !Array.isArray(weights.connections)) {
      throw new Error('This build expects a NEAT genome. Legacy PPO weight files are not directly compatible.');
    }
    this.genome = cloneGenome(weights);
    this.role = weights.role || this.role;
    this.network = new NeatNetwork(this.genome);
  }

  public setGeneration(generation: number) {
    this.genome.generation = generation;
  }

  public exportJson(): string {
    return JSON.stringify({
      algorithm: 'NEAT',
      version: 1,
      role: this.role,
      generation: this.genome.generation,
      genome: this.getWeights(),
      timestamp: Date.now(),
    });
  }

  public importJson(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      const genome = data.genome || (data.nodes && data.connections ? data : null);
      if (!genome) return false;
      this.setWeights(genome);
      return true;
    } catch (error) {
      console.error('Failed to parse NEAT agent JSON:', error);
      return false;
    }
  }

  public clone(): LearningAgent {
    return new LearningAgent(this.role, this.genome);
  }

  public getGeneration(): number {
    return this.genome.generation || 0;
  }

  chooseAction(state: number[]): { action: string; actionIndex: number } {
    const outputs = this.network.activate(state);
    let actionIndex = 0;
    for (let i = 1; i < outputs.length; i++) if (outputs[i] > outputs[actionIndex]) actionIndex = i;
    return { action: ACTION_SPACE[actionIndex], actionIndex };
  }

}
