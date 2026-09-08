import { build } from 'esbuild';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Isolated instrumentation of the real worker, not an alternative evolutionary algorithm.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/train-experiment.mjs [--ref commit] [--condition baseline|separate-validation|pace3|compact|separate-pace8|compact-chaser|cohesion-off|cohesion-penalty|cohesion-pace] [--seed 101] [--generations 12] [--out new-directory] [--verify]');
  process.exit(0);
}
const allowed = new Set(['--ref', '--condition', '--seed', '--generations', '--out', '--verify']);
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
  if (args[i] !== '--verify' && (!args[++i] || args[i].startsWith('--'))) throw new Error('Missing argument value');
}
const get = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const condition = get('--condition', 'baseline');
const seed = Number(get('--seed', 101));
const generations = Number(get('--generations', 12));
const sourceRef = get('--ref', null);
const revision = execFileSync('git', ['rev-parse', '--verify', `${sourceRef || 'HEAD'}^{commit}`], { encoding: 'utf8' }).trim();
const out = resolve(get('--out', `evaluations/training/${condition}-${seed}`));
if (!['baseline', 'separate-validation', 'pace3', 'compact', 'separate-pace8', 'compact-chaser', 'cohesion-off', 'cohesion-penalty', 'cohesion-pace'].includes(condition)) throw new Error('Unknown condition');
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isInteger(generations) || generations < 1) throw new Error('Invalid seed or generations');
await mkdir(out, { recursive: true });
if ((await readdir(out)).some(name => /^generation-\d+\.json$/.test(name))) throw new Error('Output contains checkpoints; choose a fresh --out directory');
const changes = [];
const result = await build({
  entryPoints: ['workers/trainingWorker.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'experiment-instrumentation', setup(builder) {
    builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
      const repoPath = relative(process.cwd(), path).replaceAll('\\', '/');
      let source = sourceRef
        ? execFileSync('git', ['show', `${revision}:${repoPath}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
        : await readFile(path, 'utf8');
      if (repoPath === 'learning/trainingEpisode.ts' && ['cohesion-off', 'cohesion-penalty'].includes(condition) && !source.includes('cohesionPaceWeight')) {
        const changesToEpisode = [
          ['  let cohesionRunnerDistance = 0, cohesionDiameter = 0, cohesionSamples = 0;', '  let cohesionWindowCost = 0, cohesionWindowSamples = 0;\n  let cohesionRunnerDistance = 0, cohesionDiameter = 0, cohesionSamples = 0;'],
          ['    cohesionSamples++;', '    cohesionSamples++;\n    cohesionWindowCost += cohesion.runnerCost;\n    cohesionWindowSamples++;'],
          ['      runnerPaceFitnessBonus += completion * runnerPaceRewardPerWindow;', '      runnerPaceFitnessBonus += completion * runnerPaceRewardPerWindow * (1 - cohesionWindowCost / Math.max(1, cohesionWindowSamples));\n      cohesionWindowCost = 0;\n      cohesionWindowSamples = 0;'],
        ];
        for (const [to, from] of changesToEpisode) {
          if (source.split(from).length !== 2) throw new Error('Source changed: cohesion pace gate');
          source = source.replace(from, to);
        }
        changes.push('Disable pace qualification by group cohesion; retain the original pace reward');
      }
      if (repoPath === 'learning/groupCohesion.ts' && condition === 'cohesion-off' && !source.includes('sanitizeCohesionShaping')) {
        if (source.split('penaltyCap: 6').length !== 2) throw new Error('Source changed: cohesion cap');
        source = source.replace('penaltyCap: 6', 'penaltyCap: 0');
        changes.push('Disable only cohesion fitness penalty, retaining solid bodies and universal surfaces');
      }
      if (repoPath !== 'workers/trainingWorker.ts') return { contents: source, loader: 'ts' };
      const replace = (from, to, label) => {
        if (source.split(from).length !== 2) throw new Error(`Source changed: ${label}`);
        source = source.replace(from, to); changes.push(label);
      };
      if (['separate-validation', 'separate-pace8', 'compact-chaser'].includes(condition)) replace(
        '  population.genomes[winner.index].fitness = maxRawFitness + 1e-6;',
        '  // Experiment: held-out ordering does not overwrite breeding fitness.',
        'Remove validation fitness overwrite'
      );
      if (condition === 'compact') replace(
        'let networkArchitecture: NetworkArchitectureSuiteConfig = sanitizeNetworkArchitectureSuite(DEFAULT_NETWORK_ARCHITECTURE_SUITE);',
        "let networkArchitecture: NetworkArchitectureSuiteConfig = sanitizeNetworkArchitectureSuite({ linkedRoles: true, chaser: NETWORK_ARCHITECTURE_PRESETS.compact, runner: NETWORK_ARCHITECTURE_PRESETS.compact });",
        'Use the complete public Compact 12 architecture preset for both roles'
      );
      if (condition === 'compact-chaser') replace(
        'let networkArchitecture: NetworkArchitectureSuiteConfig = sanitizeNetworkArchitectureSuite(DEFAULT_NETWORK_ARCHITECTURE_SUITE);',
        "let networkArchitecture: NetworkArchitectureSuiteConfig = sanitizeNetworkArchitectureSuite({ linkedRoles: false, chaser: NETWORK_ARCHITECTURE_PRESETS.compact, runner: DEFAULT_NETWORK_ARCHITECTURE_SUITE.runner });",
        'Use Compact 12 for Chaser while retaining the normal Runner architecture'
      );
      if (args.includes('--verify')) {
        replace("  const chaserValidated = validateChampionCandidates('chaser', evaluatedGeneration);",
          "  const labBreedingFitness = [...chaserPopulation.genomes, ...evaderPopulation.genomes].map(g => g.fitness);\n  const chaserValidated = validateChampionCandidates('chaser', evaluatedGeneration);", 'Capture fitness before validation');
        replace("  const evaderValidated = validateChampionCandidates('evader', evaluatedGeneration);",
          "  const evaderValidated = validateChampionCandidates('evader', evaluatedGeneration);\n  [...chaserPopulation.genomes, ...evaderPopulation.genomes].forEach((g, i) => { if (g.fitness !== labBreedingFitness[i]) throw new Error('Validation changed breeding fitness'); });", 'Assert validation preserves all breeding fitness');
      }
      replace('  latestSafeCheckpoint = buildEvolutionCheckpoint(0);',
        "  latestSafeCheckpoint = buildEvolutionCheckpoint(0);\n  self.postMessage({ type: 'LAB_BOUNDARY', payload: checkpointWithRecentAnalysis(latestSafeCheckpoint, 2000) });",
        'Observe completed-generation checkpoint boundary');
      return { contents: source, loader: 'ts' };
    });
  } }],
});
const workerPath = resolve(out, 'worker.mjs');
await writeFile(workerPath, result.outputFiles[0].contents);
const metadata = { condition, seed, generations, changes, revision, sourceRef,
  runtime: process.version,
  startOverrides: condition === 'cohesion-off' ? { cohesionPenaltyCap: 0, cohesionPaceWeight: 0 }
    : condition === 'cohesion-penalty' ? { cohesionPaceWeight: 0 }
    : condition === 'pace3' ? { runnerPaceRewardPerWindow: 3 }
    : condition === 'separate-pace8' ? { runnerPaceRewardPerWindow: 8 } : {},
  workingTreeDirty: !sourceRef && !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  bundleSha256: createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),
  note: 'Real worker, CPU fallback, 48 genomes per role, seeded initialization/reproduction; wall-time telemetry is not deterministic.' };
await writeFile(resolve(out, 'experiment.json'), JSON.stringify(metadata, null, 2));
const child = spawn(process.execPath, [fileURLToPath(new URL('../evaluation/trainWorkerHost.mjs', import.meta.url)), workerPath, out, String(seed), String(generations), condition], { stdio: 'inherit' });
process.exitCode = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('exit', code => resolveExit(code ?? 1)); });
