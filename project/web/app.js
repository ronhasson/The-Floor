// Shared utilities for Arena Floor
// Works in both operator and display contexts.

export const CHANNEL_NAME = 'arena-game';
export const channel = new BroadcastChannel(CHANNEL_NAME);

export const LS_STATE = 'arena.v1.state';
export const LS_SETTINGS = 'arena.v1.settings';
export const LS_BACKUP_PREFIX = 'arena.v1.backup.';

export async function loadManifest() {
  if (loadManifest.cache) return loadManifest.cache;
  const res = await fetch('manifest.json');
  loadManifest.cache = await res.json();
  return loadManifest.cache;
}

export function migrateState(s) {
  // placeholder for future migrations
  return s;
}

export function freshState() {
  return {
    version: 1,
    showId: crypto.randomUUID(),
    lastSavedAt: Date.now(),
    scene: 'lobby',
    players: [],
    randomPlayerId: null,
    clock: {
      totalMs: 0,
      leftRemainingMs: 0,
      rightRemainingMs: 0,
      runningSide: null,
      lastSwitchTs: null,
      paused: true,
    },
    penaltyUntil: null,
  };
}

export function loadState() {
  const raw = localStorage.getItem(LS_STATE);
  if (!raw) return null;
  try {
    return migrateState(JSON.parse(raw));
  } catch (e) {
    console.error('Failed to parse saved state', e);
    return null;
  }
}

export function saveState(state) {
  state.lastSavedAt = Date.now();
  localStorage.setItem(LS_STATE, JSON.stringify(state));
  channel.postMessage(state);
  updateLastSavedUI(state.lastSavedAt);
}

export function loadSettings() {
  const raw = localStorage.getItem(LS_SETTINGS);
  const defaults = { defaultTotalMs: 45000, penaltySkipMs: 3000 };
  if (!raw) return defaults;
  try {
    return Object.assign({}, defaults, JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function saveSettings(s) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}

export function backupState(state) {
  const ts = Date.now();
  localStorage.setItem(LS_BACKUP_PREFIX + ts, JSON.stringify(state));
}

export function updateLastSavedUI(ts) {
  const el = document.getElementById('last-saved');
  if (el) {
    const secs = Math.round((Date.now() - ts) / 1000);
    el.textContent = `${secs}s ago`;
  }
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsText(file);
  });
}
