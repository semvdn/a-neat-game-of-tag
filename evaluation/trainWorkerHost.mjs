import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [bundle, out, seedString, generationsString, condition] = process.argv.slice(2);
let seed = Number(seedString) >>> 0;
const generations = Number(generationsString);
Math.random = () => {
  let t = seed = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
let started = false;
const startTime = performance.now();
const warn = console.warn;
console.warn = (...values) => {
  if (String(values[0]).startsWith('Parallel evaluator pool unavailable;')) console.log('Experiment backend: production single-worker CPU fallback');
  else warn(...values);
};
globalThis.self = {
  onmessage: null,
  postMessage(message) {
    if (message.type !== 'LAB_BOUNDARY' || !started) return;
    const cp = message.payload;
    const completed = cp.lastChaserMetrics?.generation ?? 0;
    if (completed === 0) return;
    console.log(`${condition} seed ${seedString}: generation ${completed}/${generations}, ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
    writeFileSync(resolve(out, 'history.json'), JSON.stringify(cp.telemetry.analysisHistory, null, 2));
    if (completed % 4 === 0 || completed === generations) {
      writeFileSync(resolve(out, `generation-${completed}.json`), JSON.stringify(cp));
    }
    if (completed >= generations) process.exit(0);
  },
};
await import(pathToFileURL(bundle).href);
const payload = {};
if (condition === 'cohesion-off') payload.trainingFitnessConfig = { cohesionPenaltyCap: 0, cohesionPaceWeight: 0 };
if (condition === 'cohesion-penalty') payload.trainingFitnessConfig = { cohesionPaceWeight: 0 };
if (condition === 'pace3') payload.trainingFitnessConfig = { runnerPaceRewardPerWindow: 3 };
if (condition === 'separate-pace8') payload.trainingFitnessConfig = { runnerPaceRewardPerWindow: 8 };
started = true;
self.onmessage({ data: { type: 'START', payload } });
