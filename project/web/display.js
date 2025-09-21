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
    renderRandomPlayerScene(root);
  } else if (scene === 'category_select') {
    if (shouldRenderStandbyInDuel()) {
      renderDuelScene(scene);
    } else {
      root.innerHTML = '<h1>Stand by</h1>';
    }
  } else if (scene === 'duel_ready') {
    const left = state.players.find(p=>p.id===state.leftPlayerId)?.name || 'Left';
    const right = state.players.find(p=>p.id===state.rightPlayerId)?.name || 'Right';
    const cat = manifest.categories.find(c=>c.id===state.current.categoryId)?.name || '';
    root.innerHTML = `
      <div class="duel-ready">
        <div class="duel-category">${cat}</div>
        <div class="duel-vs">
          <span class="player-name">${left}</span>
          <span class="vs-text">vs</span>
          <span class="player-name">${right}</span>
        </div>
      </div>
    `;
  } else if (scene === 'duel_live' || scene === 'pause' || scene === 'result') {
    renderDuelScene(scene);
  }

}

function renderRandomPlayerScene(root) {
  const player = state.players.find(p => p.id === state.randomPlayerId);
  const name = player ? player.name : '';

  const screen = document.createElement('div');
  screen.className = 'random-player-screen';

  const card = document.createElement('div');
  card.className = 'random-player-card';

  const label = document.createElement('div');
  label.className = 'random-player-label';
  label.textContent = 'Next Challenger';

  const nameNode = document.createElement('div');
  nameNode.className = 'random-player-name';
  nameNode.textContent = name;

  card.append(label, nameNode);
  screen.appendChild(card);
  root.appendChild(screen);

  // Restart the reveal animation even if updates arrive in quick succession.
  screen.classList.remove('is-visible');
  card.classList.remove('is-visible');
  card.getBoundingClientRect();
  requestAnimationFrame(() => {
    screen.classList.add('is-visible');
    card.classList.add('is-visible');
  });
}

function shouldRenderStandbyInDuel() {
  return state.scene === 'category_select' && state.current?.standBy;
}

function renderDuelScene(scene) {
  const root = document.getElementById('display-root');
  const leftName = state.players.find(p=>p.id===state.leftPlayerId)?.name || 'Left';
  const rightName = state.players.find(p=>p.id===state.rightPlayerId)?.name || 'Right';
  let centerContent = '';
  if (state.current?.standBy) {
    const message = state.current.message || 'Stand by';
    centerContent = `<div class='standby-message'>${message}</div>`;
  } else if (state.current?.src) {
    let imgSrc = state.current.src;
    if (imgSrc.startsWith('/')) {
      imgSrc = '..' + imgSrc;
    }
    imgSrc = encodeURI(imgSrc);
    centerContent = `<img src='${imgSrc}' class='item'>`;
  }
  const ans = state.current?.revealed && state.current?.answer
    ? `<div class='answer'>${state.current.answer}</div>`
    : '';
  const penalty = state.penaltyUntil && Date.now() < state.penaltyUntil;
  const correct = state.correctUntil && Date.now() < state.correctUntil;
  const runningSide = state.clock?.runningSide;
  const leftClasses = ['clock', 'left'];
  const rightClasses = ['clock', 'right'];
  if (runningSide === 'left') leftClasses.push('active');
  if (runningSide === 'right') rightClasses.push('active');
  if (penalty && runningSide === 'left') leftClasses.push('penalty');
  if (penalty && runningSide === 'right') rightClasses.push('penalty');

  let statusMessage = '';
  if (scene === 'result' || state.winnerId) {
    let winnerName;
    if (state.winnerId) {
      winnerName = state.players.find(p => p.id === state.winnerId)?.name;
    }
    if (!winnerName) {
      winnerName = state.clock.leftRemainingMs > state.clock.rightRemainingMs ? leftName : rightName;
    }
    statusMessage = `Winner: ${winnerName}`;
  }

  const layout = [
    statusMessage ? `<div class='status-banner'>${statusMessage}</div>` : '',
    `<div class='${leftClasses.join(' ')}'>${leftName}<br>${formatSeconds(state.clock?.leftRemainingMs)}</div>`,
    centerContent,
    `<div class='${rightClasses.join(' ')}'>${rightName}<br>${formatSeconds(state.clock?.rightRemainingMs)}</div>`,
    ans,
  ].filter(Boolean).join('\n');
  root.innerHTML = layout;

  if (correct && (runningSide === 'left' || runningSide === 'right')) {
    const selector = runningSide === 'left' ? '.clock.left' : '.clock.right';
    root.querySelector(selector)?.classList.add('correct');
  }
  if (scene === 'pause') {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.textContent = 'Paused';
    root.appendChild(overlay);
  }
}

function formatSeconds(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return '0';
  const secs = Math.ceil(ms / 1000);
  return Math.max(secs, 0).toString();
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
  const cellCounts = new Map();
  grid.cells.forEach(pid => {
    if (!pid) return;
    cellCounts.set(pid, (cellCounts.get(pid) || 0) + 1);
  });
  const categoryMap = manifest?.categories
    ? new Map(manifest.categories.map(c => [c.id, c.name]))
    : new Map();

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
            const categoryName = player.currCatId
              ? categoryMap.get(player.currCatId) || player.currCatId
              : '-';
            const cellsOwned = cellCounts.has(pid)
              ? cellCounts.get(pid)
              : (player.cells ?? 0);
            cell.innerHTML = `
              <div class="player-name">${player.name}</div>
              <div class="player-cells">${cellsOwned}</div>
              <div class="player-category">${categoryName}</div>
            `.trim();
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
