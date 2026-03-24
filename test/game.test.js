'use strict';

const {
  Game,
  ARENA_RADIUS,
  PLAYER_MAX_HP,
  BULLET_DAMAGE,
  STATE_LOBBY,
  STATE_ACTIVE,
  STATE_ROUND_END,
  MIN_PLAYERS_TO_START,
  RING_SHRINK_DURATION_MS,
  SHOOT_COOLDOWN_MS,
  MACHINE_GUN_COOLDOWN_MS,
  PICKUP_COLLECT_RADIUS,
  MAX_NPC_COUNT,
  MIN_REAL_PLAYERS_FOR_NO_BOTS,
  generateConvexPolygon,
  getPolygonCentroid,
  scalePolygonTowardCentroid,
  pointInConvexPolygon,
  clampPointToPolygon,
  NPC_SHOOT_RANGE,
  NPC_SHOOT_ANGLE_TOLERANCE,
  NPC_REACTION_DELAY_MS,
  NPC_STRAFE_RANGE,
  NPC_WANDER_INTERVAL_MS,
  NPC_COUNT,
} = require('../server/game');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function test(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// --- Polygon Utility Tests ---

test('generateConvexPolygon produces valid polygon', () => {
  for (let n = 5; n <= 10; n++) {
    const poly = generateConvexPolygon(n, ARENA_RADIUS);
    assert(poly.length >= n, `polygon has at least ${n} vertices (got ${poly.length})`);
    for (const v of poly) {
      const dist = Math.sqrt(v.x * v.x + v.y * v.y);
      assert(dist <= ARENA_RADIUS * 1.01, `vertex within radius (dist=${dist.toFixed(1)})`);
      assert(dist >= ARENA_RADIUS * 0.74, `vertex not too close to center (dist=${dist.toFixed(1)})`);
    }
  }
});

test('getPolygonCentroid returns center of polygon', () => {
  const square = [
    { x: -100, y: -100 },
    { x: 100, y: -100 },
    { x: 100, y: 100 },
    { x: -100, y: 100 },
  ];
  const c = getPolygonCentroid(square);
  assert(Math.abs(c.x) < 0.01, 'centroid x near zero');
  assert(Math.abs(c.y) < 0.01, 'centroid y near zero');
});

test('pointInConvexPolygon correctly classifies points', () => {
  // CCW square
  const square = [
    { x: -100, y: -100 },
    { x: -100, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: -100 },
  ];
  assert(pointInConvexPolygon(0, 0, square), 'center is inside');
  assert(pointInConvexPolygon(50, 50, square), 'interior point is inside');
  assert(!pointInConvexPolygon(200, 0, square), 'point far right is outside');
  assert(!pointInConvexPolygon(0, 200, square), 'point far below is outside');
  assert(!pointInConvexPolygon(-200, -200, square), 'point far top-left is outside');
});

test('scalePolygonTowardCentroid shrinks polygon', () => {
  const square = [
    { x: -100, y: -100 },
    { x: 100, y: -100 },
    { x: 100, y: 100 },
    { x: -100, y: 100 },
  ];
  const centroid = getPolygonCentroid(square);
  const scaled = scalePolygonTowardCentroid(square, centroid, 0.5);

  // Each vertex should be at half the distance from centroid
  for (let i = 0; i < square.length; i++) {
    const origDist = Math.sqrt(
      (square[i].x - centroid.x) ** 2 + (square[i].y - centroid.y) ** 2
    );
    const scaledDist = Math.sqrt(
      (scaled[i].x - centroid.x) ** 2 + (scaled[i].y - centroid.y) ** 2
    );
    assert(Math.abs(scaledDist - origDist * 0.5) < 0.01, `vertex ${i} scaled correctly`);
  }
});

test('clampPointToPolygon clamps outside points', () => {
  // CCW square
  const square = [
    { x: -100, y: -100 },
    { x: -100, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: -100 },
  ];

  // Point inside stays unchanged
  const inside = clampPointToPolygon(50, 50, square);
  assert(Math.abs(inside.x - 50) < 0.01, 'inside point x unchanged');
  assert(Math.abs(inside.y - 50) < 0.01, 'inside point y unchanged');

  // Point outside gets clamped near the edge (nudged slightly inward toward centroid)
  const outside = clampPointToPolygon(200, 0, square);
  assert(Math.abs(outside.x - 100) < 2, 'clamped x near edge');
  assert(Math.abs(outside.y - 0) < 2, 'clamped y near edge');
  assert(pointInConvexPolygon(outside.x, outside.y, square), 'clamped point is inside polygon');
});

// --- Game Tests ---

test('Game initializes in lobby state with polygon arena', () => {
  const game = new Game();
  assert(game.state === STATE_LOBBY, 'state is lobby');
  assert(Array.isArray(game.arenaVertices), 'arenaVertices is array');
  assert(game.arenaVertices.length >= 5, 'at least 5 vertices');
  assert(Array.isArray(game.ringVertices), 'ringVertices is array');
  assert(game.ringVertices.length === game.arenaVertices.length, 'ring matches arena vertex count');
  assert(game.arenaCentroid && typeof game.arenaCentroid.x === 'number', 'has centroid');
  assert(game.players.size === 0, 'no players');
});

test('Players can join and are assigned IDs', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);
  assert(id1 !== id2, 'unique IDs');
  assert(game.players.size === 2, 'two players in game');
  assert(game.players.get(id1).alive, 'player 1 alive');
  assert(game.players.get(id2).alive, 'player 2 alive');
});

test('Players spawn inside polygon arena in lobby', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const player = game.players.get(id);
  const dist = Math.sqrt(player.x * player.x + player.y * player.y);
  assert(dist > 0, 'player spawned away from center');
  assert(
    pointInConvexPolygon(player.x, player.y, game.arenaVertices),
    'player within arena polygon'
  );
});

