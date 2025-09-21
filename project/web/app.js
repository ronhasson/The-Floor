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
  // ensure new properties exist
  if (s.players) {
    const counts = new Map();
    if (s.grid && Array.isArray(s.grid.cells)) {
      s.grid.cells.forEach(id => {
        if (!id) return;
        counts.set(id, (counts.get(id) || 0) + 1);
      });
    }
    s.players.forEach(p => {
      if (!p) return;
      if (counts.has(p.id)) {
        p.cells = counts.get(p.id);
      } else if (p.cells == null) {
        p.cells = p.eliminated ? 0 : 1;
      } else if (p.cells < 0) {
        p.cells = 0;
      }
    });
  }
  if (s.winnerId === undefined) s.winnerId = null;
  if (s.victory === undefined) s.victory = null;
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
    grid: { rows: 0, cols: 0, cells: [] },
    clock: {
      totalMs: 0,
      leftRemainingMs: 0,
      rightRemainingMs: 0,
      runningSide: null,
      lastSwitchTs: null,
      paused: true,
    },
    penaltyUntil: null,
    correctUntil: null,
    winnerId: null,
    victory: null,
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

export function saveState(state, options = {}) {
  const { broadcast = true } = options;
  if (state.scene !== 'victory') {
    state.victory = null;
  }
  state.lastSavedAt = Date.now();
  localStorage.setItem(LS_STATE, JSON.stringify(state));
  if (broadcast) channel.postMessage(state);
  updateLastSavedUI(state.lastSavedAt);
}

export function loadSettings() {
  const raw = localStorage.getItem(LS_SETTINGS);
  const defaults = { defaultTotalMs: 45000, penaltySkipMs: 3000, correctRevealMs: 1000 };
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
