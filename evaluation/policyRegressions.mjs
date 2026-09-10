import assert from 'node:assert/strict';
import { LearningAgent } from '../learning/agent.ts';
import { STATE_VECTOR_SIZE } from '../constants.ts';

function neutralGenome(actionSchema) {
  const nodes = [];
  for (let i = 0; i < STATE_VECTOR_SIZE; i++) nodes.push({ id: i, type: 'input', bias: 0, depth: 0 });
  for (let i = 0; i < 3; i++) nodes.push({ id: STATE_VECTOR_SIZE + i, type: 'output', bias: 0, depth: 1 });
  return {
    id: actionSchema ? `neutral_${actionSchema}` : 'neutral_legacy',
    role: 'chaser',
    generation: 1,
    ...(actionSchema ? { actionSchema } : {}),
    nodes,
    connections: [],
  };
}

export function verifyPolicyDecoders() {
  const state = new Array(STATE_VECTOR_SIZE).fill(0);

  // Historical genomes did not carry a per-genome schema marker. They must continue to use the
  // exact v2 decoder so the generation-7422 showcase and old checkpoints remain reproducible.
  const legacy = new LearningAgent('chaser', neutralGenome());
  assert.equal(legacy.getActionSchema(), 'signed-horizontal-controls-v2');
  assert.equal(legacy.chooseAction(state).horizontalDrive, -1, 'Legacy v2 neutral activation must preserve its historical full-left decode');

  // New genomes are explicitly v3 and use the phenotype's native symmetric activation. A neutral
  // network therefore means neutral horizontal control rather than an artificial directional bias.
  const corrected = new LearningAgent('chaser', neutralGenome('signed-horizontal-controls-v3'));
  assert.equal(corrected.getActionSchema(), 'signed-horizontal-controls-v3');
  assert.equal(corrected.chooseAction(state).horizontalDrive, 0, 'v3 neutral activation must decode to neutral horizontal control');
  assert.equal(JSON.parse(corrected.exportJson()).actionSchema, 'signed-horizontal-controls-v3');

  console.log('Policy decoder regressions passed: legacy v2 compatibility and symmetric v3 control');
}