test('Players joining during active game become spectators', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  // Force game to active state
  game.startRound();
  assert(game.state === STATE_ACTIVE, 'game is active');

  const mockWs3 = { readyState: 1, send: () => {} };
  const id3 = game.addPlayer(mockWs3);
  assert(game.spectators.has(id3), 'new player is spectator');
  assert(!game.players.get(id3).alive, 'spectator not alive');
});

test('Player removal during active game checks win condition', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  game.startRound();
  assert(game.state === STATE_ACTIVE, 'game active');

  game.removePlayer(id2);
  assert(game.state === STATE_ROUND_END, 'round ended after player disconnect');
  assert(game.winnerId === id1, 'remaining player wins');
});

test('Input handling updates player state', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);

  game.handleInput(id, { keys: { up: true, down: false, left: false, right: false }, angle: 1.5 });
  const player = game.players.get(id);
  assert(player.input.up === true, 'up key set');
  assert(player.angle === 1.5, 'angle set');
});

test('Movement is clamped to polygon arena bounds', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const player = game.players.get(id);

  // Move player far outside polygon
  player.x = ARENA_RADIUS + 100;
  player.y = 0;
  player.input.right = true;

  game.movePlayer(player, 1);
  assert(
    pointInConvexPolygon(player.x, player.y, game.arenaVertices),
    'player clamped to polygon arena'
  );
});

test('Ring shrinks during active game (polygon contracts toward centroid)', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const initialRingVertices = game.ringVertices.map((v) => ({ x: v.x, y: v.y }));

  // Simulate some time passing
  game.ringStartTime = Date.now() - RING_SHRINK_DURATION_MS / 2;
  game.tickActive(0.05, Date.now());

  // Ring vertices should be closer to centroid
  const centroid = game.arenaCentroid;
  let initialAvgDist = 0;
  let newAvgDist = 0;
  for (let i = 0; i < initialRingVertices.length; i++) {
    initialAvgDist += Math.sqrt(
      (initialRingVertices[i].x - centroid.x) ** 2 +
        (initialRingVertices[i].y - centroid.y) ** 2
    );
    newAvgDist += Math.sqrt(
      (game.ringVertices[i].x - centroid.x) ** 2 +
        (game.ringVertices[i].y - centroid.y) ** 2
    );
  }
  assert(newAvgDist < initialAvgDist, 'ring has shrunk toward centroid');
  assert(newAvgDist > 0, 'ring still has some size');
});

test('Ring damage applies to players outside ring polygon', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  // Shrink ring very small
  game.ringVertices = scalePolygonTowardCentroid(
    game.arenaVertices,
    game.arenaCentroid,
    0.98
  );
  const player = game.players.get(id1);
  // Place player at a known position outside the tiny ring but inside arena
  const v = game.arenaVertices[0];
  player.x = game.arenaCentroid.x + (v.x - game.arenaCentroid.x) * 0.5;
  player.y = game.arenaCentroid.y + (v.y - game.arenaCentroid.y) * 0.5;

  const hpBefore = player.hp;
  game.applyRingDamage(1);
  assert(player.hp < hpBefore, 'player took ring damage');
});

test('Shooting creates bullets', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id1);
  player.angle = 0;

  game.tryShoot(player);
  assert(game.bullets.length === 1, 'one bullet created');
  assert(game.bullets[0].ownerId === id1, 'bullet owned by shooter');
});

test('Bullets damage players on collision', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  game.startRound();
  const p1 = game.players.get(id1);
  const p2 = game.players.get(id2);

  // Place bullet right on top of player 2
  game.bullets.push({
    id: 'test',
    ownerId: id1,
    x: p2.x,
    y: p2.y,
    vx: 0,
    vy: 0,
    radius: 4,
    damage: BULLET_DAMAGE,
    createdAt: Date.now(),
  });

  const hpBefore = p2.hp;
  game.updateBullets(0.05, Date.now());
  assert(p2.hp < hpBefore, 'player 2 took bullet damage');
  assert(game.bullets.length === 0, 'bullet consumed on hit');
});

test('Bullets removed when exiting polygon arena', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  // Place a bullet far outside the arena polygon
  game.bullets.push({
    id: 'outside',
    ownerId: 1,
    x: ARENA_RADIUS * 3,
    y: ARENA_RADIUS * 3,
    vx: 100,
    vy: 0,
    radius: 4,
    damage: BULLET_DAMAGE,
    createdAt: Date.now(),
  });

  game.updateBullets(0.05, Date.now());
  assert(game.bullets.length === 0, 'bullet outside polygon removed');
});

test('Game state serialization includes polygon vertices', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const state = game.getState(id);

  assert(state.type === 'state', 'has type');
  assert(state.gameState === STATE_LOBBY, 'has gameState');
  assert(Array.isArray(state.arenaVertices), 'has arenaVertices array');
  assert(state.arenaVertices.length >= 5, 'arenaVertices has 5+ vertices');
  assert(Array.isArray(state.ringVertices), 'has ringVertices array');
  assert(state.ringVertices.length >= 5, 'ringVertices has 5+ vertices');
  assert(Array.isArray(state.players), 'has players array');
  assert(Array.isArray(state.bullets), 'has bullets array');
  assert(state.yourId === id, 'has yourId');
});

test('Each new round generates a different polygon shape via resetForNextRound', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const firstVertices = game.arenaVertices.map((v) => ({ x: v.x, y: v.y }));

  // Reset generates a new polygon for the next round
  game.state = STATE_ROUND_END;
  game.resetForNextRound();
  const secondVertices = game.arenaVertices;

  // Vertices should differ (extremely unlikely to be identical with random generation)
  let same = true;
  if (firstVertices.length !== secondVertices.length) {
    same = false;
  } else {
    for (let i = 0; i < firstVertices.length; i++) {
      if (
        Math.abs(firstVertices[i].x - secondVertices[i].x) > 0.01 ||
        Math.abs(firstVertices[i].y - secondVertices[i].y) > 0.01
      ) {
        same = false;
        break;
      }
    }
  }
  assert(!same, 'resetForNextRound produces different polygon vertices');
});

