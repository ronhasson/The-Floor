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
  await loadManifest().then(populateCategories);
  renderPlayers();
  renderDuelSelectors();
  tickLoop();
}

// Player management ----------------------------------------------------
function renderPlayers() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-row';
    div.innerHTML = `\n      <input value="${p.name}" data-id="${p.id}" class="p-name">\n      <span>Score: ${p.score}</span>\n      <label><input type="checkbox" class="p-elim" data-id="${p.id}" ${p.eliminated? 'checked':''}> Eliminated</label>\n      <button class="p-reset" data-id="${p.id}">Reset Score</button>\n      <button class="p-remove" data-id="${p.id}">Remove</button>`;
    list.appendChild(div);
  });
}

document.getElementById('add-player').addEventListener('click', () => {
  const name = prompt('Player name?');
  if (!name) return;
  state.players.push({ id: crypto.randomUUID(), name, score: 0, eliminated: false });
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
      saveState(state);
      renderPlayers();
      renderDuelSelectors();
    }
  }
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
  document.getElementById(id).addEventListener('change', e => {
    if (id === 'left-player') state.leftPlayerId = e.target.value || undefined;
    else state.rightPlayerId = e.target.value || undefined;
    saveState(state);
  });
});

async function populateCategories() {
  const manifest = await loadManifest();
  const catSel = document.getElementById('category');
  catSel.innerHTML = '<option value="">--</option>';
  manifest.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
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
});

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
}

document.getElementById('open-display').addEventListener('click', () => {
  // open audience display in new window
  window.open('display.html', 'display');
});

document.getElementById('apply-total').addEventListener('click', () => {
  const val = parseInt(document.getElementById('total-ms').value,10);
  if (!isNaN(val)) {
    state.clock.totalMs = val;
    saveState(state);
  }
});

function startDuel() {
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

function switchTurn(side) {
  if (state.clock.runningSide !== side) return;
  applyElapsed();
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
  const p = state.players.find(x=>x.id===winId);
  if (p) p.score += 1;
  if (confirm('Eliminate loser?')) {
    const lp = state.players.find(x=>x.id===loseId); if(lp) lp.eliminated = true;
  }
  saveState(state);
  renderPlayers();
  renderDuelSelectors();
}

function reveal() {
  if (state.current) state.current.revealed = true;
  saveState(state);
}

function nextItem() {
  state.current = undefined;
  state.scene = 'category_select';
  state.clock.runningSide = null;
  saveState(state);
}

function resetDuel() {
  if (!state.current) return;
  initClock(state.clock.totalMs || settings.defaultTotalMs);
  saveState(state);
}

// Buttons

document.getElementById('start-duel').addEventListener('click', startDuel);

document.getElementById('pause-duel').addEventListener('click', pauseToggle);

document.getElementById('switch-left').addEventListener('click', () => switchTurn('left'));

document.getElementById('switch-right').addEventListener('click', () => switchTurn('right'));

document.getElementById('reveal').addEventListener('click', reveal);

document.getElementById('timeout').addEventListener('click', timeout);

document.getElementById('win-left').addEventListener('click', () => declareWinner('left'));

document.getElementById('win-right').addEventListener('click', () => declareWinner('right'));

document.getElementById('next-item').addEventListener('click', nextItem);

document.getElementById('reset-duel').addEventListener('click', resetDuel);

// State & settings -----------------------------------------------------

document.getElementById('edit-json').addEventListener('click', () => {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<div class="modal"><textarea id="state-text" rows="20" cols="80"></textarea><br><button id="apply-json">Validate & Apply</button><button id="cancel-json">Cancel</button></div>`;
  modal.classList.remove('hidden');
  document.getElementById('state-text').value = JSON.stringify(state, null, 2);
  document.getElementById('apply-json').onclick = () => {
    try {
      const obj = JSON.parse(document.getElementById('state-text').value);
      if (!obj || obj.version !== 1) throw new Error('Bad shape');
      state = migrateState(obj);
      saveState(state);
      renderPlayers();
      renderDuelSelectors();
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
    saveState(state);
    renderPlayers();
    renderDuelSelectors();
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
    alert('Show reset');
  }
});

document.getElementById('save-settings').addEventListener('click', () => {
  const val = parseInt(document.getElementById('setting-total').value,10);
  if (!isNaN(val)) {
    settings.defaultTotalMs = val;
    saveSettings(settings);
    alert('Settings saved');
  }
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
  // operator is source of truth; ignore
};

init();
