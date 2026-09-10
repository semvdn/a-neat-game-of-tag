const RECOVERY_STORAGE_KEY = 'tag-agents-showcase-fatal-recovery-v1';
const RECOVERY_WINDOW_MS = 60_000;
const MAX_RECOVERIES_PER_WINDOW = 3;

export function isShowcaseRequested(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('showcase') === '1' || params.get('exhibit') === '1';
}

export function showcaseTrainingRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('train') === '1';
}

export function requestShowcaseRecovery(reason: string): boolean {
  if (!isShowcaseRequested() || typeof window === 'undefined') return false;
  try {
    const now = Date.now();
    const previous = JSON.parse(sessionStorage.getItem(RECOVERY_STORAGE_KEY) || '[]') as Array<{ at: number; reason: string }>;
    const recent = previous.filter(entry => Number.isFinite(entry?.at) && now - entry.at < RECOVERY_WINDOW_MS);
    if (recent.length >= MAX_RECOVERIES_PER_WINDOW) return false;
    recent.push({ at: now, reason });
    sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Recovery must still be allowed when sessionStorage is unavailable.
  }
  window.location.reload();
  return true;
}
