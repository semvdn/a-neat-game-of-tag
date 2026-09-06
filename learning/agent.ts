import { ACTION_SPACE, POLICY_CONTROL_ACTIVE_THRESHOLD, STATE_VECTOR_SIZE } from '../constants';
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
    const inputCount = weights.nodes.filter(node => node.type === 'input').length;
    const outputCount = weights.nodes.filter(node => node.type === 'output').length;
    if (inputCount !== STATE_VECTOR_SIZE || outputCount !== ACTION_SPACE.length) {
      throw new Error(
        `Incompatible NEAT genome: expected ${STATE_VECTOR_SIZE} inputs/${ACTION_SPACE.length} outputs, ` +
        `received ${inputCount}/${outputCount}. Reset or retrain this older policy for the compact sense layout.`
      );
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
      version: 2,
      actionSchema: 'factorized-controls-v1',
      role: this.role,
      generation: this.genome.generation,
      genome: this.getWeights(),
      timestamp: Date.now(),
    });
  }

  public importJson(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data?.algorithm === 'NEAT' && data?.actionSchema !== 'factorized-controls-v1') {
        throw new Error('This policy predates the factorized movement+jump controller and cannot be imported safely.');
      }
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

  chooseActionInto(
    state: ArrayLike<number>,
    out: {
      action: string;
      actionIndex: number;
      actionStrength: number;
      moveLeft: number;
      moveRight: number;
      jump: number;
      sprint: number;
    },
    contextId = 0
  ): typeof out {
    const outputs = this.network.activateFast(state, contextId);
    // Factorized controls: positive output activation independently drives each control.
    // Left/right may be held while jump is active, which makes ordinary platforming evolvable.
    const moveLeft = Math.max(0, Math.min(1, outputs[0] ?? 0));
    const moveRight = Math.max(0, Math.min(1, outputs[1] ?? 0));
    const jump = Math.max(0, Math.min(1, outputs[2] ?? 0));
    const sprint = Math.max(0, Math.min(1, outputs[3] ?? 0));

    out.moveLeft = moveLeft;
    out.moveRight = moveRight;
    out.jump = jump;
    out.sprint = sprint;

    let actionIndex = 0;
    let strength = moveLeft;
    if (moveRight > strength) { actionIndex = 1; strength = moveRight; }
    if (jump > strength) { actionIndex = 2; strength = jump; }
    if (sprint > strength) { actionIndex = 3; strength = sprint; }
    out.actionIndex = strength >= POLICY_CONTROL_ACTIVE_THRESHOLD ? actionIndex : -1;
    out.action = out.actionIndex >= 0 ? ACTION_SPACE[actionIndex] : 'idle';
    out.actionStrength = strength;
    return out;
  }

  chooseAction(state: ArrayLike<number>, contextId = 0): {
    action: string;
    actionIndex: number;
    actionStrength: number;
    moveLeft: number;
    moveRight: number;
    jump: number;
    sprint: number;
  } {
    return this.chooseActionInto(state, {
      action: 'idle',
      actionIndex: -1,
      actionStrength: 0,
      moveLeft: 0,
      moveRight: 0,
      jump: 0,
      sprint: 0,
    }, contextId);
  }

  public resetState(contextId?: number): void {
    this.network.resetState(contextId);
  }

}