test('Countdown map matches round map (startRound preserves polygon)', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  // Capture the polygon visible during lobby/countdown
  const lobbyVertices = game.arenaVertices.map((v) => ({ x: v.x, y: v.y }));
  const lobbyCentroid = { x: game.arenaCentroid.x, y: game.arenaCentroid.y };

  // Start the round (simulates countdown ending)
  game.startRound();

  // arenaVertices and centroid should be identical to the lobby values
  assert(
    game.arenaVertices.length === lobbyVertices.length,
    'vertex count unchanged after startRound'
  );
  let verticesMatch = true;
  for (let i = 0; i < lobbyVertices.length; i++) {
    if (
      Math.abs(game.arenaVertices[i].x - lobbyVertices[i].x) > 0.001 ||
      Math.abs(game.arenaVertices[i].y - lobbyVertices[i].y) > 0.001
    ) {
      verticesMatch = false;
      break;
    }
  }
  assert(verticesMatch, 'arena vertices identical before and after startRound');
  assert(
    Math.abs(game.arenaCentroid.x - lobbyCentroid.x) < 0.001 &&
      Math.abs(game.arenaCentroid.y - lobbyCentroid.y) < 0.001,
    'centroid identical before and after startRound'
  );
});

test('Spawned players are inside polygon after startRound', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  game.startRound();
  const p1 = game.players.get(id1);
  const p2 = game.players.get(id2);

  assert(
    pointInConvexPolygon(p1.x, p1.y, game.arenaVertices),
    'player 1 spawned inside polygon'
  );
  assert(
    pointInConvexPolygon(p2.x, p2.y, game.arenaVertices),
    'player 2 spawned inside polygon'
  );
});

test('Round lifecycle: lobby -> active -> end -> reset', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  assert(game.state === STATE_LOBBY, 'starts in lobby');

  game.startRound();
  assert(game.state === STATE_ACTIVE, 'transitions to active');

  // Kill player 2
  const p2 = game.players.get(id2);
  p2.hp = 0;
  p2.alive = false;
  game.checkWinCondition();
  assert(game.state === STATE_ROUND_END, 'transitions to round_end');
  assert(game.winnerId === id1, 'player 1 wins');

  game.resetForNextRound();
  assert(game.state === STATE_LOBBY, 'resets to lobby');
  assert(game.players.get(id1).alive, 'player 1 alive after reset');
  assert(game.players.get(id2).alive, 'player 2 alive after reset');
  assert(game.spectators.size === 0, 'no spectators after reset');
});

test('Spectators become players after round reset', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();

  const mockWs3 = { readyState: 1, send: () => {} };
  const id3 = game.addPlayer(mockWs3);
  assert(game.spectators.has(id3), 'joined as spectator');

  // End round and reset
  game.state = STATE_ROUND_END;
  game.resetForNextRound();
  assert(!game.spectators.has(id3), 'no longer spectator after reset');
  assert(game.players.get(id3).alive, 'now alive and ready to play');
});

test('Shoot cooldown prevents rapid fire', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  const id = game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id);

  game.tryShoot(player);
  assert(game.bullets.length === 1, 'first shot fires');

  game.tryShoot(player);
  assert(game.bullets.length === 1, 'second shot blocked by cooldown');
});

// --- setPlayerName Tests ---

test('setPlayerName accepts valid nickname', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, 'TestUser');
  assert(game.players.get(id).name === 'TestUser', 'name set to TestUser');
});

test('setPlayerName trims whitespace', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, '  Spacey  ');
  assert(game.players.get(id).name === 'Spacey', 'whitespace trimmed');
});

test('setPlayerName truncates names longer than 16 characters', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, 'ThisNameIsWayTooLongForTheLimit');
  assert(game.players.get(id).name.length <= 16, 'name truncated to 16 chars');
  assert(game.players.get(id).name === 'ThisNameIsWayToo', 'truncated correctly');
});

test('setPlayerName falls back to default for empty string', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, '');
  assert(game.players.get(id).name === `Player ${id}`, 'falls back to default');
});

test('setPlayerName falls back to default for whitespace-only string', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, '   ');
  assert(game.players.get(id).name === `Player ${id}`, 'falls back to default for whitespace');
});

test('setPlayerName falls back to default for non-string input', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, 12345);
  assert(game.players.get(id).name === `Player ${id}`, 'falls back to default for number');
  game.setPlayerName(id, null);
  assert(game.players.get(id).name === `Player ${id}`, 'falls back to default for null');
  game.setPlayerName(id, undefined);
  assert(game.players.get(id).name === `Player ${id}`, 'falls back to default for undefined');
});

test('setPlayerName name appears in game state', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  game.setPlayerName(id, 'Hero');
  const state = game.getState(id);
  const playerState = state.players.find(p => p.id === id);
  assert(playerState.name === 'Hero', 'custom name in serialized state');
});

test('setPlayerName does nothing for invalid player ID', () => {
  const game = new Game();
  // Should not throw
  game.setPlayerName(9999, 'Ghost');
  assert(true, 'no error for invalid player ID');
});

// --- Property-based tests over many random seeds ---

test('Property: generated polygons are always convex (100 seeds)', () => {
  for (let seed = 0; seed < 100; seed++) {
    const n = 5 + (seed % 6);
    const poly = generateConvexPolygon(n, ARENA_RADIUS);
    assert(poly.length >= 3, `seed ${seed}: polygon has at least 3 vertices`);

    // Verify convexity: all cross products should have the same sign
    const len = poly.length;
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < len; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % len];
      const c = poly[(i + 2) % len];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0) positive++;
      else if (cross < 0) negative++;
    }
    assert(positive === 0 || negative === 0, `seed ${seed}: polygon is convex`);
  }
});

