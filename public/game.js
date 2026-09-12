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
const countdownBanner = document.getElementById('countdownBanner');
const countdownNumber = document.getElementById('countdownNumber');

let countdownTimer = null;

shareUrl.textContent = location.origin;

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrl.textContent).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
  });
});

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}

function setShareLink(fromServer) {
  // Prefer a public URL (Render / tunnel). Never show LAN IP if a public page URL exists.
  if (fromServer && !isLocalUrl(fromServer)) {
    shareUrl.textContent = fromServer;
    return;
  }
  if (!isLocalUrl(location.origin)) {
    shareUrl.textContent = location.origin;
    return;
  }
  if (fromServer) shareUrl.textContent = fromServer;
  else shareUrl.textContent = location.origin;
}

function sendName() {
  const name = nameInput.value.trim();
  ws.send(JSON.stringify({ type: 'setName', name }));
  return name;
}

nameInput.addEventListener('input', () => {
  nameInput.classList.toggle('invalid', !nameInput.value.trim());
  sendName();
});

nameInput.addEventListener('change', sendName);
nameInput.addEventListener('blur', sendName);

readyBtn.addEventListener('click', () => {
  if (state?.status !== 'lobby' && state?.status !== 'countdown') return;

  const name = sendName();
  if (!name) {
    nameInput.classList.add('invalid');
    nameInput.focus();
    lobbyStatus.textContent = 'Enter a name for your snake first';
    lobbyStatus.className = 'lobby-status';
    return;
  }

  if (state.status === 'countdown' && isReady) return;

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

// Swipe steering: fire as soon as movement crosses threshold (not on finger lift)
const SWIPE_MIN = 14;
let touchStartX = 0;
let touchStartY = 0;
let swipeLocked = false;
let lastSentDir = null;

function onTouchStart(e) {
  if (state?.status !== 'playing') return;
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  swipeLocked = false;
}

function onTouchMove(e) {
  if (state?.status !== 'playing' || swipeLocked) return;
  if (e.cancelable) e.preventDefault();
  const t = e.touches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;

  const dir = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down' : 'up');

  swipeLocked = true;
  sendDirection(dir);
  // Allow a new swipe from the current point without lifting
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  swipeLocked = false;
}

function onTouchEnd() {
  swipeLocked = false;
}

const swipeTarget = document.getElementById('gameScreen');
swipeTarget.addEventListener('touchstart', onTouchStart, { passive: true });
swipeTarget.addEventListener('touchmove', onTouchMove, { passive: false });
swipeTarget.addEventListener('touchend', onTouchEnd, { passive: true });
swipeTarget.addEventListener('touchcancel', onTouchEnd, { passive: true });

document.addEventListener('keydown', (e) => {
  const map = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };
  if (map[e.key]) {
    e.preventDefault();
    sendDirection(map[e.key]);
  }
});

function sendDirection(dir) {
  if (state?.status !== 'playing') return;
  if (dir === lastSentDir) return;
  lastSentDir = dir;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'direction', dir }));
  }
}

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'error') {
    alert(msg.message);
    if (msg.message.toLowerCase().includes('name')) {
      isReady = false;
      readyBtn.textContent = 'Ready';
      readyBtn.classList.remove('is-ready');
      nameInput.classList.add('invalid');
      nameInput.focus();
    }
    return;
  }
  if (msg.type === 'state') {
    state = msg;
    myId = msg.you;
    if (msg.shareUrl) setShareLink(msg.shareUrl);
    else setShareLink();
    const me = msg.players.find((p) => p.id === myId);
    if (me && me.name && document.activeElement !== nameInput) {
      nameInput.value = me.name;
    }
    isReady = !!me?.ready;
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
    stopCountdownTicker();
    lobby.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameOver.classList.add('hidden');
    renderGame();
  } else if (state.status === 'ended') {
    stopCountdownTicker();
    lobby.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameOver.classList.remove('hidden');
    renderGame();
    renderGameOver();
  }
}

function stopCountdownTicker() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownBanner.classList.add('hidden');
}

function updateCountdownDisplay() {
  if (!state || state.status !== 'countdown') {
    stopCountdownTicker();
    return;
  }

  const end = state.countdownEnd || (Date.now() + (state.countdownRemaining || 0));
  const secs = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  countdownNumber.textContent = String(secs);
  countdownBanner.classList.remove('hidden');
  lobbyStatus.textContent = secs > 0
    ? `Get ready! Others can still join`
    : `Starting…`;
  lobbyStatus.className = 'lobby-status countdown';
}

