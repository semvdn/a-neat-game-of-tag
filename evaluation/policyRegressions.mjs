import assert from 'node:assert/strict';
import { LearningAgent } from '../learning/agent.ts';
import { STATE_VECTOR_SIZE } from '../constants.ts';

function neutralGenome(actionSchema = 'signed-horizontal-controls-v3') {
  const nodes = [];
  for (let i = 0; i < STATE_VECTOR_SIZE; i++) nodes.push({ id: i, type: 'input', bias: 0, depth: 0 });
  for (let i = 0; i < 3; i++) nodes.push({ id: STATE_VECTOR_SIZE + i, type: 'output', bias: 0, depth: 1 });
  return {
    id: `neutral_${actionSchema}`,
    role: 'chaser',
    generation: 1,
    actionSchema,
    nodes,
    connections: [],
  };
}

export function verifyPolicyDecoders() {
  const state = new Array(STATE_VECTOR_SIZE).fill(0);
  const current = new LearningAgent('chaser', neutralGenome());
  assert.equal(current.getActionSchema(), 'signed-horizontal-controls-v3');
  assert.equal(current.chooseAction(state).horizontalDrive, 0, 'Neutral activation must decode to neutral horizontal control');
  assert.equal(JSON.parse(current.exportJson()).actionSchema, 'signed-horizontal-controls-v3');

  assert.throws(
    () => new LearningAgent('chaser', neutralGenome('signed-horizontal-controls-v2')),
    /Unsupported policy action schema/,
    'Legacy controller schemas must be rejected rather than silently decoded',
  );

  console.log('Policy decoder regressions passed: symmetric v3 control and legacy-schema rejection');
}
