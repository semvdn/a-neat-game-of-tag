import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'public', 'showcase', 'neat_tag_checkpoint_gen7422.json');
const outputPath = path.join(root, 'demo', 'public', 'showcase', 'showcase_pair_gen7422.json');
const CURRENT_POLICY_ACTION_SCHEMA = 'signed-horizontal-controls-v3';

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing bundled full checkpoint: ${path.relative(root, sourcePath)}`);
}

const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const checkpoint = payload?.evolutionCheckpoint;
const diagnostics = payload?.uiDiagnostics ?? {};
if (payload?.kind !== 'full-evolution-checkpoint' || !checkpoint) {
  throw new Error('Expected a full NEAT evolution checkpoint.');
}

const chaserGenome = diagnostics.showcaseChaserGenome ?? diagnostics.chaserChampionGenome ?? checkpoint.championChaser;
const runnerGenome = diagnostics.showcaseEvaderGenome ?? diagnostics.evaderChampionGenome ?? checkpoint.championEvader;
if (!chaserGenome?.nodes || !chaserGenome?.connections || !runnerGenome?.nodes || !runnerGenome?.connections) {
  throw new Error('Checkpoint does not contain a compatible showcase pair.');
}

const showcase = {
  format: 'neat-tag-showcase-pair',
  version: 1,
  sourceCheckpointGeneration: payload.generation ?? checkpoint.generation ?? 0,
  selectedAtGeneration: diagnostics.showcasePair?.selectedAtGeneration ?? payload.generation ?? checkpoint.generation ?? 0,
  // Must match DEFAULT_BIOME_WORLD_SEED in world/biomes.ts; kept numeric here so this Node-only
  // extraction script does not need a TypeScript runtime.
  worldSeed: 0x54414731,
  chaser: {
    id: chaserGenome.id,
    generation: diagnostics.showcasePair?.chaserGeneration ?? chaserGenome.generation ?? 0,
    genome: { ...chaserGenome, actionSchema: CURRENT_POLICY_ACTION_SCHEMA },
  },
  runner: {
    id: runnerGenome.id,
    generation: diagnostics.showcasePair?.runnerGeneration ?? runnerGenome.generation ?? 0,
    genome: { ...runnerGenome, actionSchema: CURRENT_POLICY_ACTION_SCHEMA },
  },
  activeUpgrades: {
    sprint: Boolean(diagnostics.sprintUpgradeActive),
    controlledJump: Boolean(diagnostics.controlledJumpUpgradeActive),
  },
  upgradeConfig: checkpoint.upgradeConfig,
  terrainVarietyConfig: diagnostics.terrainVarietyConfig ?? checkpoint.terrainVarietyConfig,
  pursuitDesign: diagnostics.pursuitDesign ?? null,
  showcaseMetrics: diagnostics.showcasePair ?? null,
  schema: {
    state: checkpoint.stateSchema ?? 'world-relative-senses-v3',
    action: CURRENT_POLICY_ACTION_SCHEMA,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const json = `${JSON.stringify(showcase)}\n`;
fs.writeFileSync(outputPath, json);
console.log(`Wrote ${path.relative(root, outputPath)} (${Buffer.byteLength(json).toLocaleString()} bytes)`);
console.log(`Pair: Chaser ${showcase.chaser.id} (g${showcase.chaser.generation}) + Runner ${showcase.runner.id} (g${showcase.runner.generation})`);
