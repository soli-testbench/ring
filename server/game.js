'use strict';

// --- Constants ---
const ARENA_RADIUS = 500;
const PLAYER_RADIUS = 15;
const PLAYER_SPEED = 200; // pixels per second
const BULLET_SPEED = 600; // pixels per second
const BULLET_RADIUS = 4;
const BULLET_DAMAGE = 34; // ~3 hits to kill
const PLAYER_MAX_HP = 100;
const RING_DAMAGE_PER_SEC = 20;
const SHOOT_COOLDOWN_MS = 300;
const RING_SHRINK_DURATION_MS = 75000; // 75 seconds
const LOBBY_COUNTDOWN_MS = 5000; // 5 second countdown after 2+ players
const ROUND_END_DELAY_MS = 5000; // 5 seconds before resetting
const MIN_PLAYERS_TO_START = 2;
const TICK_RATE = 20; // ticks per second
const TICK_INTERVAL_MS = 1000 / TICK_RATE;

// --- Polygon Geometry Utilities ---

function convexHull(points) {
  // Andrew's monotone chain algorithm — returns CCW convex hull
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 1) return pts;

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0) {
        lower.pop();
      } else break;
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0) {
        upper.pop();
      } else break;
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function generateConvexPolygon(numVertices, radius) {
  // Generate random points, take convex hull, retry until hull has >= numVertices
  for (let attempt = 0; attempt < 50; attempt++) {
    const rawPoints = [];
    // Generate extra points to increase chances the hull has enough vertices
    const count = numVertices * 3;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.75 + Math.random() * 0.25);
      rawPoints.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
      });
    }
    const hull = convexHull(rawPoints);
    if (hull.length >= numVertices) {
      return hull;
    }
  }
  // Fallback: place vertices evenly on circle (guaranteed convex)
  const vertices = [];
  for (let i = 0; i < numVertices; i++) {
    const angle = (i / numVertices) * Math.PI * 2;
    const r = radius * (0.75 + Math.random() * 0.25);
    vertices.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    });
  }
  return vertices;
}

function getPolygonCentroid(vertices) {
  let cx = 0;
  let cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / vertices.length, y: cy / vertices.length };
}

function scalePolygonTowardCentroid(vertices, centroid, t) {
  const factor = 1 - t;
  return vertices.map((v) => ({
    x: centroid.x + (v.x - centroid.x) * factor,
    y: centroid.y + (v.y - centroid.y) * factor,
  }));
}

function pointInConvexPolygon(px, py, vertices) {
  const n = vertices.length;
  if (n < 3) return false;

  // Cross-product sign test with epsilon tolerance for edge cases.
  // Point must be on the same side of every edge (or within epsilon of an edge).
  const EPS = 1e-6;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = vertices[j].x - vertices[i].x;
    const ey = vertices[j].y - vertices[i].y;
    const dx = px - vertices[i].x;
    const dy = py - vertices[i].y;
    const cross = ex * dy - ey * dx;

    if (Math.abs(cross) <= EPS) continue; // on edge — treat as inside

    if (sign === 0) {
      sign = cross > 0 ? 1 : -1;
    } else if ((cross > 0 ? 1 : -1) !== sign) {
      return false;
    }
  }
  return true;
}

function clampPointToPolygon(px, py, vertices) {
  if (pointInConvexPolygon(px, py, vertices)) {
    return { x: px, y: py };
  }

  // Find closest point on polygon boundary
  let bestDist = Infinity;
  let bestX = px;
  let bestY = py;
  const n = vertices.length;
  const centroid = getPolygonCentroid(vertices);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = vertices[i].x;
    const ay = vertices[i].y;
    const bx = vertices[j].x;
    const by = vertices[j].y;

    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;

    const abLen2 = abx * abx + aby * aby;
    let t = abLen2 > 0 ? (apx * abx + apy * aby) / abLen2 : 0;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + abx * t;
    const cy = ay + aby * t;
    const dx = px - cx;
    const dy = py - cy;
    const dist = dx * dx + dy * dy;

    if (dist < bestDist) {
      bestDist = dist;
      bestX = cx;
      bestY = cy;
    }
  }

  // Nudge the clamped point slightly inward toward centroid to avoid floating-point edge issues
  const NUDGE = 0.01;
  bestX = bestX + (centroid.x - bestX) * NUDGE;
  bestY = bestY + (centroid.y - bestY) * NUDGE;

  return { x: bestX, y: bestY };
}

