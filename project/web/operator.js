import {
  channel,
  loadManifest,
  saveState,
  loadState,
  freshState,
  loadSettings,
  saveSettings,
  backupState,
  downloadText,
  readFileAsText,
  updateLastSavedUI,
  migrateState,
} from './app.js';

let state = loadState();
let settings = loadSettings();
let displayWin = null;
let displayConnected = false;

async function init() {
  if (state) {
    const resume = confirm('Resume previous show?');
    if (!resume) {
      backupState(state);
      state = freshState();
      saveState(state);
    }
  } else {
    state = freshState();
    saveState(state);
  }
  updateLastSavedUI(state.lastSavedAt);
  document.getElementById('setting-total').value = settings.defaultTotalMs;
  document.getElementById('setting-skip').value = settings.penaltySkipMs;
  document.getElementById('setting-reveal').value = settings.correctRevealMs;
  const manifest = await loadManifest();
  populateCategories(manifest);
  ensurePlayersFromManifest(manifest);
  assignCategoryInfoFromManifest(manifest);
  ensureGrid();
  renderPlayers();
  renderDuelSelectors();
  tickLoop();
  updateDisplayStatus();
  renderAnswer();
  suggestCategoryForRightPlayer();
}

// Player management ----------------------------------------------------
async function renderPlayers() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  const manifest = await loadManifest();
  const catMap = {};
  manifest.categories.forEach(c => { catMap[c.id] = c.name; });
  state.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-row';
    const orig = p.origCatId ? catMap[p.origCatId] || p.origCatId : '-';
    const curr = p.currCatId ? catMap[p.currCatId] || p.currCatId : '-';
    div.innerHTML = `\n      <input value="${p.name}" data-id="${p.id}" class="p-name">\n      <span>Score: ${p.score}</span>\n      <span>Orig: ${orig}</span>\n      <span>Current: ${curr}</span>\n      <label><input type="checkbox" class="p-elim" data-id="${p.id}" ${p.eliminated? 'checked':''}> Eliminated</label>\n      <button class="p-reset" data-id="${p.id}">Reset Score</button>\n      <button class="p-remove" data-id="${p.id}">Remove</button>`;
    list.appendChild(div);
  });
}

document.getElementById('add-player').addEventListener('click', () => {
  const name = prompt('Player name?');
  if (!name) return;
  state.players.push({ id: crypto.randomUUID(), name, score: 0, eliminated: false, origCatId: null, currCatId: null });
  ensureGrid();
  saveState(state);
  renderPlayers();
  renderDuelSelectors();
});

// delegate events
document.getElementById('player-list').addEventListener('input', e => {
  if (e.target.classList.contains('p-name')) {
    const p = state.players.find(p => p.id === e.target.dataset.id);
    p.name = e.target.value;
    saveState(state);
    renderDuelSelectors();
  } else if (e.target.classList.contains('p-elim')) {
    const p = state.players.find(p => p.id === e.target.dataset.id);
    p.eliminated = e.target.checked;
    saveState(state);
    renderDuelSelectors();
  }
});

document.getElementById('player-list').addEventListener('click', e => {
  if (e.target.classList.contains('p-reset')) {
    const p = state.players.find(p => p.id === e.target.dataset.id);
    p.score = 0;
    saveState(state);
    renderPlayers();
  } else if (e.target.classList.contains('p-remove')) {
    if (confirm('Remove player?')) {
      state.players = state.players.filter(p => p.id !== e.target.dataset.id);
      ensureGrid();
      saveState(state);
      renderPlayers();
      renderDuelSelectors();
    }
  }
});

function ensurePlayersFromManifest(manifest) {
  if (state.players.length) return;
  const seen = new Set();
  manifest.categories.forEach(c => {
    if (!seen.has(c.player)) {
      seen.add(c.player);
      state.players.push({ id: crypto.randomUUID(), name: c.player, score: 0, eliminated: false, origCatId: c.id, currCatId: c.id });
    }
  });
  saveState(state);
}