test('Property: centroid is always inside its polygon (100 seeds)', () => {
  for (let seed = 0; seed < 100; seed++) {
    const n = 5 + (seed % 6);
    const poly = generateConvexPolygon(n, ARENA_RADIUS);
    const centroid = getPolygonCentroid(poly);
    assert(
      pointInConvexPolygon(centroid.x, centroid.y, poly),
      `seed ${seed}: centroid is inside polygon`
    );
  }
});

test('Property: spawn point is always inside polygon (100 seeds)', () => {
  for (let seed = 0; seed < 100; seed++) {
    const game = new Game();
    const mockWs = { readyState: 1, send: () => {} };
    const id = game.addPlayer(mockWs);
    const player = game.players.get(id);
    assert(
      pointInConvexPolygon(player.x, player.y, game.arenaVertices),
      `seed ${seed}: spawned player is inside polygon`
    );
  }
});

test('Property: clamped point is always inside polygon (100 seeds)', () => {
  for (let seed = 0; seed < 100; seed++) {
    const poly = generateConvexPolygon(5 + (seed % 6), ARENA_RADIUS);
    // Test points in various directions outside the polygon
    const angle = (seed / 100) * Math.PI * 2;
    const farX = Math.cos(angle) * ARENA_RADIUS * 2;
    const farY = Math.sin(angle) * ARENA_RADIUS * 2;
    const clamped = clampPointToPolygon(farX, farY, poly);
    assert(
      pointInConvexPolygon(clamped.x, clamped.y, poly),
      `seed ${seed}: clamped point is inside polygon`
    );
  }
});

test('Property: players spawn inside polygon after startRound (50 seeds)', () => {
  for (let seed = 0; seed < 50; seed++) {
    const game = new Game();
    const mockWs1 = { readyState: 1, send: () => {} };
    const mockWs2 = { readyState: 1, send: () => {} };
    const id1 = game.addPlayer(mockWs1);
    const id2 = game.addPlayer(mockWs2);
    game.startRound();
    const p1 = game.players.get(id1);
    const p2 = game.players.get(id2);
    assert(
      pointInConvexPolygon(p1.x, p1.y, game.arenaVertices),
      `seed ${seed}: player 1 inside after startRound`
    );
    assert(
      pointInConvexPolygon(p2.x, p2.y, game.arenaVertices),
      `seed ${seed}: player 2 inside after startRound`
    );
  }
});

test('Property: movement clamp keeps player inside polygon (50 seeds)', () => {
  for (let seed = 0; seed < 50; seed++) {
    const game = new Game();
    const mockWs = { readyState: 1, send: () => {} };
    const id = game.addPlayer(mockWs);
    const player = game.players.get(id);
    // Place player far outside arena
    player.x = ARENA_RADIUS * 2;
    player.y = ARENA_RADIUS * 2;
    player.input.right = true;
    player.input.down = true;
    game.movePlayer(player, 1);
    assert(
      pointInConvexPolygon(player.x, player.y, game.arenaVertices),
      `seed ${seed}: clamped player is inside polygon after move`
    );
  }
});

// --- NPC Bot Tests ---

test('NPCs spawn when a single real player is in lobby (via tickLobby)', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs);
  assert(game.npcIds.size === 0, 'no NPCs immediately after addPlayer');

  // Tick the lobby — fillWithNPCs should trigger
  game.tickLobby(Date.now());
  assert(game.npcIds.size > 0, 'NPCs spawned after tickLobby');
  const totalPlayers = game.players.size;
  assert(totalPlayers > 1, 'total players > 1 after NPC spawn');
});

test('NPCs fill to target count based on real player count', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs);
  game.tickLobby(Date.now());

  const realCount = game.getRealPlayerCount();
  const expectedTarget = Math.min(realCount + MAX_NPC_COUNT, MIN_REAL_PLAYERS_FOR_NO_BOTS);
  const expectedNPCs = expectedTarget - realCount;
  assert(game.npcIds.size === expectedNPCs, `NPC count is ${expectedNPCs} (got ${game.npcIds.size})`);
});

test('NPCs are removed when enough real players join', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.tickLobby(Date.now());
  const npcCountBefore = game.npcIds.size;
  assert(npcCountBefore > 0, 'NPCs present before more players join');

  // Add more real players to reach threshold
  for (let i = 0; i < MIN_REAL_PLAYERS_FOR_NO_BOTS - 1; i++) {
    const ws = { readyState: 1, send: () => {} };
    game.addPlayer(ws);
  }

  assert(game.npcIds.size === 0, 'all NPCs removed when enough real players join');
});

test('NPCs trimmed when real player joins lobby', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.tickLobby(Date.now());
  const npcsBefore = game.npcIds.size;
  assert(npcsBefore > 0, 'NPCs exist before second player joins');

  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs2);

  // After adding a second real player, NPC count should decrease by 1
  assert(game.npcIds.size === npcsBefore - 1, `NPC count decreased by 1 (was ${npcsBefore}, now ${game.npcIds.size})`);
});

test('NPC addNPC creates a valid NPC player', () => {
  const game = new Game();
  const npcId = game.addNPC();

  assert(game.npcIds.has(npcId), 'NPC id tracked in npcIds set');
  const npc = game.players.get(npcId);
  assert(npc !== undefined, 'NPC exists in players map');
  assert(npc.isNPC === true, 'NPC has isNPC flag');
  assert(npc.ws === null, 'NPC has no WebSocket');
  assert(npc.alive === true, 'NPC is alive');
  assert(npc.hp === PLAYER_MAX_HP, 'NPC has full HP');
  assert(typeof npc.name === 'string' && npc.name.length > 0, 'NPC has a name');
  assert(
    pointInConvexPolygon(npc.x, npc.y, game.arenaVertices),
    'NPC spawned inside arena polygon'
  );
});

test('NPC appears in getState with isNPC flag', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const playerId = game.addPlayer(mockWs);
  const npcId = game.addNPC();

  const state = game.getState(playerId);
  const npcState = state.players.find(p => p.id === npcId);
  assert(npcState !== undefined, 'NPC in state players array');
  assert(npcState.isNPC === true, 'NPC state has isNPC: true');

  const playerState = state.players.find(p => p.id === playerId);
  assert(playerState.isNPC === false, 'real player has isNPC: false');
});

