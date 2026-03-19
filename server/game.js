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
    this.ringRadius = ARENA_RADIUS;
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
    const count = this.getAlivePlayers().length + 1;
    const angle = (Math.PI * 2 * count) / Math.max(count, 8) + Math.random() * 0.3;
    const spawnRadius = ARENA_RADIUS * 0.8;
    player.x = Math.cos(angle) * spawnRadius;
    player.y = Math.sin(angle) * spawnRadius;
    player.hp = PLAYER_MAX_HP;
    player.alive = true;
    player.lastShot = 0;
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
    this.ringRadius = ARENA_RADIUS;
    this.ringStartTime = Date.now();
    this.bullets = [];
    this.winnerId = null;

    // Respawn all non-spectator players around the edge
    const totalPlayers = this.getNonSpectatorPlayers().length;
    this.roundParticipants = totalPlayers;
    let index = 0;
    for (const player of this.players.values()) {
      if (!this.spectators.has(player.id)) {
        const angle = (Math.PI * 2 * index) / Math.max(totalPlayers, 2);
        const spawnRadius = ARENA_RADIUS * 0.8;
        player.x = Math.cos(angle) * spawnRadius;
        player.y = Math.sin(angle) * spawnRadius;
        player.hp = PLAYER_MAX_HP;
        player.alive = true;
        player.lastShot = 0;
        index++;
      }
    }
  }

  tickActive(dt, now) {
    // Update ring
    const elapsed = now - this.ringStartTime;
    const shrinkProgress = Math.min(elapsed / RING_SHRINK_DURATION_MS, 1);
    this.ringRadius = ARENA_RADIUS * (1 - shrinkProgress * 0.95); // shrinks to 5% of original

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

    // Server-authoritative: clamp to arena bounds
    const distFromCenter = Math.sqrt(newX * newX + newY * newY);
    if (distFromCenter <= ARENA_RADIUS) {
      player.x = newX;
      player.y = newY;
    } else {
      // Push to arena edge
      const scale = ARENA_RADIUS / distFromCenter;
      player.x = newX * scale;
      player.y = newY * scale;
    }
  }

  updateBullets(dt, now) {
    const maxAge = 2000; // bullets expire after 2 seconds

    this.bullets = this.bullets.filter((bullet) => {
      if (now - bullet.createdAt > maxAge) return false;

      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      // Check if bullet is outside arena
      const dist = Math.sqrt(bullet.x * bullet.x + bullet.y * bullet.y);
      if (dist > ARENA_RADIUS + 50) return false;

      // Check collision with players
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

      return true;
    });
  }

  applyRingDamage(dt) {
    for (const player of this.players.values()) {
      if (!player.alive || this.spectators.has(player.id)) continue;

      const dist = Math.sqrt(player.x * player.x + player.y * player.y);
      if (dist > this.ringRadius) {
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
    this.ringRadius = ARENA_RADIUS;
    this.bullets = [];
    this.winnerId = null;
    this.lobbyCountdownStart = 0;
    this.roundParticipants = 0;

    // Move spectators back to active players
    this.spectators.clear();

    // Respawn all players
    let index = 0;
    const total = this.players.size;
    for (const player of this.players.values()) {
      const angle = (Math.PI * 2 * index) / Math.max(total, 2);
      const spawnRadius = ARENA_RADIUS * 0.8;
      player.x = Math.cos(angle) * spawnRadius;
      player.y = Math.sin(angle) * spawnRadius;
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
      ringRadius: this.ringRadius,
      arenaRadius: ARENA_RADIUS,
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
};