function assignCategoryInfoFromManifest(manifest) {
  let changed = false;
  state.players.forEach(p => {
    if (!p.origCatId) {
      const cat = manifest.categories.find(c => c.player === p.name);
      if (cat) {
        p.origCatId = cat.id;
        p.currCatId = p.currCatId || cat.id;
        changed = true;
      }
    } else if (!p.currCatId) {
      p.currCatId = p.origCatId;
      changed = true;
    }
  });
  if (changed) saveState(state);
}

function ensureGrid() {
  let changed = false;
  // Ensure each player tracks how many cells they currently own
  state.players.forEach(p => {
    if (p.cells == null) {
      const count = state.grid ? state.grid.cells.filter(id => id === p.id).length : 0;
      p.cells = count || 1;
      changed = true;
    }
  });

  const total = state.players.reduce((sum, p) => sum + (p.cells || 0), 0);

  // If an existing grid already matches the total cell count, keep it as-is
  if (state.grid && state.grid.cells.length === total) {
    if (changed) saveState(state);
    return;
  }

  // Otherwise rebuild a near-square grid from scratch
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const cells = [];
  state.players.forEach(p => {
    for (let i = 0; i < (p.cells || 0); i++) cells.push(p.id);
  });
  while (cells.length < rows * cols) cells.push(null);
  state.grid = { rows, cols, cells };
  saveState(state);
}

function transferGridAreas(winnerId, loserId) {
  if (!state.grid) return;
  let moved = 0;
  state.grid.cells = state.grid.cells.map(id => {
    if (id === loserId) { moved++; return winnerId; }
    return id;
  });
  const win = state.players.find(p=>p.id===winnerId);
  const lose = state.players.find(p=>p.id===loserId);
  if (win) win.cells = (win.cells || 0) + moved;
  if (lose) lose.cells = 0;
}

// Between battles ------------------------------------------------------

document.getElementById('show-players-screen').addEventListener('click', () => {
  state.scene = 'lobby';
  saveState(state);
});

document.getElementById('show-random-player').addEventListener('click', () => {
  const alive = state.players.filter(p => !p.eliminated);
  const zero = alive.filter(p => p.score === 0);
  const pool = zero.length ? zero : alive;
  if (!pool.length) {
    alert('No players available');
    return;
  }
  const choice = pool[Math.floor(Math.random() * pool.length)];
  state.randomPlayerId = choice.id;
  state.scene = 'random_player';
  saveState(state);
});

// Duel selectors -------------------------------------------------------
function renderDuelSelectors() {
  const leftSel = document.getElementById('left-player');
  const rightSel = document.getElementById('right-player');
  [leftSel, rightSel].forEach(sel => {
    sel.innerHTML = '<option value="">--</option>';
    state.players.filter(p=>!p.eliminated).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      if (sel.id === 'left-player' && state.leftPlayerId === p.id) opt.selected = true;
      if (sel.id === 'right-player' && state.rightPlayerId === p.id) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

['left-player','right-player'].forEach(id => {
  document.getElementById(id).addEventListener('change', async e => {
    if (id === 'left-player') {
      state.leftPlayerId = e.target.value || undefined;
    } else {
      state.rightPlayerId = e.target.value || undefined;
      await suggestCategoryForRightPlayer();
    }
    saveState(state);
  });
});

async function suggestCategoryForRightPlayer() {
  const player = state.players.find(p => p.id === state.rightPlayerId);
  if (!player) return;
  const catSel = document.getElementById('category');
  if (player.currCatId) {
    catSel.value = player.currCatId;
    catSel.dispatchEvent(new Event('change'));
    return;
  }
  const manifest = await loadManifest();
  const cat = manifest.categories.find(c => c.player === player.name);
  if (!cat) return;
  catSel.value = cat.id;
  catSel.dispatchEvent(new Event('change'));
}

function renderAnswer() {
  const el = document.getElementById('current-answer');
  if (!el) return;
  el.textContent = state.current?.answer || '';
}

async function populateCategories(manifest) {
  if (!manifest) manifest = await loadManifest();
  const catSel = document.getElementById('category');
  catSel.innerHTML = '<option value="">--</option>';
  manifest.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = `${c.name} (${c.player})`;
    catSel.appendChild(opt);
  });
}

document.getElementById('category').addEventListener('change', async e => {
  const catId = e.target.value;
  const itemSel = document.getElementById('item');
  itemSel.innerHTML = '';
  if (!catId) return;
  const manifest = await loadManifest();
  const cat = manifest.categories.find(c=>c.id===catId);
  cat.items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = it.index;
    opt.textContent = it.index;
    itemSel.appendChild(opt);
  });
});