test('NPCs can be damaged and eliminated like real players', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();
  const npc = game.players.get(npcId);
  assert(npc.alive === true, 'NPC alive at round start');
  assert(npc.hp === PLAYER_MAX_HP, 'NPC full HP at round start');

  // Damage NPC with a bullet
  npc.hp -= BULLET_DAMAGE;
  assert(npc.hp < PLAYER_MAX_HP, 'NPC took damage');

  // Kill NPC
  npc.hp = 0;
  npc.alive = false;
  const alivePlayers = game.getAlivePlayers();
  assert(!alivePlayers.some(p => p.id === npcId), 'dead NPC not in alive players');
});

test('NPC bullet collision works correctly', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();
  const npc = game.players.get(npcId);

  // Place a bullet on top of NPC
  game.bullets.push({
    id: 'test-npc-hit',
    ownerId: id1,
    x: npc.x,
    y: npc.y,
    vx: 0,
    vy: 0,
    radius: 4,
    damage: BULLET_DAMAGE,
    createdAt: Date.now(),
  });

  const hpBefore = npc.hp;
  game.updateBullets(0.05, Date.now());
  assert(npc.hp < hpBefore, 'NPC took bullet damage');
  assert(game.bullets.length === 0, 'bullet consumed on NPC hit');
});

test('NPC ring damage works correctly', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();

  // Shrink ring very small
  game.ringVertices = scalePolygonTowardCentroid(
    game.arenaVertices,
    game.arenaCentroid,
    0.98
  );

  const npc = game.players.get(npcId);
  // Place NPC outside tiny ring but inside arena
  const v = game.arenaVertices[0];
  npc.x = game.arenaCentroid.x + (v.x - game.arenaCentroid.x) * 0.5;
  npc.y = game.arenaCentroid.y + (v.y - game.arenaCentroid.y) * 0.5;

  const hpBefore = npc.hp;
  game.applyRingDamage(1);
  assert(npc.hp < hpBefore, 'NPC took ring damage outside ring');
});

test('NPC AI updates inputs during active tick', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();
  const npc = game.players.get(npcId);
  // Reset NPC inputs
  npc.input = { up: false, down: false, left: false, right: false };

  // Run NPC AI tick
  game.tickNPCs(0.05, Date.now());

  // NPC should have some input set (it has enemies to navigate toward)
  const hasInput = npc.input.up || npc.input.down || npc.input.left || npc.input.right;
  assert(hasInput, 'NPC AI set movement inputs');
});

test('NPC AI moves NPC toward ring centroid when outside ring', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();

  // Shrink ring small
  game.ringVertices = scalePolygonTowardCentroid(
    game.arenaVertices,
    game.arenaCentroid,
    0.95
  );

  const npc = game.players.get(npcId);
  // Place NPC outside ring
  const v = game.arenaVertices[0];
  npc.x = v.x * 0.9;
  npc.y = v.y * 0.9;

  game.tickNPCs(0.05, Date.now());

  // NPC should be trying to move — check that some input was set
  const hasInput = npc.input.up || npc.input.down || npc.input.left || npc.input.right;
  assert(hasInput, 'NPC moves when outside ring');
});

test('NPCs removed on resetForNextRound', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  game.addNPC();
  game.addNPC();

  assert(game.npcIds.size === 2, '2 NPCs before round');
  game.startRound();

  game.state = STATE_ROUND_END;
  game.resetForNextRound();

  assert(game.npcIds.size === 0, 'all NPCs removed after round reset');
  // Only the 2 real players remain
  assert(game.players.size === 2, 'only real players remain after reset');
});

test('Win condition works with NPCs', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();

  // Kill player 2 and NPC
  const p2 = game.players.get(game.players.size > 2 ? 2 : id1);
  for (const p of game.players.values()) {
    if (p.id !== id1) {
      p.hp = 0;
      p.alive = false;
    }
  }

  game.checkWinCondition();
  assert(game.state === STATE_ROUND_END, 'round ends when only 1 alive');
  assert(game.winnerId === id1, 'real player wins');
});

test('Game with 1 real player and NPCs can start a round', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs);

  // Tick lobby to fill with NPCs
  game.tickLobby(Date.now());
  assert(game.npcIds.size > 0, 'NPCs present');
  assert(game.getAlivePlayers().length >= MIN_PLAYERS_TO_START, 'enough alive players to start');

  // Simulate countdown completion
  game.lobbyCountdownStart = Date.now() - 6000;
  game.tickLobby(Date.now());
  assert(game.state === STATE_ACTIVE, 'game started with NPCs');
});

test('NPCs do not spawn when no real players are in lobby', () => {
  const game = new Game();
  game.tickLobby(Date.now());
  assert(game.npcIds.size === 0, 'no NPCs when no real players');
  assert(game.players.size === 0, 'no players at all');
});

test('NPC names are unique', () => {
  const game = new Game();
  game.addNPC();
  game.addNPC();
  game.addNPC();
  const names = new Set();
  for (const id of game.npcIds) {
    names.add(game.players.get(id).name);
  }
  assert(names.size === 3, 'all NPC names are unique');
});

test('handleInput ignores NPC players (no ws)', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs);
  const npcId = game.addNPC();

  // handleInput should not crash for NPC IDs
  game.handleInput(npcId, { keys: { up: true }, angle: 0, shoot: false });
  // NPC should have its input updated (handleInput checks alive and not spectator)
  const npc = game.players.get(npcId);
  assert(npc.input.up === true, 'NPC input can be set via handleInput');
});

test('getRealPlayerCount returns only non-NPC non-spectator count', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);
  game.addNPC();
  game.addNPC();

  assert(game.getRealPlayerCount() === 2, 'real player count is 2');
  assert(game.npcIds.size === 2, 'NPC count is 2');
  assert(game.players.size === 4, 'total players is 4');
});

