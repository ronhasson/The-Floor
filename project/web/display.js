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
  if (scene === 'victory') {
    const context = getVictoryContext();
    if (context) {
      renderVictoryScreen(root, context);
    } else {
      root.innerHTML = '<div class="victory-unavailable">Victory information unavailable</div>';
    }
  } else if (scene === 'lobby') {
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

function detectGridChampion() {
  if (!state?.grid || !Array.isArray(state.grid.cells) || !state.grid.cells.length) {
    return null;
  }
  const counts = new Map();
  for (const pid of state.grid.cells) {
    if (!pid) continue;
    counts.set(pid, (counts.get(pid) || 0) + 1);
    if (counts.size > 1) return null;
  }
  if (!counts.size) return null;
  const [[pid, cellsOwned]] = counts.entries();
  const championIndex = state.players.findIndex(p => p.id === pid);
  if (championIndex === -1) return null;
  const hasOtherHolders = state.players.some(p => {
    if (!p || p.id === pid) return false;
    const cells = typeof p.cells === 'number' ? p.cells : 0;
    return cells > 0;
  });
  if (hasOtherHolders) return null;
  const player = state.players[championIndex];
  if (!player) return null;
  return { player, championIndex, cellsOwned };
}

function getVictoryContext() {
  if (!state) return null;
  if (state.victory?.championId) {
    const championId = state.victory.championId;
    const championIndex = state.players.findIndex(p => p.id === championId);
    if (championIndex !== -1) {
      const player = state.players[championIndex];
      if (player) {
        const cellsOwned = typeof state.victory.cellsOwned === 'number'
          ? state.victory.cellsOwned
          : countCellsForPlayer(championId);
        return { player, championIndex, cellsOwned };
      }
    }
  }
  return detectGridChampion();
}

function countCellsForPlayer(playerId) {
  if (!state?.grid || !Array.isArray(state.grid.cells)) return 0;
  return state.grid.cells.reduce((total, pid) => total + (pid === playerId ? 1 : 0), 0);
}

function renderVictoryScreen(root, { player, championIndex, cellsOwned }) {
  const baseColor = playerColor(championIndex);
  const palette = buildVictoryPalette(baseColor);
  const screen = document.createElement('div');
  screen.className = 'victory-screen';
  screen.style.setProperty('--victory-color', palette.base);
  screen.style.setProperty('--victory-color-light', palette.light);
  screen.style.setProperty('--victory-color-dark', palette.dark);
  screen.style.setProperty('--victory-text-color', palette.text);

  const backdrop = document.createElement('div');
  backdrop.className = 'victory-backdrop';

  const confetti = document.createElement('div');
  confetti.className = 'confetti-container';
  createConfettiPieces(confetti, palette);

  const content = document.createElement('div');
  content.className = 'victory-content';

  const heading = document.createElement('div');
  heading.className = 'victory-heading';
  heading.textContent = 'Total Domination';

  const name = document.createElement('div');
  name.className = 'victory-name';
  name.textContent = player?.name || 'Champion';

  const subtitle = document.createElement('div');
  subtitle.className = 'victory-subtitle';
  subtitle.textContent = 'has conquered the entire floor';

  const detail = document.createElement('div');
  detail.className = 'victory-detail';
  const totalCells = Number.isFinite(cellsOwned) ? cellsOwned : countCellsForPlayer(player?.id);
  const safeCount = Number.isFinite(totalCells) ? totalCells : 0;
  const tileWord = safeCount === 1 ? 'tile' : 'tiles';
  detail.textContent = `Controls all ${safeCount} ${tileWord}!`;

  content.append(heading, name, subtitle, detail);
  screen.append(backdrop, confetti, content);
  root.appendChild(screen);

  // Trigger entrance animation.
  screen.getBoundingClientRect();
  requestAnimationFrame(() => {
    screen.classList.add('is-visible');
  });
}

function createConfettiPieces(container, palette) {
  const colors = [palette.base, palette.light, palette.dark, '#ffffff'];
  const count = 80;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${3.5 + Math.random() * 2.5}s`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.opacity = (0.6 + Math.random() * 0.4).toFixed(2);
    piece.style.width = `${0.35 + Math.random() * 0.4}rem`;
    piece.style.height = `${1 + Math.random() * 1.7}rem`;
    piece.style.setProperty('--confetti-start', `${Math.random() * 360}deg`);
    piece.style.setProperty('--confetti-end', `${Math.random() * 16 - 8}vw`);
    piece.style.setProperty('--confetti-rotation', `${Math.random() * 720 - 360}deg`);
    container.appendChild(piece);
  }
}

function buildVictoryPalette(baseColor) {
  const hsl = parseHslColor(baseColor);
  if (!hsl) {
    return {
      base: baseColor,
      light: baseColor,
      dark: baseColor,
      text: '#111111',
    };
  }
  const light = adjustHsl(hsl, { dl: 8 });
  const dark = adjustHsl(hsl, { dl: -18, ds: 5 });
  const text = hsl.l > 60 ? '#151515' : '#f5f5f5';
  return { base: baseColor, light, dark, text };
}

function parseHslColor(color) {
  if (typeof color !== 'string') return null;
  const match = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i);
  if (!match) return null;
  return {
    h: Number(match[1]),
    s: Number(match[2]),
    l: Number(match[3]),
  };
}

function adjustHsl(base, deltas) {
  const { dh = 0, ds = 0, dl = 0 } = deltas || {};
  const h = (base.h + dh) % 360;
  const s = clampValue(base.s + ds, 0, 100);
  const l = clampValue(base.l + dl, 0, 100);
  const hue = h < 0 ? h + 360 : h;
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
