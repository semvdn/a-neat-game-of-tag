import { LearningAgent } from '../learning/agent';
import { runTrainingEpisode } from '../learning/trainingEpisode';
import type { NeatGenomeData } from '../learning/neat';

interface EvaluateMessage {
  type: 'EVALUATE';
  payload: {
    taskId: number;
    epoch: number;
    chaserGenome: NeatGenomeData;
    evaderGenome: NeatGenomeData;
    seed: number;
    trackChaserActions: boolean;
    trackEvaderActions: boolean;
  };
}

const controllerCache = new Map<string, LearningAgent>();
const MAX_CACHE_SIZE = 256;
let cachedEpoch: number | null = null;

function cacheKey(role: 'chaser' | 'evader', genome: NeatGenomeData): string {
  return `${role}:${genome.id}:${genome.generation}:${genome.nodes.length}:${genome.connections.length}`;
}

function getController(role: 'chaser' | 'evader', genome: NeatGenomeData): LearningAgent {
  const key = cacheKey(role, genome);
  const cached = controllerCache.get(key);
  if (cached) return cached;
  const controller = new LearningAgent(role, genome);
  controllerCache.set(key, controller);
  if (controllerCache.size > MAX_CACHE_SIZE) {
    const firstKey = controllerCache.keys().next().value as string | undefined;
    if (firstKey) controllerCache.delete(firstKey);
  }
  return controller;
}

self.onmessage = (event: MessageEvent<EvaluateMessage>) => {
  const { type, payload } = event.data;
  if (type !== 'EVALUATE') return;

  try {
    if (cachedEpoch !== payload.epoch) {
      controllerCache.clear();
      cachedEpoch = payload.epoch;
    }
    const chaser = getController('chaser', payload.chaserGenome);
    const evader = getController('evader', payload.evaderGenome);
    const result = runTrainingEpisode(chaser, evader, payload.seed, {
      trackChaserActions: payload.trackChaserActions,
      trackEvaderActions: payload.trackEvaderActions,
    });
    self.postMessage({
      type: 'RESULT',
      payload: {
        taskId: payload.taskId,
        epoch: payload.epoch,
        result,
      },
    });
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      payload: {
        taskId: payload.taskId,
        epoch: payload.epoch,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