test('_pointInRing delegates to pointInConvexPolygon correctly', () => {
  const game = new Game();
  const centroid = game.arenaCentroid;
  assert(game._pointInRing(centroid.x, centroid.y), 'centroid is inside ring');
  assert(!game._pointInRing(ARENA_RADIUS * 5, ARENA_RADIUS * 5), 'far point is outside ring');
});

test('NPC full lifecycle: spawn, play, eliminate, reset', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const playerId = game.addPlayer(mockWs);

  // Lobby tick fills with NPCs
  game.tickLobby(Date.now());
  const npcCount = game.npcIds.size;
  assert(npcCount > 0, 'NPCs spawned in lobby');

  // Start round
  game.lobbyCountdownStart = Date.now() - 6000;
  game.tickLobby(Date.now());
  assert(game.state === STATE_ACTIVE, 'round started');

  // NPCs participate in active game
  const npcIds = [...game.npcIds];
  for (const id of npcIds) {
    const npc = game.players.get(id);
    assert(npc.alive, `NPC ${id} alive during active round`);
  }

  // Simulate tick — NPCs should move
  game.tickActive(0.05, Date.now());
  for (const id of npcIds) {
    const npc = game.players.get(id);
    if (npc) {
      assert(
        pointInConvexPolygon(npc.x, npc.y, game.arenaVertices),
        `NPC ${id} still inside arena after tick`
      );
    }
  }

  // Eliminate all NPCs, player wins
  for (const id of npcIds) {
    const npc = game.players.get(id);
    if (npc) {
      npc.hp = 0;
      npc.alive = false;
    }
  }
  game.checkWinCondition();
  assert(game.state === STATE_ROUND_END, 'round ended after NPCs eliminated');
  assert(game.winnerId === playerId, 'real player wins');

  // Reset
  game.resetForNextRound();
  assert(game.npcIds.size === 0, 'NPCs cleared after reset');
  assert(game.state === STATE_LOBBY, 'back to lobby');
});

// --- Leaderboard & Security Tests ---

