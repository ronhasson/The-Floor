import { channel, loadManifest } from './app.js';

let state = null;
let manifest = null;
channel.postMessage({ __displayEvent: 'opened' });
window.addEventListener('beforeunload', () => {
  channel.postMessage({ __displayEvent: 'closed' });
});

async function init() {
  manifest = await loadManifest();
}

function render() {
  const root = document.getElementById('display-root');
  if (!state) { root.textContent = 'Waiting...'; return; }
  root.innerHTML = '';
  const scene = state.scene;
  if (scene === 'lobby') {
    root.innerHTML = '<h1>Arena Floor</h1>' + renderPlayers();
  } else if (scene === 'random_player') {
    const p = state.players.find(p=>p.id===state.randomPlayerId);
    const name = p ? p.name : '';
    root.innerHTML = `<h1>${name}</h1>`;
  } else if (scene === 'category_select') {
    root.innerHTML = '<h1>Stand by</h1>';
  } else if (scene === 'duel_ready') {
    const left = state.players.find(p=>p.id===state.leftPlayerId)?.name || 'Left';
    const right = state.players.find(p=>p.id===state.rightPlayerId)?.name || 'Right';
    const cat = manifest.categories.find(c=>c.id===state.current.categoryId)?.name || '';
    root.innerHTML = `<h2>${cat}</h2><div class="ready"><span>${left}</span> vs <span>${right}</span></div>`;
  } else if (scene === 'duel_live' || scene === 'pause') {
    const left = state.players.find(p=>p.id===state.leftPlayerId)?.name || 'Left';
    const right = state.players.find(p=>p.id===state.rightPlayerId)?.name || 'Right';
    let imgSrc = '';
    if (state.current?.src) {
      imgSrc = state.current.src;
      if (imgSrc.startsWith('/')) {
        imgSrc = '..' + imgSrc;
      }
      imgSrc = encodeURI(imgSrc);
    }
    const img = state.current?.src ? `<img src="${imgSrc}" class="item">` : '';
    const ans = state.current?.revealed ? `<div class="answer">${state.current.answer}</div>` : '';
    const penalty = state.penaltyUntil && Date.now() < state.penaltyUntil;
    const correct = state.correctUntil && Date.now() < state.correctUntil;
    const leftClass = `clock left ${state.clock.runningSide==='left'?'active':''} ${penalty && state.clock.runningSide==='left'?'penalty':''}`;
    const rightClass = `clock right ${state.clock.runningSide==='right'?'active':''} ${penalty && state.clock.runningSide==='right'?'penalty':''}`;
    root.innerHTML = `\n      <div class="${leftClass}">${left}<br>${Math.ceil(state.clock.leftRemainingMs/1000)}</div>\n      ${img}\n      <div class="${rightClass}">${right}<br>${Math.ceil(state.clock.rightRemainingMs/1000)}</div>\n      ${ans}`;
    if (correct) {
      const selector = state.clock.runningSide === 'left' ? '.clock.left' : '.clock.right';
      root.querySelector(selector)?.classList.add('correct');
    }
    if (scene === 'pause') {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.textContent = 'Paused';
      root.appendChild(overlay);
    }
  } else if (scene === 'result') {
    const left = state.players.find(p=>p.id===state.leftPlayerId)?.name || 'Left';
    const right = state.players.find(p=>p.id===state.rightPlayerId)?.name || 'Right';
    const winner = state.clock.leftRemainingMs > state.clock.rightRemainingMs ? left : right;
    root.innerHTML = `<h1>Winner: ${winner}</h1>`;
  }
}

function renderPlayers() {
  if (!state.players.length || !state.grid) return '';
  const grid = state.grid;
  const container = document.createElement('div');
  container.className = 'player-grid';
  container.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
  container.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;
  container.style.gap = '0';
  const used = new Set();
  const indexMap = new Map(state.players.map((p, i) => [p.id, i]));

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * grid.cols + c;
      const pid = grid.cells[idx];
      const cell = document.createElement('div');
      cell.className = 'player-cell';
      if (pid) {
        const playerIndex = indexMap.get(pid);
        const player = playerIndex !== undefined ? state.players[playerIndex] : undefined;
        if (player) {
          cell.style.background = playerColor(playerIndex);
          cell.style.color = '#000';
          if (!used.has(pid)) {
            cell.textContent = `${player.name} - ${player.score}`;
            used.add(pid);
          }
        }
      }
      container.appendChild(cell);
    }
  }
  return container.outerHTML;
}

const PLAYER_COLORS = Array.from(
  { length: 16 },
  (_, i) => `hsl(${i * (360 / 16)}, 70%, 80%)`
);
function playerColor(index) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

channel.onmessage = e => {
  if (e.data && e.data.__displayEvent) return;
  state = e.data;
  render();
};

init();
