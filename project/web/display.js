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
    root.innerHTML = `\n      <div class="clock left ${state.clock.runningSide==='left'?'active':''}">${left}<br>${Math.ceil(state.clock.leftRemainingMs/1000)}</div>\n      ${img}\n      <div class="clock right ${state.clock.runningSide==='right'?'active':''}">${right}<br>${Math.ceil(state.clock.rightRemainingMs/1000)}</div>\n      ${ans}`;
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
  if (!state.players.length) return '';
  return '<ul>' + state.players.map(p=>`<li>${p.name}${p.eliminated?' (out)':''} - ${p.score}</li>`).join('') + '</ul>';
}

channel.onmessage = e => {
  if (e.data && e.data.__displayEvent) return;
  state = e.data;
  render();
};

init();
