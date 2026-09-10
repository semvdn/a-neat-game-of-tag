import { validateFullCheckpointJson } from './checkpointStore';

export const BUNDLED_SHOWCASE_CHECKPOINT = 'showcase/neat_tag_checkpoint_gen7422.json';
export const BUNDLED_SHOWCASE_GENERATION = 7422;

export async function loadBundledShowcaseCheckpoint(): Promise<any> {
  const url = new URL(BUNDLED_SHOWCASE_CHECKPOINT, document.baseURI).toString();
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) {
    throw new Error(`Bundled showcase checkpoint could not be read (${response.status}).`);
  }
  const serialized = await response.text();
  const validation = validateFullCheckpointJson(serialized);
  if (!validation.valid) {
    throw new Error(validation.message || 'Bundled showcase checkpoint is incompatible with this build.');
  }
  return JSON.parse(serialized);
}
