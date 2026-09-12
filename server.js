const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const WORLD_W = 900;
const WORLD_H = 1400;
const TICK_MS = 50;
const SPEED = 4.4;
const TURN_RATE = 0.14;
const SEGMENT_SPACING = 6;
const BASE_SEGMENTS = 14;
const GROW_PER_APPLE = 5;
const YELLOW_GROW_MULT = 5;
const SNAKE_RADIUS = 9;
const APPLE_RADIUS = 8;
const SELF_SAFE_SEGMENTS = 10;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const COUNTDOWN_MS = 5000;
const APPLE_COUNT = 10;
const SCORE_TO_WIN = 50;
const BLUE_BOOST_MS = 10000;
const BLUE_SPEED_MULT = 2;

const APPLE_TYPES = {
  red: { points: 1, grow: GROW_PER_APPLE, weight: 60 },
  yellow: { points: 3, grow: GROW_PER_APPLE * YELLOW_GROW_MULT, weight: 25 },
  blue: { points: 2, grow: GROW_PER_APPLE, weight: 15, boostMs: BLUE_BOOST_MS },
};

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

function wrap(v, max) {
  return ((v % max) + max) % max;
}

function wrapDelta(a, b, max) {
  let d = a - b;
  if (d > max / 2) d -= max;
  if (d < -max / 2) d += max;
  return d;
}

function distWrapped(ax, ay, bx, by) {
  const dx = wrapDelta(ax, bx, WORLD_W);
  const dy = wrapDelta(ay, by, WORLD_H);
  return Math.hypot(dx, dy);
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turnToward(current, target, maxStep) {
  let diff = normalizeAngle(target - current);
  if (diff > maxStep) diff = maxStep;
  if (diff < -maxStep) diff = -maxStep;
  return normalizeAngle(current + diff);
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
    worldW: WORLD_W,
    worldH: WORLD_H,
    snakeRadius: SNAKE_RADIUS,
    appleRadius: APPLE_RADIUS,
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
      angle: pl.angle,
      snake: pl.snake,
      boosted: pl.boostUntil > Date.now(),
      boostRemaining: Math.max(0, (pl.boostUntil || 0) - Date.now()),
    })),
    apples: game.apples,
    scoreToWin: SCORE_TO_WIN,
  };
}

function broadcastState() {
  for (const [id] of game.players) sendState(id);
}