function startCountdownTicker() {
  updateCountdownDisplay();
  if (countdownTimer) return;
  countdownTimer = setInterval(updateCountdownDisplay, 100);
}

function renderLobby() {
  playerList.innerHTML = state.players.map((p) => `
    <div class="player-item">
      <span class="player-dot" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name || '…')}${p.id === myId ? ' (you)' : ''}</span>
      ${p.ready ? '<span class="player-ready">Ready</span>' : ''}
    </div>
  `).join('');

  readyBtn.textContent = isReady ? 'Not Ready' : 'Ready';
  readyBtn.classList.toggle('is-ready', isReady);

  if (state.status === 'countdown') {
    startCountdownTicker();
    readyBtn.disabled = isReady;
  } else {
    stopCountdownTicker();
    const ready = state.readyCount;
    if (ready < state.minPlayers) {
      lobbyStatus.textContent = `Waiting for players (${ready}/${state.minPlayers} ready)`;
    } else {
      lobbyStatus.textContent = `${ready} ready — need ${state.minPlayers} to start`;
    }
    lobbyStatus.className = 'lobby-status';
    readyBtn.disabled = false;
  }
}

function renderGame() {
  const me = state.players.find((p) => p.id === myId);
  hudScore.textContent = me ? `${me.name || 'You'} · ${me.score}` : '';
  hudStatus.textContent = me?.alive === false ? 'You died!' : '';

  resizeCanvas();
  drawBoard();
}

function resizeCanvas() {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight - 56;
  const cell = Math.max(8, Math.floor(Math.min(maxW / state.gridW, maxH / state.gridH)));
  const w = state.gridW * cell;
  const h = state.gridH * cell;

  // Avoid resetting canvas every tick — that causes mobile lag
  if (canvas.width === w && canvas.height === h && canvas._cell === cell) return;

  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
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
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= state.gridH; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(canvas.width, y * cell + 0.5);
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
    drawSnake(p, cell);
  }
}

function drawSnake(p, cell) {
  if (!p.alive) ctx.globalAlpha = 0.35;

  p.snake.forEach((seg, i) => {
    ctx.fillStyle = p.color;
    const pad = i === 0 ? cell * 0.08 : cell * 0.12;
    const r = Math.max(2, cell * 0.2);
    roundRect(
      seg.x * cell + pad,
      seg.y * cell + pad,
      cell - pad * 2,
      cell - pad * 2,
      r
    );
    ctx.fill();

    if (i === 0) {
      ctx.fillStyle = '#0f172a';
      const eye = cell * 0.15;
      ctx.fillRect(seg.x * cell + cell * 0.25, seg.y * cell + cell * 0.28, eye, eye);
      ctx.fillRect(seg.x * cell + cell * 0.55, seg.y * cell + cell * 0.28, eye, eye);
    }
  });

  drawNameOnSnake(p, cell);
  ctx.globalAlpha = 1;
}

function drawNameOnSnake(p, cell) {
  const name = (p.name || '?').toUpperCase();
  if (!name || p.snake.length === 0) return;

  ctx.save();
  ctx.font = `bold ${Math.max(9, Math.floor(cell * 0.72))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0f172a';

  // Paint letters along the body so the name stays on the worm while it moves
  const chars = name.split('');
  const spacing = Math.max(1, Math.floor(p.snake.length / chars.length));

  chars.forEach((ch, i) => {
    const segIndex = Math.min(p.snake.length - 1, 1 + i * spacing);
    const seg = p.snake[segIndex];
    if (!seg) return;
    const x = seg.x * cell + cell / 2;
    const y = seg.y * cell + cell / 2;
    ctx.fillText(ch, x, y);
  });

  // Always show full name near the head so it's readable even when short
  const head = p.snake[0];
  ctx.font = `bold ${Math.max(10, Math.floor(cell * 0.85))}px sans-serif`;
  ctx.lineWidth = Math.max(2, cell * 0.12);
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillStyle = '#f8fafc';
  const labelX = head.x * cell + cell / 2;
  const labelY = head.y * cell - cell * 0.55;
  ctx.strokeText(name, labelX, labelY);
  ctx.fillText(name, labelX, labelY);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderGameOver() {
  const winner = state.players.find((p) => p.id === state.winner);
  gameOverTitle.textContent = winner ? `${winner.name} wins!` : 'Draw!';

  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  finalScores.innerHTML = sorted.map((p) => `
    <div class="score-row${p.id === state.winner ? ' winner' : ''}">
      <span><span class="player-dot" style="display:inline-block;background:${p.color};width:10px;height:10px;border-radius:50%;margin-right:6px"></span>${escapeHtml(p.name || 'unnamed')}</span>
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
