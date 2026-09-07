import type { LearningAgent } from '../learning/agent';

export type EpisodeController = Pick<LearningAgent, 'chooseActionInto' | 'resetState'>;

/** Deliberately simple, untrained controls. They expose mechanics; they are not champions. */
export function fixture(role: 'chaser' | 'evader', kind: 'idle' | 'run' | 'traverse'): EpisodeController {
  return {
    resetState() {},
    chooseActionInto(state, out) {
      const drive = kind === 'idle' ? 0 : role === 'chaser' ? (state[17] < 0 ? -1 : 1) : 1;
      const ledge = drive < 0 ? state[6] : state[7];
      const jump = kind === 'traverse' && state[3] > 0.5 && ledge < 0.08 ? 1 : 0;
      return Object.assign(out, {
        action: jump ? 'jump' : drive < 0 ? 'move_left' : drive > 0 ? 'move_right' : 'idle',
        actionIndex: jump ? 2 : drive < 0 ? 0 : drive > 0 ? 1 : -1,
        actionStrength: Math.max(Math.abs(drive), jump),
        moveLeft: Math.max(0, -drive), moveRight: Math.max(0, drive),
        horizontalDrive: drive, jump, sprint: 0, directionConflict: false,
      });
    },
  };
}
