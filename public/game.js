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
let scale = 1;
let aiming = false;
let joyOriginX = 0;
let joyOriginY = 0;
let joyDX = 0;
let joyDY = 0;
let lastAimSent = 0;

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

function sendAim(angle) {
  if (state?.status !== 'playing' || ws.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - lastAimSent < 32) return;
  lastAimSent = now;
  ws.send(JSON.stringify({ type: 'aim', angle }));
}

function updateAimFromJoystick(clientX, clientY) {
  joyDX = clientX - joyOriginX;
  joyDY = clientY - joyOriginY;
  if (Math.hypot(joyDX, joyDY) < 8) return;
  sendAim(Math.atan2(joyDY, joyDX));
}

const steerTarget = document.getElementById('gameScreen');

steerTarget.addEventListener('touchstart', (e) => {
  if (state?.status !== 'playing') return;
  const t = e.touches[0];
  aiming = true;
  joyOriginX = t.clientX;
  joyOriginY = t.clientY;
  joyDX = 0;
  joyDY = 0;
}, { passive: true });

steerTarget.addEventListener('touchmove', (e) => {
  if (!aiming || state?.status !== 'playing') return;
  if (e.cancelable) e.preventDefault();
  const t = e.touches[0];
  updateAimFromJoystick(t.clientX, t.clientY);
}, { passive: false });

steerTarget.addEventListener('touchend', () => {
  aiming = false;
  joyDX = 0;
  joyDY = 0;
}, { passive: true });

steerTarget.addEventListener('touchcancel', () => {
  aiming = false;
  joyDX = 0;
  joyDY = 0;
}, { passive: true });

steerTarget.addEventListener('mousedown', (e) => {
  if (state?.status !== 'playing') return;
  aiming = true;
  joyOriginX = e.clientX;
  joyOriginY = e.clientY;
  joyDX = 0;
  joyDY = 0;
});

window.addEventListener('mousemove', (e) => {
  if (!aiming || state?.status !== 'playing') return;
  updateAimFromJoystick(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  aiming = false;
  joyDX = 0;
  joyDY = 0;
});

document.addEventListener('keydown', (e) => {
  if (state?.status !== 'playing') return;
  const map = {
    ArrowUp: -Math.PI / 2,
    w: -Math.PI / 2,
    ArrowDown: Math.PI / 2,
    s: Math.PI / 2,
    ArrowLeft: Math.PI,
    a: Math.PI,
    ArrowRight: 0,
    d: 0,
  };
  if (map[e.key] !== undefined) {
    e.preventDefault();
    lastAimSent = 0;
    sendAim(map[e.key]);
  }
});

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
    ? 'Get ready! Others can still join'
    : 'Starting…';
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
  const s = Math.min(maxW / state.worldW, maxH / state.worldH);
  const w = Math.floor(state.worldW * s);
  const h = Math.floor(state.worldH * s);
  scale = s;

  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

function toScreen(x, y) {
  return { x: x * scale, y: y * scale };
}

function drawBoard() {
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft ambient dots instead of a grid
  ctx.fillStyle = '#152033';
  const step = 40 * scale;
  for (let y = step / 2; y < canvas.height; y += step) {
    for (let x = step / 2; x < canvas.width; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, scale * 1.2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const appleR = (state.appleRadius || 8) * scale;
  for (const apple of state.apples) {
    const p = toScreen(apple.x, apple.y);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(p.x, p.y, appleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#86efac';
    ctx.beginPath();
    ctx.arc(p.x + appleR * 0.25, p.y - appleR * 0.55, appleR * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of state.players) {
    if (!p.snake || p.snake.length === 0) continue;
    drawSnake(p);
  }

  drawJoystick();
}

function drawSnake(p) {
  if (!p.alive) ctx.globalAlpha = 0.35;
  const r = (state.snakeRadius || 9) * scale;
  const step = Math.max(1, Math.floor(2 / Math.max(scale, 0.01)));

  for (let i = p.snake.length - 1; i >= 0; i -= step) {
    const seg = p.snake[i];
    const pos = toScreen(seg.x, seg.y);
    const t = 1 - i / p.snake.length;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * (0.75 + t * 0.25), 0, Math.PI * 2);
    ctx.fill();
  }

  const head = p.snake[0];
  const hp = toScreen(head.x, head.y);
  const angle = p.angle || 0;

  // Eyes facing movement direction
  const ex = Math.cos(angle);
  const ey = Math.sin(angle);
  const px = -ey;
  const py = ex;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(hp.x + ex * r * 0.35 + px * r * 0.35, hp.y + ey * r * 0.35 + py * r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.arc(hp.x + ex * r * 0.35 - px * r * 0.35, hp.y + ey * r * 0.35 - py * r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(hp.x + ex * r * 0.5 + px * r * 0.35, hp.y + ey * r * 0.5 + py * r * 0.35, r * 0.12, 0, Math.PI * 2);
  ctx.arc(hp.x + ex * r * 0.5 - px * r * 0.35, hp.y + ey * r * 0.5 - py * r * 0.35, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  drawNameOnSnake(p);
  ctx.globalAlpha = 1;
}

function drawNameOnSnake(p) {
  const name = (p.name || '?').toUpperCase();
  if (!name || !p.snake.length) return;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const chars = name.split('');
  const spacing = Math.max(1, Math.floor(p.snake.length / (chars.length + 1)));
  ctx.font = `bold ${Math.max(10, Math.floor((state.snakeRadius || 9) * scale * 1.1))}px sans-serif`;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';

  chars.forEach((ch, i) => {
    const segIndex = Math.min(p.snake.length - 1, 3 + i * spacing);
    const seg = p.snake[segIndex];
    if (!seg) return;
    const pos = toScreen(seg.x, seg.y);
    ctx.fillText(ch, pos.x, pos.y);
  });

  const head = toScreen(p.snake[0].x, p.snake[0].y);
  const r = (state.snakeRadius || 9) * scale;
  ctx.font = `bold ${Math.max(11, Math.floor(r * 1.4))}px sans-serif`;
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillStyle = '#f8fafc';
  ctx.strokeText(name, head.x, head.y - r * 1.8);
  ctx.fillText(name, head.x, head.y - r * 1.8);
  ctx.restore();
}

function drawJoystick() {
  if (!aiming || state?.status !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const ox = joyOriginX - rect.left;
  const oy = joyOriginY - rect.top;
  const maxR = 54;
  const dist = Math.min(maxR, Math.hypot(joyDX, joyDY));
  const ang = Math.atan2(joyDY, joyDX);
  const kx = ox + Math.cos(ang) * dist;
  const ky = oy + Math.sin(ang) * dist;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, maxR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.arc(kx, ky, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