function randomPointInPolygon(vertices, centroid, radiusFraction) {
  // Pick a random edge, choose a random point along it, then lerp from centroid.
  // Validate the result is inside the polygon; retry if not (defensive).
  for (let attempt = 0; attempt < 20; attempt++) {
    const idx = Math.floor(Math.random() * vertices.length);
    const next = (idx + 1) % vertices.length;
    const edgeT = Math.random();
    const edgeX = vertices[idx].x + (vertices[next].x - vertices[idx].x) * edgeT;
    const edgeY = vertices[idx].y + (vertices[next].y - vertices[idx].y) * edgeT;
    const px = centroid.x + (edgeX - centroid.x) * radiusFraction;
    const py = centroid.y + (edgeY - centroid.y) * radiusFraction;
    if (pointInConvexPolygon(px, py, vertices)) {
      return { x: px, y: py };
    }
  }
  // Fallback: centroid is always inside a convex polygon
  return { x: centroid.x, y: centroid.y };
}

// --- Game States ---
const STATE_LOBBY = 'lobby';
const STATE_ACTIVE = 'active';
const STATE_ROUND_END = 'round_end';

class Game {
  constructor() {
    this.players = new Map(); // id -> Player
    this.bullets = []; // array of Bullet
    this.spectators = new Set(); // player ids in spectator mode
    this.state = STATE_LOBBY;
    this.arenaVertices = generateConvexPolygon(
      5 + Math.floor(Math.random() * 6),
      ARENA_RADIUS
    );
    this.arenaCentroid = getPolygonCentroid(this.arenaVertices);
    this.ringVertices = this.arenaVertices.map((v) => ({ x: v.x, y: v.y }));
    this.ringStartTime = 0;
    this.lobbyCountdownStart = 0;
    this.roundEndTime = 0;
    this.winnerId = null;
    this.nextPlayerId = 1;
    this.roundParticipants = 0; // players who started the round
    this.lastTick = Date.now();
    this.tickInterval = null;
    this.onBroadcast = null; // callback for broadcasting state
  }

  start() {
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  addPlayer(ws) {
    const id = this.nextPlayerId++;
    const player = {
      id,
      ws,
      x: 0,
      y: 0,
      angle: 0,
      hp: PLAYER_MAX_HP,
      alive: true,
      lastShot: 0,
      input: { up: false, down: false, left: false, right: false },
      name: `Player ${id}`,
    };

    if (this.state === STATE_ACTIVE || this.state === STATE_ROUND_END) {
      // Mid-match: spectator mode
      this.spectators.add(id);
      player.alive = false;
    } else {
      // Lobby: spawn around the edge
      this.spawnPlayer(player);
    }

    this.players.set(id, player);
    return id;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.spectators.delete(id);

    // Check win condition if game is active
    if (this.state === STATE_ACTIVE) {
      this.checkWinCondition();
    }

    // Check lobby state
    if (this.state === STATE_LOBBY) {
      this.checkLobbyStart();
    }
  }

  spawnPlayer(player) {
    const point = randomPointInPolygon(
      this.arenaVertices,
      this.arenaCentroid,
      0.8
    );
    player.x = point.x;
    player.y = point.y;
    player.hp = PLAYER_MAX_HP;
    player.alive = true;
    player.lastShot = 0;
  }

  setPlayerName(playerId, name) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (typeof name !== 'string') {
      player.name = `Player ${playerId}`;
      return;
    }
    const trimmed = name.trim().slice(0, 16);
    player.name = trimmed || `Player ${playerId}`;
  }

  handleInput(playerId, input) {
    const player = this.players.get(playerId);
    if (!player || !player.alive || this.spectators.has(playerId)) return;

    // Validate and sanitize input
    if (input.keys) {
      player.input.up = !!input.keys.up;
      player.input.down = !!input.keys.down;
      player.input.left = !!input.keys.left;
      player.input.right = !!input.keys.right;
    }

    if (typeof input.angle === 'number' && isFinite(input.angle)) {
      player.angle = input.angle;
    }

    if (input.shoot && this.state === STATE_ACTIVE) {
      this.tryShoot(player);
    }
  }

