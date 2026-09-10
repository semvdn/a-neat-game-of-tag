import { ACTION_SPACE, POLICY_CONTROL_ACTIVE_THRESHOLD, POLICY_OUTPUT_SPACE, STATE_VECTOR_SIZE } from '../constants';
import {
  InnovationTracker,
  NeatNetwork,
  cloneGenome,
  createMinimalGenome,
  type NeatGenomeData,
  type NeatRole,
  CURRENT_POLICY_ACTION_SCHEMA,
  type PolicyActionSchema,
} from './neat';

// Public persistence type for a NEAT policy genome.
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
  private actionSchema: PolicyActionSchema;
  public role: NeatRole;

  constructor(role: NeatRole = 'general', genome?: NeatGenomeData) {
    this.role = role;
    if (genome) {
      if (genome.actionSchema && genome.actionSchema !== CURRENT_POLICY_ACTION_SCHEMA) {
        throw new Error(`Unsupported policy action schema: ${String(genome.actionSchema)}.`);
      }
      this.genome = cloneGenome(genome);
      this.actionSchema = CURRENT_POLICY_ACTION_SCHEMA;
      this.genome.actionSchema = CURRENT_POLICY_ACTION_SCHEMA;
    } else {
      const tracker = new InnovationTracker(STATE_VECTOR_SIZE + POLICY_OUTPUT_SPACE.length);
      this.genome = createMinimalGenome(`${role}_runtime`, role, tracker, 1);
      this.actionSchema = CURRENT_POLICY_ACTION_SCHEMA;
    }
    this.network = new NeatNetwork(this.genome);
  }

  public resetWeights() {
    const tracker = new InnovationTracker(STATE_VECTOR_SIZE + POLICY_OUTPUT_SPACE.length);
    this.genome = createMinimalGenome(`${this.role}_runtime`, this.role, tracker, 1);
    this.actionSchema = CURRENT_POLICY_ACTION_SCHEMA;
    this.network = new NeatNetwork(this.genome);
  }

  public getWeights(): AgentWeights {
    return cloneGenome(this.genome);
  }

  public setWeights(weights: AgentWeights) {
    if (!weights || !Array.isArray(weights.nodes) || !Array.isArray(weights.connections)) {
      throw new Error('This build expects a NEAT genome.');
    }
    const inputCount = weights.nodes.filter(node => node.type === 'input').length;
    const outputCount = weights.nodes.filter(node => node.type === 'output').length;
    if (inputCount !== STATE_VECTOR_SIZE || outputCount !== POLICY_OUTPUT_SPACE.length) {
      throw new Error(
        `Incompatible NEAT genome: expected ${STATE_VECTOR_SIZE} inputs/${POLICY_OUTPUT_SPACE.length} outputs, ` +
        `received ${inputCount}/${outputCount}. Retrain this policy for the current world-relative sense layout.`
      );
    }
    if (weights.actionSchema && weights.actionSchema !== CURRENT_POLICY_ACTION_SCHEMA) {
      throw new Error(`Unsupported policy action schema: ${String(weights.actionSchema)}.`);
    }
    this.actionSchema = CURRENT_POLICY_ACTION_SCHEMA;
    this.genome = cloneGenome(weights);
    this.genome.actionSchema = CURRENT_POLICY_ACTION_SCHEMA;
    this.role = weights.role || this.role;
    this.network = new NeatNetwork(this.genome);
  }

  public getActionSchema(): PolicyActionSchema {
    return this.actionSchema;
  }

  public setGeneration(generation: number) {
    this.genome.generation = generation;
  }

  public exportJson(): string {
    return JSON.stringify({
      algorithm: 'NEAT',
      version: 2,
      actionSchema: this.actionSchema,
      role: this.role,
      generation: this.genome.generation,
      genome: this.getWeights(),
      timestamp: Date.now(),
    });
  }

  public importJson(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data?.algorithm === 'NEAT' && data?.actionSchema !== CURRENT_POLICY_ACTION_SCHEMA) {
        throw new Error('This policy uses an unsupported horizontal controller schema.');
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
      horizontalDrive: number;
      jump: number;
      sprint: number;
      directionConflict: boolean;
    },
    contextId = 0
  ): typeof out {
    const outputs = this.network.activateFast(state, contextId);
    // Horizontal control uses the phenotype's native symmetric [-1,+1] activation directly.
    const rawHorizontal = outputs[0] ?? 0;
    let horizontalDrive = Math.max(-1, Math.min(1, rawHorizontal));
    if (Math.abs(horizontalDrive) < POLICY_CONTROL_ACTIVE_THRESHOLD) horizontalDrive = 0;
    const moveLeft = horizontalDrive < 0 ? -horizontalDrive : 0;
    const moveRight = horizontalDrive > 0 ? horizontalDrive : 0;
    const jump = Math.max(0, Math.min(1, outputs[1] ?? 0));
    const sprint = Math.max(0, Math.min(1, outputs[2] ?? 0));

    out.moveLeft = moveLeft;
    out.moveRight = moveRight;
    out.horizontalDrive = horizontalDrive;
    out.jump = jump;
    out.sprint = sprint;
    out.directionConflict = false;

    // actionIndex refers to the runtime telemetry ACTION_SPACE (left/right/jump/sprint), not neural outputs.
    let actionIndex = -1;
    let strength = 0;
    if (moveLeft > strength) { actionIndex = 0; strength = moveLeft; }
    if (moveRight > strength) { actionIndex = 1; strength = moveRight; }
    if (jump > strength) { actionIndex = 2; strength = jump; }
    if (sprint > strength) { actionIndex = 3; strength = sprint; }
    out.actionIndex = strength >= POLICY_CONTROL_ACTIVE_THRESHOLD ? actionIndex : -1;
    out.action = out.actionIndex >= 0 ? ACTION_SPACE[out.actionIndex] : 'idle';
    out.actionStrength = strength;
    return out;
  }

  chooseAction(state: ArrayLike<number>, contextId = 0): {
    action: string;
    actionIndex: number;
    actionStrength: number;
    moveLeft: number;
    moveRight: number;
    horizontalDrive: number;
    jump: number;
    sprint: number;
    directionConflict: boolean;
  } {
    return this.chooseActionInto(state, {
      action: 'idle',
      actionIndex: -1,
      actionStrength: 0,
      moveLeft: 0,
      moveRight: 0,
      horizontalDrive: 0,
      jump: 0,
      sprint: 0,
      directionConflict: false,
    }, contextId);
  }

  public resetState(contextId?: number): void {
    this.network.resetState(contextId);
  }

}
