export interface StoredCheckpointSummary {
  id: string;
  name: string;
  savedAt: number;
  generation: number;
  bytes: number;
  architectureLabel: string;
  chaserChampionGeneration?: number;
  runnerChampionGeneration?: number;
  formatVersion?: string;
}

interface StoredCheckpointRecord extends StoredCheckpointSummary {
  serialized: string;
}

const DB_NAME = 'neat-tag-checkpoint-library';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';

function openCheckpointDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Failed to open checkpoint database.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Checkpoint database operation failed.'));
  });
}

function architectureLabel(payload: any): string {
  const suite = payload?.evolutionCheckpoint?.networkArchitecture;
  if (!suite?.chaser || !suite?.runner) return 'Legacy / unspecified';
  const chaser = suite.chaser.preset || 'custom';
  const runner = suite.runner.preset || 'custom';
  if (suite.linkedRoles || chaser === runner) return `${chaser.replaceAll('_', ' ')} · linked`;
  return `C: ${chaser.replaceAll('_', ' ')} · R: ${runner.replaceAll('_', ' ')}`;
}

function buildSummary(serialized: string, name: string, id: string, savedAt: number): StoredCheckpointSummary {
  const payload = JSON.parse(serialized);
  if (payload?.kind !== 'full-evolution-checkpoint' || !payload?.evolutionCheckpoint) {
    throw new Error('Only full evolution checkpoints can be stored in the checkpoint library.');
  }
  const checkpoint = payload.evolutionCheckpoint;
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const bytes = encoder ? encoder.encode(serialized).byteLength : serialized.length * 2;
  return {
    id,
    name: name.trim() || `Generation ${checkpoint.generation || 0}`,
    savedAt,
    generation: Number(checkpoint.generation) || 0,
    bytes,
    architectureLabel: architectureLabel(payload),
    chaserChampionGeneration: checkpoint.generalistChampions?.chaser?.generation,
    runnerChampionGeneration: checkpoint.generalistChampions?.evader?.generation,
    formatVersion: payload.version,
  };
}

export function validateFullCheckpointJson(serialized: string): { valid: boolean; message?: string; generation?: number } {
  try {
    const payload = JSON.parse(serialized);
    if (payload?.kind !== 'full-evolution-checkpoint' || !payload?.evolutionCheckpoint) {
      return { valid: false, message: 'This file is not a full evolution checkpoint.' };
    }
    const checkpoint = payload.evolutionCheckpoint;
    if (!checkpoint.championChaser || !checkpoint.championEvader || !checkpoint.chaserPopulation || !checkpoint.evaderPopulation) {
      return { valid: false, message: 'Checkpoint is missing population or champion state.' };
    }
    return { valid: true, generation: Number(checkpoint.generation) || 0 };
  } catch {
    return { valid: false, message: 'Checkpoint JSON could not be parsed.' };
  }
}

export async function listStoredCheckpoints(): Promise<StoredCheckpointSummary[]> {
  const db = await openCheckpointDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const records = await requestToPromise(transaction.objectStore(STORE_NAME).getAll()) as StoredCheckpointRecord[];
    return records
      .map(({ serialized: _serialized, ...summary }) => summary)
      .sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

export async function saveStoredCheckpoint(serialized: string, name: string, existingId?: string): Promise<StoredCheckpointSummary> {
  const id = existingId || `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const savedAt = Date.now();
  const summary = buildSummary(serialized, name, id, savedAt);
  const record: StoredCheckpointRecord = { ...summary, serialized };
  const db = await openCheckpointDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(transaction.objectStore(STORE_NAME).put(record));
    return summary;
  } finally {
    db.close();
  }
}

export async function readStoredCheckpoint(id: string): Promise<string | null> {
  const db = await openCheckpointDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const record = await requestToPromise(transaction.objectStore(STORE_NAME).get(id)) as StoredCheckpointRecord | undefined;
    return record?.serialized || null;
  } finally {
    db.close();
  }
}

export async function deleteStoredCheckpoint(id: string): Promise<void> {
  const db = await openCheckpointDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}

export async function migrateLegacyLocalStorageCheckpoint(storageKey: string): Promise<boolean> {
  if (typeof localStorage === 'undefined') return false;
  const serialized = localStorage.getItem(storageKey);
  if (!serialized) return false;
  const validation = validateFullCheckpointJson(serialized);
  if (!validation.valid) return false;
  const existing = await listStoredCheckpoints();
  const alreadyMigrated = existing.some(item => item.id === 'legacy_local_checkpoint');
  if (!alreadyMigrated) {
    await saveStoredCheckpoint(serialized, `Migrated local save · Gen ${validation.generation || 0}`, 'legacy_local_checkpoint');
  }
  localStorage.removeItem(storageKey);
  return true;
}
