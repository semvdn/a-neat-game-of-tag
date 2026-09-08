import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { LearningAgent } from '../learning/agent.ts';
import { runTrainingEpisode } from '../learning/trainingEpisode.ts';
import { BASELINE_PURSUIT_DESIGN } from '../learning/pursuitConfig.ts';
import { DEFAULT_TERRAIN_VARIETY_CONFIG } from '../learning/terrainConfig.ts';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const allowed = new Set(['--root', '--conditions', '--seeds', '--generations', '--evaluation-seeds', '--out']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
  if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing argument value');
}
const get = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = resolve(get('--root', 'evaluations/training'));
const conditions = get('--conditions', 'baseline,separate-validation,pace3').split(',');
const seeds = get('--seeds', '101,202,303').split(',').map(Number);
const generations = get('--generations', '4,8,12').split(',').map(Number);
const evaluationSeeds = Number(get('--evaluation-seeds', 3));
if (![evaluationSeeds, ...generations].every(n => Number.isInteger(n) && n > 0) || !seeds.every(n => Number.isInteger(n) && n >= 0)) throw new Error('Invalid generations or seeds');
if (generations.some((g, i) => i > 0 && g <= generations[i - 1])) throw new Error('Generations must be unique and increasing; the last checkpoint defines the opponent bank');
if (new Set(conditions).size !== conditions.length || conditions.some(c => !c.trim()) || new Set(seeds).size !== seeds.length) throw new Error('Conditions and seeds must be nonempty and unique');
const modes = ['visual', 'varied', 'pressure_close', 'pressure_normal', 'pressure_long', 'midgame'];
const runs = [];
for (const condition of conditions) for (const seed of seeds) {
  const path = resolve(root, `${condition}-${seed}`);
  const meta = JSON.parse(await readFile(resolve(path, 'experiment.json'), 'utf8'));
  const checkpoints = [];
  for (const generation of generations) checkpoints.push(JSON.parse(await readFile(resolve(path, `generation-${generation}.json`), 'utf8')));
  const history = JSON.parse(await readFile(resolve(path, 'history.json'), 'utf8'));
  runs.push({ condition, seed, meta, checkpoints, history });
}
const controller = (role, genome) => new LearningAgent(role, genome);
// One frozen, symmetric panel built from every condition's final retained opponents. Every
// candidate (including earlier checkpoints) faces this same panel on unused scenario seeds.
const panel = runs.map(r => ({ id: `${r.condition}-${r.seed}`, chaser: r.checkpoints.at(-1).championChaser, runner: r.checkpoints.at(-1).championEvader }));
const opponents = panel.map(p => ({ id: p.id, chaser: controller('chaser', p.chaser), runner: controller('evader', p.runner) }));
const options = { pursuitDesign: BASELINE_PURSUIT_DESIGN, terrainConfig: DEFAULT_TERRAIN_VARIETY_CONFIG, trackChaserActions: false, trackEvaderActions: false };
const rows = [];
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const summarize = xs => Object.fromEntries(Object.keys(xs[0]).map(k => [k, mean(xs.map(x => x[k]))]));
for (const run of runs) for (let i = 0; i < generations.length; i++) {
  const cp = run.checkpoints[i];
  for (const role of ['chaser', 'runner']) {
    const candidate = controller(role === 'chaser' ? 'chaser' : 'evader', role === 'chaser' ? cp.championChaser : cp.championEvader);
    const results = [];
    for (const opponent of opponents) for (const startMode of modes) for (let s = 0; s < evaluationSeeds; s++) {
      const result = runTrainingEpisode(role === 'chaser' ? candidate : opponent.chaser, role === 'runner' ? candidate : opponent.runner, (0xb700001 + s * 104729) >>> 0, { ...options, startMode });
      results.push({ startMode, opponent: opponent.id, metrics: {
        runnerSeparation: result.groupCohesion.meanRunnerDistancePx, groupDiameter: result.groupCohesion.meanGroupDiameterPx,
        cleanTags: result.tags - result.tagsSoonAfterRunnerFall,
        ownFalls: role === 'chaser' ? result.chaserFalls : result.evaderFalls,
        escapes: result.chaserEscapes, pace: result.runnerPaceCompletion,
        distance: result.meanNearestRunnerDistancePx, near200: result.timeWithin200Ms / Math.max(1, result.elapsedMs),
        landings: role === 'chaser' ? result.chaserPlatformLandings : result.runnerPlatformLandings,
        branchLandings: role === 'chaser' ? result.chaserBranchLandings : result.runnerBranchLandings,
        evades: result.successfulEvades, duration: result.elapsedMs,
      } });
    }
    rows.push({ condition: run.condition, seed: run.seed, generation: generations[i], role, championGeneration: candidate.getGeneration(), matches: results.length,
      mean: summarize(results.map(r => r.metrics)), byStart: Object.fromEntries(modes.map(mode => [mode, summarize(results.filter(r => r.startMode === mode).map(r => r.metrics))])) });
  }
  console.log(`Cross-play ${run.condition} seed ${run.seed} generation ${generations[i]}`);
}
const summary = [];
for (const condition of conditions) for (const generation of generations) for (const role of ['chaser', 'runner']) {
  const selected = rows.filter(r => r.condition === condition && r.generation === generation && r.role === role);
  summary.push({ condition, generation, role, mean: summarize(selected.map(r => r.mean)) });
}
const histories = runs.map(r => ({ condition: r.condition, seed: r.seed, rows: r.history.map(h => ({ generation: h.generation, balance: h.balance, benchmark: h.benchmark,
  chaser: { species: h.chaserMetrics.speciesCount, hidden: h.chaserMetrics.averageHiddenNodes, recurrent: h.chaserMetrics.averageRecurrentConnections },
  runner: { species: h.runnerMetrics.speciesCount, hidden: h.runnerMetrics.averageHiddenNodes, recurrent: h.runnerMetrics.averageRecurrentConnections },
  generalists: h.generalistChampions })) }));
const out = resolve(get('--out', 'evaluations/training-comparison.json'));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ conditions, seeds, generations, evaluationSeeds, modes, panelIds: panel.map(p => p.id), panelSha256: createHash('sha256').update(JSON.stringify(panel)).digest('hex'),
  options, experiments: runs.map(r => r.meta), rows, summary, histories,
  limitation: 'Real short-run evolution; common cross-play opponents include retained policies seen during training. Only scenario seeds are held out. No claim of long-run convergence.' }, null, 2));
console.table(summary.map(r => ({ condition: r.condition, generation: r.generation, role: r.role, ...Object.fromEntries(Object.entries(r.mean).map(([k,v]) => [k, +v.toFixed(3)])) })));
console.log(`Saved ${out}`);
