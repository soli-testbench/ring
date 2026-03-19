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

// --- Tests ---

test('Game initializes in lobby state', () => {
  const game = new Game();
  assert(game.state === STATE_LOBBY, 'state is lobby');
  assert(game.ringRadius === ARENA_RADIUS, 'ring is full size');
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

test('Players spawn around arena edge in lobby', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const player = game.players.get(id);
  const dist = Math.sqrt(player.x * player.x + player.y * player.y);
  assert(dist > 0, 'player spawned away from center');
  assert(dist <= ARENA_RADIUS, 'player within arena');
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

test('Movement is clamped to arena bounds', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const player = game.players.get(id);

  // Move player far outside
  player.x = ARENA_RADIUS + 100;
  player.y = 0;
  player.input.right = true;

  game.movePlayer(player, 1);
  const dist = Math.sqrt(player.x * player.x + player.y * player.y);
  assert(dist <= ARENA_RADIUS + 1, 'player clamped to arena');
});

test('Ring shrinks during active game', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  const initialRadius = game.ringRadius;

  // Simulate some time passing
  game.ringStartTime = Date.now() - RING_SHRINK_DURATION_MS / 2;
  game.tickActive(0.05, Date.now());

  assert(game.ringRadius < initialRadius, 'ring has shrunk');
  assert(game.ringRadius > 0, 'ring still has some size');
});

test('Ring damage applies to players outside ring', () => {
  const game = new Game();
  const mockWs1 = { readyState: 1, send: () => {} };
  const mockWs2 = { readyState: 1, send: () => {} };
  const id1 = game.addPlayer(mockWs1);
  game.addPlayer(mockWs2);

  game.startRound();
  game.ringRadius = 10; // Shrink ring very small
  const player = game.players.get(id1);
  player.x = 400; // Far from center
  player.y = 0;

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

test('Game state serialization works', () => {
  const game = new Game();
  const mockWs = { readyState: 1, send: () => {} };
  const id = game.addPlayer(mockWs);
  const state = game.getState(id);

  assert(state.type === 'state', 'has type');
  assert(state.gameState === STATE_LOBBY, 'has gameState');
  assert(state.ringRadius === ARENA_RADIUS, 'has ringRadius');
  assert(Array.isArray(state.players), 'has players array');
  assert(Array.isArray(state.bullets), 'has bullets array');
  assert(state.yourId === id, 'has yourId');
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

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
