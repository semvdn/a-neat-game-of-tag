import { LearningAgent } from '../learning/agent';
import { runTrainingEpisode, type TrainingStartMode } from '../learning/trainingEpisode';
import type { NeatGenomeData } from '../learning/neat';
import type { ActiveUpgradeState, TrainingFitnessConfig } from '../types';

interface ControllerEntry {
  key: string;
  role: 'chaser' | 'evader';
  genome: NeatGenomeData;
}

interface LoadEpochMessage {
  type: 'LOAD_EPOCH';
  payload: {
    epoch: number;
    controllers: ControllerEntry[];
    upgrades: ActiveUpgradeState;
    fitnessConfig: TrainingFitnessConfig;
  };
}

interface EvaluateBatchTask {
  taskId: number;
  chaserKey: string;
  evaderKey: string;
  seed: number;
  trackChaserActions: boolean;
  trackEvaderActions: boolean;
  startMode?: TrainingStartMode;
}

interface EvaluateBatchMessage {
  type: 'EVALUATE_BATCH';
  payload: {
    epoch: number;
    tasks: EvaluateBatchTask[];
  };
}

type WorkerMessage = LoadEpochMessage | EvaluateBatchMessage;

const controllers = new Map<string, LearningAgent>();
let loadedEpoch: number | null = null;
let loadedUpgrades: ActiveUpgradeState | undefined;
let loadedFitnessConfig: TrainingFitnessConfig | undefined;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  try {
    if (type === 'LOAD_EPOCH') {
      controllers.clear();
      for (const entry of payload.controllers) {
        controllers.set(entry.key, new LearningAgent(entry.role, entry.genome));
      }
      loadedEpoch = payload.epoch;
      loadedUpgrades = payload.upgrades;
      loadedFitnessConfig = payload.fitnessConfig;
      return;
    }

    if (type !== 'EVALUATE_BATCH') return;
    if (loadedEpoch !== payload.epoch) {
      throw new Error(`Evaluator epoch mismatch: loaded ${loadedEpoch}, requested ${payload.epoch}`);
    }

    const results = payload.tasks.map(task => {
      const chaser = controllers.get(task.chaserKey);
      const evader = controllers.get(task.evaderKey);
      if (!chaser || !evader) {
        throw new Error(`Missing preloaded controller for task ${task.taskId}`);
      }
      const result = runTrainingEpisode(chaser, evader, task.seed, {
        trackChaserActions: task.trackChaserActions,
        trackEvaderActions: task.trackEvaderActions,
        upgrades: loadedUpgrades,
        startMode: task.startMode,
        runnerExplorationRewardPerViewport: loadedFitnessConfig?.runnerExplorationRewardPerViewport,
      });
      return { taskId: task.taskId, result };
    });

    self.postMessage({
      type: 'BATCH_RESULT',
      payload: {
        epoch: payload.epoch,
        results,
      },
    });
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      payload: {
        epoch: payload.epoch,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