document.getElementById('item').addEventListener('change', async e => {
  const catId = document.getElementById('category').value;
  if (!catId) return;
  const idx = parseInt(e.target.value,10);
  const manifest = await loadManifest();
  const cat = manifest.categories.find(c=>c.id===catId);
  const item = cat.items.find(i=>i.index===idx);
  state.current = { categoryId: cat.id, itemIndex: item.index, src: item.src, answer: item.answer, revealed:false };
  state.scene = 'duel_ready';
  saveState(state);
  renderAnswer();
});

async function ensureCurrentItem() {
  const catId = document.getElementById('category').value;
  if (!catId) return;
  const idx = parseInt(document.getElementById('item').value,10) || 1;
  const manifest = await loadManifest();
  const cat = manifest.categories.find(c=>c.id===catId);
  if (!cat) return;
  const item = cat.items.find(i=>i.index===idx);
  if (!item) return;
  state.current = { categoryId: cat.id, itemIndex: item.index, src: item.src, answer: item.answer, revealed:false };
  const itemSel = document.getElementById('item');
  if (itemSel) itemSel.value = item.index;
  state.scene = 'duel_ready';
  renderAnswer();
}

// Clock and duel control -----------------------------------------------
function initClock(total) {
  state.clock = {
    totalMs: total,
    leftRemainingMs: total,
    rightRemainingMs: total,
    runningSide: 'left',
    lastSwitchTs: Date.now(),
    paused: false,
  };
  state.scene = 'duel_live';
  state.penaltyUntil = null;
  state.correctUntil = null;
}

document.getElementById('open-display').addEventListener('click', () => {
  if (displayWin && !displayWin.closed) {
    displayWin.focus();
  } else {
    displayWin = window.open('display.html', 'display');
  }
  displayConnected = true;
  updateDisplayStatus();
});

document.getElementById('apply-total').addEventListener('click', () => {
  const val = parseInt(document.getElementById('total-ms').value,10);
  if (!isNaN(val)) {
    state.clock.totalMs = val;
    saveState(state);
  }
});

document.getElementById('show-intro').addEventListener('click', async () => {
  await ensureCurrentItem();
  saveState(state);
});

async function startDuel() {
  await ensureCurrentItem();
  if (!state.current?.src) {
    alert('Select a category and item before starting the duel.');
    return;
  }
  const total = parseInt(document.getElementById('total-ms').value,10) || settings.defaultTotalMs;
  initClock(total);
  saveState(state);
}

function pauseToggle() {
  if (state.clock.paused) {
    state.clock.paused = false;
    state.clock.lastSwitchTs = Date.now();
    state.scene = 'duel_live';
  } else {
    applyElapsed();
    state.clock.paused = true;
    state.scene = 'pause';
  }
  saveState(state);
}

async function advanceItem() {
  if (!state.current) return;
  const manifest = await loadManifest();
  const cat = manifest.categories.find(c=>c.id===state.current.categoryId);
  if (!cat) { state.current = undefined; state.scene = 'category_select'; return; }
  const nextIndex = state.current.itemIndex + 1;
  const item = cat.items.find(i=>i.index===nextIndex);
  if (item) {
    state.current = { categoryId: cat.id, itemIndex: item.index, src: item.src, answer: item.answer, revealed:false };
    const itemSel = document.getElementById('item');
    if (itemSel) itemSel.value = item.index;
  } else {
    state.current = undefined;
    state.scene = 'category_select';
    const itemSel = document.getElementById('item');
    if (itemSel) itemSel.value = '';
  }
  renderAnswer();
}