  tryShoot(player) {
    const now = Date.now();
    if (now - player.lastShot < SHOOT_COOLDOWN_MS) return;
    player.lastShot = now;

    const bullet = {
      id: Math.random().toString(36).substr(2, 9),
      ownerId: player.id,
      x: player.x + Math.cos(player.angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2),
      y: player.y + Math.sin(player.angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2),
      vx: Math.cos(player.angle) * BULLET_SPEED,
      vy: Math.sin(player.angle) * BULLET_SPEED,
      radius: BULLET_RADIUS,
      damage: BULLET_DAMAGE,
      createdAt: now,
    };

    this.bullets.push(bullet);
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (this.state === STATE_LOBBY) {
      this.tickLobby(now);
    } else if (this.state === STATE_ACTIVE) {
      this.tickActive(dt, now);
    } else if (this.state === STATE_ROUND_END) {
      this.tickRoundEnd(now);
    }

    this.broadcast();
  }

  tickLobby(now) {
    const aliveCount = this.getAlivePlayers().length;

    if (aliveCount >= MIN_PLAYERS_TO_START) {
      if (this.lobbyCountdownStart === 0) {
        this.lobbyCountdownStart = now;
      } else if (now - this.lobbyCountdownStart >= LOBBY_COUNTDOWN_MS) {
        this.startRound();
      }
    } else {
      this.lobbyCountdownStart = 0;
    }
  }

  startRound() {
    this.state = STATE_ACTIVE;
    this.ringVertices = this.arenaVertices.map((v) => ({ x: v.x, y: v.y }));
    this.ringStartTime = Date.now();
    this.bullets = [];
    this.winnerId = null;

    // Respawn all non-spectator players inside the polygon
    const totalPlayers = this.getNonSpectatorPlayers().length;
    this.roundParticipants = totalPlayers;
    let index = 0;
    for (const player of this.players.values()) {
      if (!this.spectators.has(player.id)) {
        // Distribute players around polygon at 80% distance from centroid
        const vertIdx = index % this.arenaVertices.length;
        const v = this.arenaVertices[vertIdx];
        player.x = this.arenaCentroid.x + (v.x - this.arenaCentroid.x) * 0.8;
        player.y = this.arenaCentroid.y + (v.y - this.arenaCentroid.y) * 0.8;
        player.hp = PLAYER_MAX_HP;
        player.alive = true;
        player.lastShot = 0;
        index++;
      }
    }
  }

  tickActive(dt, now) {
    // Update ring (shrink polygon toward centroid)
    const elapsed = now - this.ringStartTime;
    const shrinkProgress = Math.min(elapsed / RING_SHRINK_DURATION_MS, 1);
    this.ringVertices = scalePolygonTowardCentroid(
      this.arenaVertices,
      this.arenaCentroid,
      shrinkProgress * 0.95
    );

    // Move players
    for (const player of this.players.values()) {
      if (!player.alive || this.spectators.has(player.id)) continue;
      this.movePlayer(player, dt);
    }

    // Move bullets
    this.updateBullets(dt, now);

    // Ring damage
    this.applyRingDamage(dt);

    // Check win condition
    this.checkWinCondition();
  }

  movePlayer(player, dt) {
    let dx = 0;
    let dy = 0;

    if (player.input.left) dx -= 1;
    if (player.input.right) dx += 1;
    if (player.input.up) dy -= 1;
    if (player.input.down) dy += 1;

    // Normalize diagonal movement
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 0) {
      dx = (dx / mag) * PLAYER_SPEED * dt;
      dy = (dy / mag) * PLAYER_SPEED * dt;
    }

    const newX = player.x + dx;
    const newY = player.y + dy;