function pickAppleKind() {
  const entries = Object.entries(APPLE_TYPES);
  const total = entries.reduce((sum, [, t]) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for (const [kind, t] of entries) {
    roll -= t.weight;
    if (roll <= 0) return kind;
  }
  return 'red';
}

function spawnApple() {
  const kind = pickAppleKind();
  for (let attempt = 0; attempt < 40; attempt++) {
    const apple = {
      x: Math.random() * WORLD_W,
      y: Math.random() * WORLD_H,
      kind,
    };
    let clear = true;
    for (const [, p] of game.players) {
      if (!p.alive) continue;
      for (const seg of p.snake) {
        if (distWrapped(apple.x, apple.y, seg.x, seg.y) < SNAKE_RADIUS * 2.5) {
          clear = false;
          break;
        }
      }
      if (!clear) break;
    }
    if (clear) {
      game.apples.push(apple);
      return;
    }
  }
  game.apples.push({
    x: Math.random() * WORLD_W,
    y: Math.random() * WORLD_H,
    kind,
  });
}

function buildSnake(x, y, angle, segments) {
  const snake = [];
  for (let i = 0; i < segments; i++) {
    snake.push({
      x: wrap(x - Math.cos(angle) * i * SEGMENT_SPACING, WORLD_W),
      y: wrap(y - Math.sin(angle) * i * SEGMENT_SPACING, WORLD_H),
    });
  }
  return snake;
}

function startPositions(count) {
  const slots = [
    { x: WORLD_W * 0.2, y: WORLD_H * 0.2, angle: 0 },
    { x: WORLD_W * 0.8, y: WORLD_H * 0.2, angle: Math.PI },
    { x: WORLD_W * 0.2, y: WORLD_H * 0.8, angle: 0 },
    { x: WORLD_W * 0.8, y: WORLD_H * 0.8, angle: Math.PI },
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
    p.angle = slot.angle;
    p.targetAngle = slot.angle;
    p.targetLength = BASE_SEGMENTS * SEGMENT_SPACING;
    p.boostUntil = 0;
    p.snake = buildSnake(slot.x, slot.y, slot.angle, BASE_SEGMENTS);
  });

  for (let i = 0; i < APPLE_COUNT; i++) spawnApple();

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

function endGame(winnerId) {
  if (game.tickTimer) {
    clearInterval(game.tickTimer);
    game.tickTimer = null;
  }
  game.status = 'ended';
  game.winner = winnerId;
  broadcastState();
}

function checkGameOver() {
  const scored = [...game.players.values()]
    .filter((p) => p.ready)
    .find((p) => p.score >= SCORE_TO_WIN);
  if (scored) {
    endGame(scored.id);
    return true;
  }

  const alive = [...game.players.values()].filter((p) => p.ready && p.alive);
  if (alive.length <= 1) {
    endGame(alive[0] ? alive[0].id : null);
    return true;
  }
  return false;
}

function pathLength(snake) {
  let len = 0;
  for (let i = 1; i < snake.length; i++) {
    len += distWrapped(snake[i].x, snake[i].y, snake[i - 1].x, snake[i - 1].y);
  }
  return len;
}

function trimSnake(snake, targetLen) {
  while (snake.length > 2 && pathLength(snake) > targetLen) {
    snake.pop();
  }
}

function gameTick() {
  if (game.status !== 'playing') return;

  for (const [, p] of game.players) {
    if (!p.alive || p.snake.length === 0) continue;

    p.angle = turnToward(p.angle, p.targetAngle, TURN_RATE);
    const boosted = p.boostUntil > Date.now();
    const speed = SPEED * (boosted ? BLUE_SPEED_MULT : 1);
    const head = p.snake[0];
    const nx = wrap(head.x + Math.cos(p.angle) * speed, WORLD_W);
    const ny = wrap(head.y + Math.sin(p.angle) * speed, WORLD_H);
    p.snake.unshift({ x: nx, y: ny });
    trimSnake(p.snake, p.targetLength);
  }

  for (const [, p] of game.players) {
    if (!p.alive || p.snake.length === 0) continue;
    const head = p.snake[0];

    game.apples = game.apples.filter((a) => {
      if (distWrapped(head.x, head.y, a.x, a.y) < SNAKE_RADIUS + APPLE_RADIUS) {
        const kind = a.kind && APPLE_TYPES[a.kind] ? a.kind : 'red';
        const info = APPLE_TYPES[kind];
        p.score += info.points;
        p.targetLength += info.grow * SEGMENT_SPACING;
        if (info.boostMs) {
          p.boostUntil = Math.max(p.boostUntil || 0, Date.now()) + info.boostMs;
        }
        spawnApple();
        return false;
      }
      return true;
    });
  }

  for (const [id, p] of game.players) {
    if (!p.alive || p.snake.length === 0) continue;
    const head = p.snake[0];

    outer: for (const [oid, op] of game.players) {
      if (!op.alive) continue;
      const start = oid === id ? SELF_SAFE_SEGMENTS : 0;
      for (let i = start; i < op.snake.length; i++) {
        const seg = op.snake[i];
        if (distWrapped(head.x, head.y, seg.x, seg.y) < SNAKE_RADIUS * 1.7) {
          killPlayer(p);
          break outer;
        }
      }
    }
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
    p.angle = 0;
    p.targetAngle = 0;
    p.targetLength = BASE_SEGMENTS * SEGMENT_SPACING;
    p.boostUntil = 0;
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
    angle: 0,
    targetAngle: 0,
    targetLength: BASE_SEGMENTS * SEGMENT_SPACING,
    boostUntil: 0,
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

    if (msg.type === 'aim' && game.status === 'playing' && p.alive) {
      if (typeof msg.angle === 'number' && Number.isFinite(msg.angle)) {
        p.targetAngle = normalizeAngle(msg.angle);
      }
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