async function switchTurn(side) {
  if (state.clock.runningSide !== side) return;
  applyElapsed();
  await advanceItem();
  state.clock.runningSide = side === 'left' ? 'right' : 'left';
  state.clock.lastSwitchTs = Date.now();
  saveState(state);
}

function applyElapsed() {
  if (state.clock.runningSide && !state.clock.paused && state.clock.lastSwitchTs) {
    const now = Date.now();
    const elapsed = now - state.clock.lastSwitchTs;
    if (state.clock.runningSide === 'left') state.clock.leftRemainingMs -= elapsed;
    else state.clock.rightRemainingMs -= elapsed;
    state.clock.lastSwitchTs = now;
  }
}

function timeout() {
  applyElapsed();
  const loser = state.clock.runningSide;
  if (!loser) return;
  if (loser === 'left') state.clock.leftRemainingMs = 0; else state.clock.rightRemainingMs = 0;
  const winner = loser === 'left' ? 'right' : 'left';
  state.clock.runningSide = null;
  state.scene = 'result';
  const winId = winner === 'left' ? state.leftPlayerId : state.rightPlayerId;
  const p = state.players.find(x=>x.id===winId);
  if (p) p.score += 1;
  saveState(state);
  renderPlayers();
}

function declareWinner(side) {
  applyElapsed();
  state.scene = 'result';
  state.clock.runningSide = null;
  const winId = side === 'left' ? state.leftPlayerId : state.rightPlayerId;
  const loseId = side === 'left' ? state.rightPlayerId : state.leftPlayerId;
  const leftCat = state.players.find(x=>x.id===state.leftPlayerId)?.currCatId;
  const p = state.players.find(x=>x.id===winId);
  if (p) p.score += 1;
  if (confirm('Eliminate loser?')) {
    const lp = state.players.find(x=>x.id===loseId); if(lp) lp.eliminated = true;
    transferGridAreas(winId, loseId);
    if (p && leftCat !== undefined) p.currCatId = leftCat;
  }
  saveState(state);
  renderPlayers();
  renderDuelSelectors();
}

function reveal() {
  if (state.current) state.current.revealed = true;
  saveState(state);
}

async function nextItem() {
  state.penaltyUntil = null;
  state.correctUntil = null;
  await advanceItem();
  if (!state.current) {
    state.scene = 'category_select';
    state.clock.runningSide = null;
  }
  saveState(state);
}

function penaltySkip() {
  if (state.penaltyUntil || !state.clock.runningSide) return;
  const ms = settings.penaltySkipMs || 3000;
  if (state.current) state.current.revealed = true;
  state.penaltyUntil = Date.now() + ms;
  state.correctUntil = null;
  saveState(state);
  setTimeout(async () => {
    await nextItem();
  }, ms);
}

function resetDuel() {
  if (!state.current) return;
  initClock(state.clock.totalMs || settings.defaultTotalMs);
  saveState(state);
}

// Buttons

document.getElementById('start-duel').addEventListener('click', startDuel);

document.getElementById('pause-duel').addEventListener('click', pauseToggle);

document.getElementById('correct').addEventListener('click', () => {
  if (!state.clock.runningSide || state.correctUntil) return;
  const side = state.clock.runningSide;
  const ms = settings.correctRevealMs || 1000;
  if (state.current) state.current.revealed = true;
  state.correctUntil = Date.now() + ms;
  saveState(state);
  setTimeout(async () => {
    state.correctUntil = null;
    await switchTurn(side);
  }, ms);
});

document.getElementById('reveal').addEventListener('click', reveal);

document.getElementById('timeout').addEventListener('click', timeout);

document.getElementById('win-left').addEventListener('click', () => declareWinner('left'));