const { Leaderboard, isReservedName, validateLeaderboardData } = require('../server/leaderboard');
const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpLeaderboardPath() {
  return path.join(os.tmpdir(), `lb-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test('isReservedName rejects __proto__, constructor, prototype', () => {
  assert(isReservedName('__proto__'), '__proto__ is reserved');
  assert(isReservedName('constructor'), 'constructor is reserved');
  assert(isReservedName('prototype'), 'prototype is reserved');
  assert(isReservedName('__PROTO__'), '__PROTO__ (uppercase) is reserved');
  assert(isReservedName('Constructor'), 'Constructor (mixed case) is reserved');
  assert(!isReservedName('Hero'), 'Hero is not reserved');
  assert(!isReservedName('player1'), 'player1 is not reserved');
});

test('validateLeaderboardData rejects invalid shapes', () => {
  let result = validateLeaderboardData(null);
  assert(Object.keys(result).length === 0, 'null returns empty');

  result = validateLeaderboardData([1, 2, 3]);
  assert(Object.keys(result).length === 0, 'array returns empty');

  result = validateLeaderboardData('string');
  assert(Object.keys(result).length === 0, 'string returns empty');

  result = validateLeaderboardData({ valid: { wins: 5 }, bad: 'string', ugly: { wins: -1 } });
  assert('valid' in result, 'keeps valid entry');
  assert(result.valid.wins === 5, 'valid entry has correct wins');
  assert(!('bad' in result), 'rejects string value');
  assert(!('ugly' in result), 'rejects negative wins');
});

test('validateLeaderboardData strips __proto__ key', () => {
  const raw = { 'Hero': { wins: 3 }, '__proto__': { wins: 999 } };
  const result = validateLeaderboardData(raw);
  assert('Hero' in result, 'Hero preserved');
  assert(!('__proto__' in result), '__proto__ key stripped');
});

test('validateLeaderboardData floors fractional wins', () => {
  const result = validateLeaderboardData({ 'Ace': { wins: 3.7 } });
  assert(result.Ace.wins === 3, 'wins floored to integer');
});

test('setPlayerName rejects reserved names like __proto__', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const result = game.setPlayerName(id, '__proto__');
  assert(!result.ok, '__proto__ rejected');
  assert(result.error === 'That nickname is not allowed', 'correct error message');
  assert(game.players.get(id).name === `Player ${id}`, 'name unchanged');
});

test('setPlayerName rejects constructor as nickname', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const result = game.setPlayerName(id, 'Constructor');
  assert(!result.ok, 'Constructor rejected');
});

test('Nickname uniqueness enforced among connected players', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  const r1 = game.setPlayerName(id1, 'Hero');
  assert(r1.ok, 'first player sets Hero');

  const r2 = game.setPlayerName(id2, 'Hero');
  assert(!r2.ok, 'second player cannot use Hero');
  assert(r2.error === 'Nickname already taken', 'correct error');
});

test('Nickname uniqueness is case-insensitive among connected players', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  game.setPlayerName(id1, 'hero');
  const r2 = game.setPlayerName(id2, 'HERO');
  assert(!r2.ok, 'case-insensitive duplicate rejected');
});

test('Player can re-set their own nickname', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);

  const r1 = game.setPlayerName(id, 'Hero');
  assert(r1.ok, 'first set succeeds');
  const r2 = game.setPlayerName(id, 'Hero');
  assert(r2.ok, 'same player can re-set same name');
});

test('Nickname freed after player disconnects (no leaderboard entry)', () => {
  const game = new Game();
  // Stub checkLobbyStart which is monkey-patched at runtime in server/index.js
  game.checkLobbyStart = () => {};
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.setPlayerName(id1, 'Hero');
  game.removePlayer(id1);

  const id2 = game.addPlayer(mockWs2);
  const r2 = game.setPlayerName(id2, 'Hero');
  // Since no win was recorded, 'Hero' isn't in leaderboard, so it should succeed.
  assert(r2.ok, 'name freed after disconnect (no leaderboard entry)');
});

test('Nickname NOT freed after disconnect if in leaderboard (global uniqueness)', () => {
  const game = new Game();
  game.checkLobbyStart = () => {};
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.setPlayerName(id1, 'Hero');
  // Simulate Hero having won before — now in leaderboard
  game.leaderboard.data['Hero'] = { wins: 3 };
  game.removePlayer(id1);

  const id2 = game.addPlayer(mockWs2);
  const r2 = game.setPlayerName(id2, 'Hero');
  assert(!r2.ok, 'leaderboard name blocked after disconnect');
  assert(r2.error === 'Nickname already taken', 'correct error for persisted identity');
});

test('Global nickname uniqueness: name in leaderboard cannot be taken by different player', () => {
  const game = new Game();
  // Manually seed leaderboard with a persisted identity
  game.leaderboard.data['Champion'] = { wins: 10 };

  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const result = game.setPlayerName(id, 'Champion');
  assert(!result.ok, 'cannot take persisted leaderboard name');
  assert(result.error === 'Nickname already taken', 'correct error for global uniqueness');
});

test('Global nickname uniqueness is case-insensitive', () => {
  const game = new Game();
  game.leaderboard.data['Champion'] = { wins: 10 };

  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const result = game.setPlayerName(id, 'champion');
  assert(!result.ok, 'case-insensitive match against leaderboard');
});

test('Player who owns a leaderboard name can reclaim it', () => {
  const game = new Game();
  game.leaderboard.data['Hero'] = { wins: 5 };

  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  // First register the name (simulating the player claiming their identity)
  game.registeredNicknames.set('hero', id);
  const result = game.setPlayerName(id, 'Hero');
  assert(result.ok, 'player can reclaim their own leaderboard name');
});

test('Win is recorded in leaderboard when round ends', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);
  game.setPlayerName(id1, 'Winner');

  game.startRound();
  const p2 = game.players.get(id2);
  p2.hp = 0;
  p2.alive = false;
  game.checkWinCondition();

  assert(game.state === STATE_ROUND_END, 'round ended');
  assert(game.winnerId === id1, 'player 1 wins');
  assert('Winner' in game.leaderboard.data, 'Winner in leaderboard');
  assert(game.leaderboard.data['Winner'].wins === 1, 'wins count is 1');
});

test('Leaderboard getRanked returns sorted results', () => {
  const game = new Game();
  // Reset leaderboard data to isolate this test
  game.leaderboard.data = Object.create(null);
  game.leaderboard.data['Ace'] = { wins: 10 };
  game.leaderboard.data['Bob'] = { wins: 5 };
  game.leaderboard.data['Cat'] = { wins: 15 };

  const ranked = game.getLeaderboard();
  assert(ranked.length === 3, '3 entries');
  assert(ranked[0].nickname === 'Cat', 'Cat is rank 1');
  assert(ranked[0].rank === 1, 'rank 1');
  assert(ranked[0].wins === 15, '15 wins');
  assert(ranked[1].nickname === 'Ace', 'Ace is rank 2');
  assert(ranked[2].nickname === 'Bob', 'Bob is rank 3');
});

test('Leaderboard recordWin ignores reserved names', () => {
  const game = new Game();
  game.leaderboard.recordWin('__proto__');
  assert(!('__proto__' in game.leaderboard.data), '__proto__ not recorded');
  game.leaderboard.recordWin('constructor');
  assert(!('constructor' in game.leaderboard.data), 'constructor not recorded');
});

test('NPC wins are not recorded in leaderboard', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);
  const npcId = game.addNPC();

  game.startRound();
  // Kill real players, NPC survives
  for (const p of game.players.values()) {
    if (p.id !== npcId) {
      p.hp = 0;
      p.alive = false;
    }
  }
  game.checkWinCondition();
  assert(game.winnerId === npcId, 'NPC wins');
  const ranked = game.getLeaderboard();
  const npc = game.players.get(npcId);
  const npcInLb = ranked.find(e => e.nickname === npc.name);
  assert(!npcInLb, 'NPC not in leaderboard');
});

test('Leaderboard persistence: file round-trip with validated data', () => {
  const tmpPath = tmpLeaderboardPath();
  // Write valid data
  fs.writeFileSync(tmpPath, JSON.stringify({ 'Ace': { wins: 3 }, 'Bob': { wins: 7 } }));
  const lb = new Leaderboard(tmpPath);
  assert(lb.data['Ace'].wins === 3, 'Ace loaded with 3 wins');
  assert(lb.data['Bob'].wins === 7, 'Bob loaded with 7 wins');
  // Clean up
  try { fs.unlinkSync(tmpPath); } catch (e) {}
});

test('Leaderboard persistence: corrupted file starts fresh', () => {
  const tmpPath = tmpLeaderboardPath();
  fs.writeFileSync(tmpPath, 'not json!!!');
  const lb = new Leaderboard(tmpPath);
  assert(Object.keys(lb.data).length === 0, 'corrupted file yields empty data');
  try { fs.unlinkSync(tmpPath); } catch (e) {}
});

test('Leaderboard hasNickname is case-insensitive', () => {
  const lb = new Leaderboard(tmpLeaderboardPath());
  lb.data['Champion'] = { wins: 5 };
  assert(lb.hasNickname('Champion'), 'exact match');
  assert(lb.hasNickname('champion'), 'lowercase match');
  assert(lb.hasNickname('CHAMPION'), 'uppercase match');
  assert(!lb.hasNickname('Champ'), 'partial no match');
});

// --- Machine Gun Pickup Tests ---

test('Machine gun pickup spawns when round starts', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  assert(game.machineGunPickup === null, 'no pickup before round starts');
  game.startRound();
  assert(game.machineGunPickup !== null, 'pickup spawned after startRound');
  assert(typeof game.machineGunPickup.x === 'number', 'pickup has x coordinate');
  assert(typeof game.machineGunPickup.y === 'number', 'pickup has y coordinate');
  assert(game.machineGunPickup.collected === false, 'pickup not collected initially');
  assert(game.machineGunPickup.collectedBy === null, 'pickup collectedBy is null initially');
  assert(
    pointInConvexPolygon(game.machineGunPickup.x, game.machineGunPickup.y, game.arenaVertices),
    'pickup spawns inside arena polygon'
  );
});

test('Pickup collection sets hasMachineGun and marks pickup collected', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id1);

  // Move player directly on top of pickup
  player.x = game.machineGunPickup.x;
  player.y = game.machineGunPickup.y;

  assert(player.hasMachineGun === false, 'player does not have machine gun before collection');
  game.checkPickupCollection();
  assert(player.hasMachineGun === true, 'player has machine gun after collection');
  assert(game.machineGunPickup.collected === true, 'pickup marked as collected');
  assert(game.machineGunPickup.collectedBy === id1, 'pickup collectedBy is correct player');
});

test('Collecting pickup changes effective fire rate from 300ms to 150ms', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id1);
  player.angle = 0;

  // Shoot once to set lastShot
  game.tryShoot(player);
  assert(game.bullets.length === 1, 'first shot fires');
  const firstShotTime = player.lastShot;

  // Try to shoot again immediately — should be blocked by normal cooldown
  player.lastShot = firstShotTime; // ensure lastShot is set
  game.tryShoot(player);
  assert(game.bullets.length === 1, 'second shot blocked by normal cooldown');

  // Advance time past machine gun cooldown (150ms) but before normal cooldown (300ms)
  player.lastShot = Date.now() - (MACHINE_GUN_COOLDOWN_MS + 1);
  game.tryShoot(player);
  assert(game.bullets.length === 1, 'shot still blocked without machine gun (within normal cooldown)');

  // Now give machine gun
  player.hasMachineGun = true;
  player.lastShot = Date.now() - (MACHINE_GUN_COOLDOWN_MS + 1);
  game.tryShoot(player);
  assert(game.bullets.length === 2, 'shot succeeds with machine gun at reduced cooldown');

  // Verify the cooldown values are correct
  assert(SHOOT_COOLDOWN_MS === 300, 'normal shoot cooldown is 300ms');
  assert(MACHINE_GUN_COOLDOWN_MS === 150, 'machine gun cooldown is 150ms (50% reduction)');
});

test('Only one pickup spawns per match', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const pickupPos = { x: game.machineGunPickup.x, y: game.machineGunPickup.y };

  // Simulate multiple ticks — pickup position should not change
  game.tickActive(0.05, Date.now());
  game.tickActive(0.05, Date.now());
  assert(
    game.machineGunPickup.x === pickupPos.x && game.machineGunPickup.y === pickupPos.y,
    'pickup position unchanged after ticks'
  );
});

test('Pickup disappears after collection (not re-rendered)', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id1);
  player.x = game.machineGunPickup.x;
  player.y = game.machineGunPickup.y;

  game.checkPickupCollection();
  const state = game.getState(id1);
  assert(state.machineGunPickup !== null, 'pickup data still in state');
  assert(state.machineGunPickup.collected === true, 'pickup marked collected in broadcast state');
});

test('NPC can collect pickup and gain machine gun', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);

  // Add NPC
  const npcId = game.addNPC();
  const npc = game.players.get(npcId);

  game.startRound();

  // Move NPC on top of pickup
  npc.x = game.machineGunPickup.x;
  npc.y = game.machineGunPickup.y;

  assert(npc.hasMachineGun === false, 'NPC does not have machine gun before collection');
  game.checkPickupCollection();
  assert(npc.hasMachineGun === true, 'NPC has machine gun after collection');
  assert(game.machineGunPickup.collected === true, 'pickup collected by NPC');
  assert(game.machineGunPickup.collectedBy === npcId, 'collectedBy is NPC id');
});

test('Fire rate bonus resets at start of next round', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id1);

  // Give player machine gun
  player.hasMachineGun = true;
  assert(player.hasMachineGun === true, 'player has machine gun during round');

  // Reset for next round
  game.resetForNextRound();
  const playerAfterReset = game.players.get(id1);
  assert(playerAfterReset.hasMachineGun === false, 'machine gun bonus reset after round');
  assert(game.machineGunPickup === null, 'pickup cleared after round reset');
});

test('Game state broadcast includes pickup data', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  // Before round: no pickup in state
  const lobbyState = game.getState(id1);
  assert(lobbyState.machineGunPickup === null, 'no pickup in lobby state');

  game.startRound();
  const activeState = game.getState(id1);
  assert(activeState.machineGunPickup !== null, 'pickup in active state');
  assert(typeof activeState.machineGunPickup.x === 'number', 'pickup state has x');
  assert(typeof activeState.machineGunPickup.y === 'number', 'pickup state has y');
  assert(activeState.machineGunPickup.collected === false, 'pickup state shows not collected');
});

test('Collected pickup cannot be collected again', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  const id2 = game.addPlayer(mockWs2);

  game.startRound();
  const p1 = game.players.get(id1);
  const p2 = game.players.get(id2);

  // Player 1 collects
  p1.x = game.machineGunPickup.x;
  p1.y = game.machineGunPickup.y;
  game.checkPickupCollection();
  assert(p1.hasMachineGun === true, 'player 1 collected pickup');

  // Player 2 walks over same spot
  p2.x = game.machineGunPickup.x;
  p2.y = game.machineGunPickup.y;
  game.checkPickupCollection();
  assert(p2.hasMachineGun === false, 'player 2 cannot collect already-collected pickup');
  assert(game.machineGunPickup.collectedBy === id1, 'collectedBy still player 1');
});

test('Player starts new round without hasMachineGun after startRound', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const player = game.players.get(id1);
  assert(player.hasMachineGun === false, 'hasMachineGun is false at round start');
});

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