    // Server-authoritative: clamp to polygon arena bounds
    if (pointInConvexPolygon(newX, newY, this.arenaVertices)) {
      player.x = newX;
      player.y = newY;
    } else {
      const clamped = clampPointToPolygon(newX, newY, this.arenaVertices);
      player.x = clamped.x;
      player.y = clamped.y;
    }
  }

  updateBullets(dt, now) {
    const maxAge = 2000; // bullets expire after 2 seconds

    this.bullets = this.bullets.filter((bullet) => {
      if (now - bullet.createdAt > maxAge) return false;

      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      // Check collision with players first (before boundary removal)
      for (const player of this.players.values()) {
        if (!player.alive || player.id === bullet.ownerId) continue;
        if (this.spectators.has(player.id)) continue;

        const pdx = player.x - bullet.x;
        const pdy = player.y - bullet.y;
        const pdist = Math.sqrt(pdx * pdx + pdy * pdy);

        if (pdist < PLAYER_RADIUS + bullet.radius) {
          player.hp -= bullet.damage;
          if (player.hp <= 0) {
            player.hp = 0;
            player.alive = false;
          }
          return false; // bullet consumed
        }
      }

      // Check if bullet is outside arena polygon
      if (!pointInConvexPolygon(bullet.x, bullet.y, this.arenaVertices)) return false;

      return true;
    });
  }

  applyRingDamage(dt) {
    for (const player of this.players.values()) {
      if (!player.alive || this.spectators.has(player.id)) continue;

      if (!pointInConvexPolygon(player.x, player.y, this.ringVertices)) {
        player.hp -= RING_DAMAGE_PER_SEC * dt;
        if (player.hp <= 0) {
          player.hp = 0;
          player.alive = false;
        }
      }
    }
  }

  checkWinCondition() {
    const alive = this.getAlivePlayers();

    if (alive.length <= 1 && this.roundParticipants >= MIN_PLAYERS_TO_START) {
      this.state = STATE_ROUND_END;
      this.roundEndTime = Date.now();
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      this.bullets = [];
    }
  }

  tickRoundEnd(now) {
    if (now - this.roundEndTime >= ROUND_END_DELAY_MS) {
      this.resetForNextRound();
    }
  }

  resetForNextRound() {
    this.state = STATE_LOBBY;
    this.arenaVertices = generateConvexPolygon(
      5 + Math.floor(Math.random() * 6),
      ARENA_RADIUS
    );
    this.arenaCentroid = getPolygonCentroid(this.arenaVertices);
    this.ringVertices = this.arenaVertices.map((v) => ({ x: v.x, y: v.y }));
    this.bullets = [];
    this.winnerId = null;
    this.lobbyCountdownStart = 0;
    this.roundParticipants = 0;

    // Move spectators back to active players
    this.spectators.clear();

    // Respawn all players inside the polygon
    let index = 0;
    for (const player of this.players.values()) {
      const vertIdx = index % this.arenaVertices.length;
      const v = this.arenaVertices[vertIdx];
      player.x = this.arenaCentroid.x + (v.x - this.arenaCentroid.x) * 0.8;
      player.y = this.arenaCentroid.y + (v.y - this.arenaCentroid.y) * 0.8;
      player.hp = PLAYER_MAX_HP;
      player.alive = true;
      player.lastShot = 0;
      player.input = { up: false, down: false, left: false, right: false };
      index++;
    }
  }

  getAlivePlayers() {
    const result = [];
    for (const player of this.players.values()) {
      if (player.alive && !this.spectators.has(player.id)) {
        result.push(player);
      }
    }
    return result;
  }

  getNonSpectatorPlayers() {
    const result = [];
    for (const player of this.players.values()) {
      if (!this.spectators.has(player.id)) {
        result.push(player);
      }
    }
    return result;
  }

  getState(forPlayerId) {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        hp: p.hp,
        alive: p.alive,
        name: p.name,
        isSpectator: this.spectators.has(p.id),
      });
    }

    const lobbyCountdown =
      this.state === STATE_LOBBY && this.lobbyCountdownStart > 0
        ? Math.max(0, LOBBY_COUNTDOWN_MS - (Date.now() - this.lobbyCountdownStart))
        : null;

    return {
      type: 'state',
      gameState: this.state,
      arenaRadius: ARENA_RADIUS,
      arenaVertices: this.arenaVertices,
      ringVertices: this.ringVertices,
      players,
      bullets: this.bullets.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        ownerId: b.ownerId,
      })),
      winnerId: this.winnerId,
      yourId: forPlayerId,
      isSpectator: this.spectators.has(forPlayerId),
      lobbyCountdown,
    };
  }

  broadcast() {
    if (this.onBroadcast) {
      this.onBroadcast();
    }
  }
}

module.exports = {
  Game,
  ARENA_RADIUS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  BULLET_SPEED,
  BULLET_RADIUS,
  BULLET_DAMAGE,
  PLAYER_MAX_HP,
  RING_DAMAGE_PER_SEC,
  SHOOT_COOLDOWN_MS,
  RING_SHRINK_DURATION_MS,
  LOBBY_COUNTDOWN_MS,
  ROUND_END_DELAY_MS,
  MIN_PLAYERS_TO_START,
  TICK_RATE,
  STATE_LOBBY,
  STATE_ACTIVE,
  STATE_ROUND_END,
  generateConvexPolygon,
  getPolygonCentroid,
  scalePolygonTowardCentroid,
  pointInConvexPolygon,
  clampPointToPolygon,
};
