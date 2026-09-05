const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}`);

let state = null;
let myId = null;
let isReady = false;

const lobby = document.getElementById('lobby');
const gameScreen = document.getElementById('gameScreen');
const gameOver = document.getElementById('gameOver');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const shareUrl = document.getElementById('shareUrl');
const copyBtn = document.getElementById('copyBtn');
const nameInput = document.getElementById('nameInput');
const playerList = document.getElementById('playerList');
const lobbyStatus = document.getElementById('lobbyStatus');
const readyBtn = document.getElementById('readyBtn');
const hudStatus = document.getElementById('hudStatus');
const hudScore = document.getElementById('hudScore');
const gameOverTitle = document.getElementById('gameOverTitle');
const finalScores = document.getElementById('finalScores');
const playAgainBtn = document.getElementById('playAgainBtn');
const controls = document.getElementById('controls');

shareUrl.textContent = location.href;

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrl.textContent).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
  });
});

nameInput.addEventListener('change', () => {
  ws.send(JSON.stringify({ type: 'setName', name: nameInput.value }));
});

nameInput.addEventListener('blur', () => {
  ws.send(JSON.stringify({ type: 'setName', name: nameInput.value }));
});

readyBtn.addEventListener('click', () => {
  if (state?.status !== 'lobby') return;
  isReady = !isReady;
  ws.send(JSON.stringify({ type: isReady ? 'ready' : 'unready' }));
  readyBtn.textContent = isReady ? 'Not Ready' : 'Ready';
  readyBtn.classList.toggle('is-ready', isReady);
});

playAgainBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'playAgain' }));
  gameOver.classList.add('hidden');
  isReady = false;
  readyBtn.textContent = 'Ready';
  readyBtn.classList.remove('is-ready');
});

document.querySelectorAll('.ctrl-btn').forEach((btn) => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    sendDirection(btn.dataset.dir);
  });
  btn.addEventListener('click', () => sendDirection(btn.dataset.dir));
});

let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    sendDirection(dx > 0 ? 'right' : 'left');
  } else {
    sendDirection(dy > 0 ? 'down' : 'up');
  }
}, { passive: true });

document.addEventListener('keydown', (e) => {
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
  if (map[e.key]) {
    e.preventDefault();
    sendDirection(map[e.key]);
  }
});

function sendDirection(dir) {
  if (state?.status !== 'playing') return;
  ws.send(JSON.stringify({ type: 'direction', dir }));
}

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'error') {
    alert(msg.message);
    return;
  }
  if (msg.type === 'state') {
    state = msg;
    myId = msg.you;
    if (msg.shareUrl) shareUrl.textContent = msg.shareUrl;
    render();
  }
};

function render() {
  if (!state) return;

  if (state.status === 'lobby' || state.status === 'countdown') {
    lobby.classList.remove('hidden');
    gameScreen.classList.add('hidden');
    gameOver.classList.add('hidden');
    renderLobby();
  } else if (state.status === 'playing') {
    lobby.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameOver.classList.add('hidden');
    renderGame();
  } else if (state.status === 'ended') {
    lobby.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameOver.classList.remove('hidden');
    renderGame();
    renderGameOver();
  }
}

function renderLobby() {
  playerList.innerHTML = state.players.map((p) => `
    <div class="player-item">
      <span class="player-dot" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>
      ${p.ready ? '<span class="player-ready">Ready</span>' : ''}
    </div>
  `).join('');

  if (state.status === 'countdown') {
    const secs = Math.ceil(state.countdownRemaining / 1000);
    lobbyStatus.textContent = `Starting in ${secs}s — others can still join!`;
    lobbyStatus.className = 'lobby-status countdown';
    readyBtn.disabled = isReady || (state.players.length >= state.maxPlayers && !isReady);
    if (isReady) {
      readyBtn.textContent = 'Ready';
      readyBtn.classList.add('is-ready');
    }
  } else {
    const ready = state.readyCount;
    if (ready < state.minPlayers) {
      lobbyStatus.textContent = `Waiting for players (${ready}/${state.minPlayers} ready)`;
    } else {
      lobbyStatus.textContent = `${ready} ready — need ${state.minPlayers} to start`;
    }
    lobbyStatus.className = 'lobby-status';
    readyBtn.disabled = state.players.length >= state.maxPlayers && !isReady;
  }
}

function renderGame() {
  const me = state.players.find((p) => p.id === myId);
  hudScore.textContent = me ? `Score: ${me.score}` : '';
  hudStatus.textContent = me?.alive === false ? 'You died!' : '';

  resizeCanvas();
  drawBoard();
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || window.innerHeight - 160;

  const cellW = w / state.gridW;
  const cellH = h / state.gridH;
  const cell = Math.floor(Math.min(cellW, cellH));

  canvas.width = state.gridW * cell;
  canvas.height = state.gridH * cell;
  canvas._cell = cell;
}

function drawBoard() {
  const cell = canvas._cell || 16;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let x = 0; x <= state.gridW; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cell, 0);
    ctx.lineTo(x * cell, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= state.gridH; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell);
    ctx.lineTo(canvas.width, y * cell);
    ctx.stroke();
  }

  for (const apple of state.apples) {
    ctx.fillStyle = '#ef4444';
    const pad = cell * 0.15;
    ctx.beginPath();
    ctx.arc(
      apple.x * cell + cell / 2,
      apple.y * cell + cell / 2,
      cell / 2 - pad,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  for (const p of state.players) {
    if (!p.snake || p.snake.length === 0) continue;
    p.snake.forEach((seg, i) => {
      ctx.fillStyle = p.color;
      if (!p.alive) ctx.globalAlpha = 0.3;
      const pad = i === 0 ? cell * 0.08 : cell * 0.12;
      ctx.fillRect(seg.x * cell + pad, seg.y * cell + pad, cell - pad * 2, cell - pad * 2);
      if (i === 0) {
        ctx.fillStyle = '#0f172a';
        const eye = cell * 0.15;
        ctx.fillRect(seg.x * cell + cell * 0.25, seg.y * cell + cell * 0.3, eye, eye);
        ctx.fillRect(seg.x * cell + cell * 0.55, seg.y * cell + cell * 0.3, eye, eye);
      }
      ctx.globalAlpha = 1;
    });
  }
}

function renderGameOver() {
  const winner = state.players.find((p) => p.id === state.winner);
  if (winner) {
    gameOverTitle.textContent = `${winner.name} wins!`;
  } else {
    gameOverTitle.textContent = 'Draw!';
  }

  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  finalScores.innerHTML = sorted.map((p) => `
    <div class="score-row${p.id === state.winner ? ' winner' : ''}">
      <span><span class="player-dot" style="display:inline-block;background:${p.color};width:10px;height:10px;border-radius:50%;margin-right:6px"></span>${escapeHtml(p.name)}</span>
      <span>${p.score}</span>
    </div>
  `).join('');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

window.addEventListener('resize', () => {
  if (state?.status === 'playing' || state?.status === 'ended') renderGame();
});
