const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const GRID_W = 28;
const GRID_H = 40;
const TICK_MS = 100;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const COUNTDOWN_MS = 5000;

const COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24'];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let game = createLobby();

function createLobby() {
  return {
    status: 'lobby',
    players: new Map(),
    apples: [],
    countdownEnd: null,
    tickTimer: null,
    winner: null,
  };
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function getShareUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  return `http://${getLocalIp()}:${PORT}`;
}

function broadcast(msg, excludeId) {
  const data = JSON.stringify(msg);
  for (const [id, p] of game.players) {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const [, p] of game.players) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function sendState(playerId) {
  const p = game.players.get(playerId);
  if (!p || p.ws.readyState !== WebSocket.OPEN) return;
  p.ws.send(JSON.stringify(buildState(playerId)));
}

function buildState(forPlayerId) {
  const readyCount = [...game.players.values()].filter((p) => p.ready).length;
  let countdownRemaining = 0;
  let countdownEnd = null;
  if (game.status === 'countdown' && game.countdownEnd) {
    countdownEnd = game.countdownEnd;
    countdownRemaining = Math.max(0, game.countdownEnd - Date.now());
  }

  return {
    type: 'state',
    status: game.status,
    gridW: GRID_W,
    gridH: GRID_H,
    you: forPlayerId,
    readyCount,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    countdownRemaining,
    countdownEnd,
    winner: game.winner,
    shareUrl: getShareUrl(),
    players: [...game.players.values()].map((pl) => ({
      id: pl.id,
      name: pl.name,
      ready: pl.ready,
      alive: pl.alive,
      score: pl.score,
      color: pl.color,
      snake: pl.snake,
    })),
    apples: game.apples,
  };
}

function broadcastState() {
  for (const [id] of game.players) sendState(id);
}

function occupiedCells(excludeId) {
  const cells = new Set();
  for (const [id, p] of game.players) {
    if (id === excludeId) continue;
    for (const seg of p.snake) cells.add(`${seg.x},${seg.y}`);
  }
  return cells;
}

function allOccupied() {
  const cells = new Set();
  for (const [, p] of game.players) {
    for (const seg of p.snake) cells.add(`${seg.x},${seg.y}`);
  }
  return cells;
}

function spawnApple() {
  const occupied = allOccupied();
  const free = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return;
  game.apples.push(free[Math.floor(Math.random() * free.length)]);
}

function startPositions(count) {
  const slots = [
    { head: { x: 5, y: 5 }, dir: { x: 1, y: 0 } },
    { head: { x: GRID_W - 6, y: 5 }, dir: { x: -1, y: 0 } },
    { head: { x: 5, y: GRID_H - 6 }, dir: { x: 1, y: 0 } },
    { head: { x: GRID_W - 6, y: GRID_H - 6 }, dir: { x: -1, y: 0 } },
  ];
  return slots.slice(0, count);
}

function startGame() {
  game.status = 'playing';
  game.apples = [];
  game.winner = null;

  const readyPlayers = [...game.players.values()].filter((p) => p.ready);
  const positions = startPositions(readyPlayers.length);

  readyPlayers.forEach((p, i) => {
    const slot = positions[i];
    p.alive = true;
    p.score = 0;
    p.snake = [slot.head, { x: slot.head.x - slot.dir.x, y: slot.head.y - slot.dir.y }];
    p.direction = { ...slot.dir };
    p.nextDirection = { ...slot.dir };
  });

  for (let i = 0; i < 3; i++) spawnApple();

  if (game.tickTimer) clearInterval(game.tickTimer);
  game.tickTimer = setInterval(gameTick, TICK_MS);
  broadcastState();
}

function checkCountdown() {
  const readyCount = [...game.players.values()].filter((p) => p.ready).length;
  if (game.status === 'lobby' && readyCount >= MIN_PLAYERS) {
    game.status = 'countdown';
    game.countdownEnd = Date.now() + COUNTDOWN_MS;
    broadcastState();
  }
}

function maybeEndCountdown() {
  if (game.status !== 'countdown') return;
  if (Date.now() >= game.countdownEnd) {
    const readyPlayers = [...game.players.values()].filter((p) => p.ready);
    if (readyPlayers.length >= MIN_PLAYERS) {
      startGame();
    } else {
      game.status = 'lobby';
      game.countdownEnd = null;
      broadcastState();
    }
  }
}

function killPlayer(p) {
  p.alive = false;
}

function checkGameOver() {
  const alive = [...game.players.values()].filter((p) => p.ready && p.alive);
  if (alive.length <= 1) {
    if (game.tickTimer) {
      clearInterval(game.tickTimer);
      game.tickTimer = null;
    }
    game.status = 'ended';
    game.winner = alive[0] ? alive[0].id : null;
    broadcastState();
    return true;
  }
  return false;
}

function willEat(p, nh) {
  return game.apples.some((a) => a.x === nh.x && a.y === nh.y);
}

function gameTick() {
  if (game.status !== 'playing') return;

  for (const [, p] of game.players) {
    if (!p.alive) continue;
    p.direction = { ...p.nextDirection };
  }

  const newHeads = new Map();
  for (const [id, p] of game.players) {
    if (!p.alive) continue;
    const head = p.snake[0];
    // Wrap through walls
    const x = ((head.x + p.direction.x) % GRID_W + GRID_W) % GRID_W;
    const y = ((head.y + p.direction.y) % GRID_H + GRID_H) % GRID_H;
    newHeads.set(id, { x, y });
  }

  // Cells that stay occupied after this tick (exclude vacating tails when not eating)
  const blocked = new Set();
  for (const [id, p] of game.players) {
    if (!p.alive) continue;
    const nh = newHeads.get(id);
    const eating = willEat(p, nh);
    const last = eating ? p.snake.length : p.snake.length - 1;
    for (let i = 0; i < last; i++) {
      blocked.add(`${p.snake[i].x},${p.snake[i].y}`);
    }
  }

  // Head-on / same-cell collisions between snakes
  const headCounts = new Map();
  for (const [id, nh] of newHeads) {
    const p = game.players.get(id);
    if (!p?.alive) continue;
    const key = `${nh.x},${nh.y}`;
    if (!headCounts.has(key)) headCounts.set(key, []);
    headCounts.get(key).push(id);
  }

  for (const [id, p] of game.players) {
    if (!p.alive) continue;
    const nh = newHeads.get(id);
    const key = `${nh.x},${nh.y}`;

    // Body / other snake / self (any remaining body segment)
    if (blocked.has(key)) {
      killPlayer(p);
      continue;
    }

    // Two heads into the same cell
    if ((headCounts.get(key) || []).length > 1) {
      killPlayer(p);
    }
  }

  for (const [id, p] of game.players) {
    if (!p.alive) continue;
    const nh = newHeads.get(id);
    p.snake.unshift(nh);

    let ate = false;
    game.apples = game.apples.filter((a) => {
      if (a.x === nh.x && a.y === nh.y) {
        ate = true;
        p.score += 1;
        return false;
      }
      return true;
    });

    if (!ate) p.snake.pop();
    else spawnApple();
  }

  if (checkGameOver()) return;
  broadcastState();
}

function resetToLobby() {
  if (game.tickTimer) {
    clearInterval(game.tickTimer);
    game.tickTimer = null;
  }
  for (const [, p] of game.players) {
    p.ready = false;
    p.alive = false;
    p.snake = [];
    p.score = 0;
  }
  game.status = 'lobby';
  game.countdownEnd = null;
  game.apples = [];
  game.winner = null;
  broadcastState();
}

wss.on('connection', (ws) => {
  if (game.players.size >= MAX_PLAYERS && game.status === 'lobby') {
    ws.send(JSON.stringify({ type: 'error', message: 'Game is full (max 4 players)' }));
    ws.close();
    return;
  }

  if (game.status === 'playing' || game.status === 'countdown') {
    if (game.players.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
      ws.close();
      return;
    }
  }

  const id = Math.random().toString(36).slice(2, 10);
  const colorIndex = [...game.players.values()].length % COLORS.length;
  const color = COLORS[colorIndex];
  const player = {
    id,
    ws,
    name: '',
    ready: false,
    alive: false,
    score: 0,
    snake: [],
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    color,
  };

  game.players.set(id, player);
  sendState(id);
  broadcastState();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const p = game.players.get(id);
    if (!p) return;

    if (msg.type === 'setName' && typeof msg.name === 'string') {
      p.name = msg.name.trim().slice(0, 12);
      broadcastState();
    }

    if (msg.type === 'ready' && (game.status === 'lobby' || game.status === 'countdown')) {
      if (!p.name) {
        ws.send(JSON.stringify({ type: 'error', message: 'Enter a name for your snake first' }));
        return;
      }
      p.ready = true;
      checkCountdown();
      broadcastState();
    }

    if (msg.type === 'unready' && game.status === 'lobby') {
      p.ready = false;
      broadcastState();
    }

    if (msg.type === 'direction' && game.status === 'playing' && p.alive) {
      const dirs = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
      };
      const nd = dirs[msg.dir];
      if (!nd) return;
      const cur = p.nextDirection;
      if (cur.x + nd.x === 0 && cur.y + nd.y === 0) return;
      p.nextDirection = nd;
    }

    if (msg.type === 'playAgain' && game.status === 'ended') {
      resetToLobby();
    }
  });

  ws.on('close', () => {
    game.players.delete(id);
    if (game.status === 'playing') {
      checkGameOver();
    }
    if (game.status === 'countdown') {
      const readyCount = [...game.players.values()].filter((pl) => pl.ready).length;
      if (readyCount < MIN_PLAYERS) {
        game.status = 'lobby';
        game.countdownEnd = null;
      }
    }
    broadcastState();
  });
});

setInterval(maybeEndCountdown, 200);

server.listen(PORT, '0.0.0.0', () => {
  const url = getShareUrl();
  console.log('');
  console.log('  Snake Online is running!');
  console.log('');
  console.log(`  Public link:  ${url}`);
  console.log(`  Local only:   http://localhost:${PORT}`);
  console.log('');
});