document.getElementById('win-right').addEventListener('click', () => declareWinner('right'));
document.getElementById('penalty-skip').addEventListener('click', penaltySkip);
document.getElementById('next-item').addEventListener('click', nextItem);

document.getElementById('reset-duel').addEventListener('click', resetDuel);

function updateDisplayStatus() {
  const el = document.getElementById('display-status');
  const btn = document.getElementById('open-display');
  if (!el || !btn) return;
  if (displayConnected && displayWin && !displayWin.closed) {
    el.textContent = 'Display: Open';
    btn.textContent = 'Focus Display Window';
  } else {
    el.textContent = 'Display: Closed';
    btn.textContent = 'Open Display Window';
  }
}

setInterval(() => {
  if (displayConnected && displayWin && displayWin.closed) {
    displayConnected = false;
    displayWin = null;
  }
  updateDisplayStatus();
}, 1000);

// State & settings -----------------------------------------------------

document.getElementById('edit-json').addEventListener('click', () => {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal"><textarea id="state-text" rows="20" cols="80"></textarea><br><button id="apply-json">Validate & Apply</button><button id="cancel-json">Cancel</button></div>`;
  modal.classList.remove('hidden');
  document.getElementById('state-text').value = JSON.stringify(state, null, 2);
  document.getElementById('apply-json').onclick = async () => {
    try {
      const obj = JSON.parse(document.getElementById('state-text').value);
      if (!obj || obj.version !== 1) throw new Error('Bad shape');
      state = migrateState(obj);
      assignCategoryInfoFromManifest(await loadManifest());
      saveState(state);
      renderPlayers();
      renderDuelSelectors();
      renderAnswer();
      modal.classList.add('hidden');
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
    }
  };
  document.getElementById('cancel-json').onclick = () => modal.classList.add('hidden');
});

document.getElementById('export-state').addEventListener('click', () => {
  downloadText('arena-state.json', JSON.stringify(state, null, 2));
});

document.getElementById('import-state').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const txt = await readFileAsText(file);
  try {
    const obj = JSON.parse(txt);
    if (!obj || obj.version !== 1) throw new Error('Bad shape');
    backupState(state);
    state = obj;
    const manifest = await loadManifest();
    assignCategoryInfoFromManifest(manifest);
    saveState(state);
    renderPlayers();
    renderDuelSelectors();
    renderAnswer();
    alert('Import successful');
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});

document.getElementById('reset-show').addEventListener('click', () => {
  const val = prompt('Type RESET to confirm');
  if (val === 'RESET') {
    backupState(state);
    state = freshState();
    saveState(state);
    renderPlayers();
    renderDuelSelectors();
    renderAnswer();
    alert('Show reset');
  }
});

document.getElementById('save-settings').addEventListener('click', () => {
  const val = parseInt(document.getElementById('setting-total').value,10);
  const skip = parseInt(document.getElementById('setting-skip').value,10);
  const reveal = parseInt(document.getElementById('setting-reveal').value,10);
  if (!isNaN(val)) settings.defaultTotalMs = val;
  if (!isNaN(skip)) settings.penaltySkipMs = skip;
  if (!isNaN(reveal)) settings.correctRevealMs = reveal;
  saveSettings(settings);
  alert('Settings saved');
});

// Chess clock loop -----------------------------------------------------
function tickLoop() {
  setInterval(() => {
    if (!state.clock.runningSide || state.clock.paused) return;
    applyElapsed();
    if (state.clock.leftRemainingMs <=0 || state.clock.rightRemainingMs<=0) {
      timeout();
    } else {
      saveState(state);
    }
  }, 50);
}

channel.onmessage = e => {
  if (e.data && e.data.__displayEvent === 'opened') {
    displayConnected = true;
    updateDisplayStatus();
  } else if (e.data && e.data.__displayEvent === 'closed') {
    displayConnected = false;
    displayWin = null;
    updateDisplayStatus();
  }
  // ignore state updates
};

init();
