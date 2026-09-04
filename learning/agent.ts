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


export interface FastAgentControls {
  move: number;
  jump: number;
  sprint: number;
  actionIndex: number;
}

export interface AgentControls {
  /** Signed horizontal drive: -1 full left, +1 full right. */
  move: number;
  /** Requested jump power in [0, 1]. */
  jump: number;
  /** Requested sprint intensity in [0, 1]. */
  sprint: number;
  /** Raw NEAT output values, useful for diagnostics. */
  outputs: number[];
  /** Dominant output channel, kept for existing action-distribution diagnostics. */
  action: string;
  actionIndex: number;
  /** Human-readable composite control state used by visual reward telemetry. */
  label: string;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampSigned = (value: number) => Math.max(-1, Math.min(1, value));

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
        `Incompatible NEAT genome shape: expected ${STATE_VECTOR_SIZE} inputs and ${ACTION_SPACE.length} outputs, received ${inputCount} inputs and ${outputCount} outputs.`
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

  chooseControlsFast(state: ArrayLike<number>, target: FastAgentControls): FastAgentControls {
    const outputs = this.network.activateFast(state);
    const leftDrive = clamp01(outputs[0] || 0);
    const rightDrive = clamp01(outputs[1] || 0);
    target.move = clampSigned(rightDrive - leftDrive);
    target.jump = clamp01(outputs[2] || 0);
    target.sprint = clamp01(outputs[3] || 0);

    let actionIndex = 0;
    for (let i = 1; i < outputs.length; i++) if (outputs[i] > outputs[actionIndex]) actionIndex = i;
    target.actionIndex = actionIndex;
    return target;
  }

  chooseControls(state: number[]): AgentControls {
    const outputs = this.network.activate(state);
    const leftDrive = clamp01(outputs[0] || 0);
    const rightDrive = clamp01(outputs[1] || 0);
    const move = clampSigned(rightDrive - leftDrive);
    const jump = clamp01(outputs[2] || 0);
    const sprint = clamp01(outputs[3] || 0);

    let actionIndex = 0;
    for (let i = 1; i < outputs.length; i++) if (outputs[i] > outputs[actionIndex]) actionIndex = i;

    const direction = move > 0.1 ? 'right' : move < -0.1 ? 'left' : 'still';
    const jumping = jump > 0.15;
    const sprinting = sprint > 0.35 && Math.abs(move) > 0.1;
    let label = direction === 'still' ? 'wait' : `move_${direction}`;
    if (sprinting) label = `sprint_${direction}`;
    if (jumping) label = direction === 'still' ? 'jump' : `jump_${direction}`;

    return {
      move,
      jump,
      sprint,
      outputs,
      action: ACTION_SPACE[actionIndex],
      actionIndex,
      label,
    };
  }

  chooseAction(state: number[]): { action: string; actionIndex: number } {
    const controls = this.chooseControls(state);
    return { action: controls.action, actionIndex: controls.actionIndex };
  }

}
