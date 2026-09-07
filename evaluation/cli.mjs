import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';
import { LearningAgent } from '../learning/agent.ts';
import { runTrainingEpisode } from '../learning/trainingEpisode.ts';
import { BASELINE_PURSUIT_DESIGN } from '../learning/pursuitConfig.ts';
import { DEFAULT_TERRAIN_VARIETY_CONFIG } from '../learning/terrainConfig.ts';
import { fixture } from './fixtures.ts';
import { verifyEncounterAccounting } from './regressions.mjs';
import { verifyLandings } from './landingRegressions.mjs';
import { SPRINT_MAX_SPEED, SPRINT_ENERGY_COST_PER_SEC } from '../constants.ts';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
if (args.includes('--help')) {
  console.log('npm run evaluate -- [--seeds 8] [--checkpoint file.json] [--conditions file.json] [--out evaluations/report.json] [--verify] [--trace]');
  process.exit(0);
}
const allowed = new Set(['--seeds', '--checkpoint', '--conditions', '--out', '--verify', '--trace']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
  if (!['--verify', '--trace'].includes(args[i]) && (!args[++i] || args[i].startsWith('--'))) throw new Error('Missing argument value');
}
const seeds = Number(option('--seeds', 8));
if (args.includes('--verify')) verifyEncounterAccounting();
if (args.includes('--verify')) verifyLandings();
assert(Number.isInteger(seeds) && seeds >= 1 && seeds <= 1000, '--seeds must be 1..1000');
const modes = ['visual', 'varied', 'pressure_close', 'pressure_normal', 'pressure_long', 'midgame'];
const conditions = args.includes('--conditions') ? JSON.parse(await readFile(option('--conditions'), 'utf8')) : [
  { name: 'baseline' },
  { name: 'simple-terrain', terrainConfig: { trainingBranchingEnabled: false, trainingMovingPlatformsEnabled: false } },
  { name: 'slower-motion', terrainConfig: { movingPlatformMaxSpeed: 40 } },
];
assert(Array.isArray(conditions) && conditions.length > 0);
assert(new Set(conditions.map(c => c.name)).size === conditions.length, 'Condition names must be unique');
for (const c of conditions) {
  assert(typeof c.name === 'string' && c.name.length > 0);
  assert(Object.keys(c).every(k => ['name', 'terrainConfig', 'pursuitDesign', 'upgrades', 'fitness'].includes(k)), 'Unknown condition field');
  for (const [field, keys] of Object.entries({ terrainConfig: Object.keys(DEFAULT_TERRAIN_VARIETY_CONFIG), pursuitDesign: Object.keys(BASELINE_PURSUIT_DESIGN), fitness: ['runnerPaceTargetPxPerWindow', 'runnerPaceRewardPerWindow', 'chaserPursuitRewardPerPlatform'] })) {
    if (c[field]) assert(Object.keys(c[field]).every(k => keys.includes(k)), `Unknown ${field} setting in ${c.name}`);
  }
}
let source = 'untrained scripted controls';
let baseOptions = { pursuitDesign: { ...BASELINE_PURSUIT_DESIGN }, terrainConfig: { ...DEFAULT_TERRAIN_VARIETY_CONFIG } };
let pairs = [['traverse', 'traverse'], ['traverse', 'idle'], ['run', 'traverse'], ['idle', 'run']].map(([c, r]) => ({ name: `${c}/${r}`, chaser: fixture('chaser', c), runner: fixture('evader', r) }));
if (args.includes('--checkpoint')) {
  const payload = JSON.parse(await readFile(option('--checkpoint'), 'utf8'));
  const cp = payload.evolutionCheckpoint || payload;
  assert(cp.stateSchema === 'world-relative-senses-v3' && cp.actionSchema === 'signed-horizontal-controls-v2', 'Incompatible checkpoint schema');
  const chaser = new LearningAgent('chaser');
  const runner = new LearningAgent('evader');
  chaser.setWeights(cp.championChaser);
  runner.setWeights(cp.championEvader);
  const u = cp.upgradeConfig;
  const sprintOptions = (role, key) => u?.sprint?.[role]?.[key];
  baseOptions = {
    pursuitDesign: cp.pursuitDesign || { ...BASELINE_PURSUIT_DESIGN },
    terrainConfig: cp.terrainVarietyConfig || { ...DEFAULT_TERRAIN_VARIETY_CONFIG },
    ...cp.trainingFitnessConfig,
    upgrades: {
      sprint: u?.sprint?.mode === 'on', controlledJump: u?.controlledJump?.mode === 'on',
      sprintChaser: u?.sprint?.mode === 'on' && u.sprint.chaserEnabled,
      sprintRunner: u?.sprint?.mode === 'on' && u.sprint.runnerEnabled,
      controlledJumpChaser: u?.controlledJump?.mode === 'on' && u.controlledJump.chaserEnabled,
      controlledJumpRunner: u?.controlledJump?.mode === 'on' && u.controlledJump.runnerEnabled,
      ...Object.fromEntries(['chaser', 'runner'].flatMap(role => {
        const a = `${role}Advanced`;
        const label = role === 'chaser' ? 'Chaser' : 'Runner';
        return [[`sprint${label}MaxSpeed`, sprintOptions(a, 'maxSpeedOverride') ? sprintOptions(a, 'maxSpeed') : SPRINT_MAX_SPEED],
          [`sprint${label}StaminaCostPerSec`, sprintOptions(a, 'staminaCostOverride') ? sprintOptions(a, 'staminaCostPerSec') : SPRINT_ENERGY_COST_PER_SEC]];
      })),
    },
  };
  pairs = [{ name: 'checkpoint-champions', chaser, runner }];
  source = `checkpoint generation ${cp.generation}`;
}
const metrics = r => ({
  cleanTags: r.tags - r.tagsSoonAfterRunnerFall, tags: r.tags, evades: r.successfulEvades,
  chaserFalls: r.chaserFalls, runnerFalls: r.evaderFalls, escapes: r.chaserEscapes,
  pace: r.runnerPaceCompletion, distance: r.meanNearestRunnerDistancePx,
  near200: r.timeWithin200Ms / Math.max(1, r.elapsedMs),
  runnerLandings: r.runnerPlatformLandings, chaserLandings: r.chaserPlatformLandings,
  branchLandings: r.runnerBranchLandings + r.chaserBranchLandings,
  pressureBonus: r.runnerPressureEscapeFitnessBonus, elapsedMs: r.elapsedMs,
});
const rows = [];
const started = performance.now();
for (const condition of conditions) {
  const options = { ...baseOptions, ...condition.fitness,
    terrainConfig: { ...baseOptions.terrainConfig, ...condition.terrainConfig },
    pursuitDesign: { ...baseOptions.pursuitDesign, ...condition.pursuitDesign },
    ...(condition.upgrades ? { upgrades: { ...baseOptions.upgrades, ...condition.upgrades } } : {}),
    recordTrace: args.includes('--trace'), traceIntervalMs: 250,
  };
  for (const pair of pairs) for (const startMode of modes) for (let s = 0; s < seeds; s++) {
    const seed = (0x51a7 + s * 7919) >>> 0;
    const run = () => {
      const random = Math.random;
      if (args.includes('--verify')) Math.random = () => { throw new Error('Unseeded randomness in evaluation'); };
      try { return runTrainingEpisode(pair.chaser, pair.runner, seed, { ...options, startMode }); }
      finally { Math.random = random; }
    };
    const result = run();
    if (args.includes('--verify')) assert.deepEqual(run(), result, `Nondeterministic: ${condition.name}/${pair.name}/${startMode}/${seed}`);
    const values = metrics(result);
    assert(Object.values(values).every(Number.isFinite), 'Non-finite episode metric');
    rows.push({ condition: condition.name, pair: pair.name, startMode, seed, metrics: values, ...(result.trace ? { trace: result.trace } : {}) });
  }
  console.log(`Evaluated ${condition.name}: ${pairs.length * modes.length * seeds} episodes`);
}
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const summarize = group => Object.fromEntries(Object.keys(group[0].metrics).map(key => [key, mean(group.map(r => r.metrics[key]))]));
const baseline = rows.filter(r => r.condition === conditions[0].name);
const summary = conditions.map(c => {
  const group = rows.filter(r => r.condition === c.name);
  // Rows share pair/start/seed and order. Uncertainty is clustered by seed to avoid treating
  // correlated starts and policy pairs as independent evidence.
  const pairedDelta = Object.fromEntries(Object.keys(group[0].metrics).map(key => {
    const deltas = Array.from({ length: seeds }, (_, s) => mean(group.flatMap((r, i) => i % seeds === s ? [r.metrics[key] - baseline[i].metrics[key]] : [])));
    const m = mean(deltas);
    const se = seeds > 1 ? Math.sqrt(deltas.reduce((a, d) => a + (d - m) ** 2, 0) / (seeds - 1) / seeds) : null;
    return [key, { mean: m, seedStandardError: se }];
  }));
  return { condition: c.name, mean: summarize(group), byStart: Object.fromEntries(modes.map(mode => [mode, summarize(group.filter(r => r.startMode === mode))])), pairedDelta };
});
const report = { format: 'neat-tag-gameplay-lab-v1', source, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  gameplayObjectiveVersion: 'swept-landings-v11', stateSchema: 'world-relative-senses-v3', actionSchema: 'signed-horizontal-controls-v2',
  conditions, baseOptions, seeds, modes, verified: args.includes('--verify'), seconds: (performance.now() - started) / 1000,
  limitations: 'Fixed-policy mechanics comparison, not a training experiment or an aesthetic ranking. Report per-start results and inspect traces; do not promote defaults from a single aggregate.', summary, rows };
const out = option('--out', 'evaluations/report.json');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2));
console.table(summary.map(s => ({ condition: s.condition, ...Object.fromEntries(Object.entries(s.mean).map(([k, v]) => [k, +v.toFixed(3)])) })));
console.log(`Saved ${out} (${report.seconds.toFixed(1)}s)`);
