'use strict';

// --- NPC Constants ---
const NPC_NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo',
  'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet',
  'Kilo', 'Lima', 'Mike', 'November', 'Oscar',
];

const MAX_NPC_COUNT = 4; // max bots per match
const MIN_REAL_PLAYERS_FOR_NO_BOTS = 4; // no bots when this many real players

// AI behavior constants
const NPC_SHOOT_RANGE = 250; // distance within which NPC will try to shoot
const NPC_SHOOT_ANGLE_TOLERANCE = 0.3; // radians (~17 degrees)
const NPC_RING_DANGER_MARGIN = 50; // start moving inward when this close to ring edge
const NPC_WANDER_CHANGE_INTERVAL = 2000; // ms between wander direction changes

/**
 * Create an NPC player object (no WebSocket).
 */
function createNPC(id, name) {
  return {
    id,
    ws: null,
    x: 0,
    y: 0,
    angle: 0,
    hp: 100,
    alive: true,
    lastShot: 0,
    input: { up: false, down: false, left: false, right: false },
    name: name,
    isNPC: true,
    hasMachineGun: false,
    _wanderAngle: Math.random() * Math.PI * 2,
    _wanderChangeTime: 0,
  };
}

/**
 * Pick a name for an NPC that isn't already taken.
 */
function pickNPCName(existingNames) {
  for (const name of NPC_NAMES) {
    if (!existingNames.has(name)) return name;
  }
  // Fallback: numbered bot name
  return `Bot-${Math.floor(Math.random() * 1000)}`;
}

/**
 * Update NPC AI for one tick. Sets the NPC's input and angle based on game state.
 *
 * @param {Object} npc - The NPC player object
 * @param {Object} game - The Game instance (for accessing players, ring, centroid)
 * @param {number} dt - Delta time in seconds
 * @param {number} now - Current timestamp
 */
function updateNPCAI(npc, game, dt, now) {
  if (!npc.alive) return;

  // Reset input each tick
  npc.input.up = false;
  npc.input.down = false;
  npc.input.left = false;
  npc.input.right = false;

  let targetX = null;
  let targetY = null;
  let shouldShoot = false;

  // 1. Ring avoidance — check if NPC is outside ring or close to ring boundary
  const insideRing = game._pointInRing(npc.x, npc.y);
  if (!insideRing) {
    // Outside ring: move toward centroid urgently
    targetX = game.arenaCentroid.x;
    targetY = game.arenaCentroid.y;
  } else {
    // 2. Find nearest alive enemy
    let nearestDist = Infinity;
    let nearestEnemy = null;

    for (const player of game.players.values()) {
      if (player.id === npc.id) continue;
      if (!player.alive) continue;
      if (game.spectators.has(player.id)) continue;

      const dx = player.x - npc.x;
      const dy = player.y - npc.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = player;
      }
    }

    if (nearestEnemy) {
      const dx = nearestEnemy.x - npc.x;
      const dy = nearestEnemy.y - npc.y;

      // Aim at the enemy
      npc.angle = Math.atan2(dy, dx);

      // Move toward the enemy if far, strafe a bit if close
      if (nearestDist > NPC_SHOOT_RANGE * 0.6) {
        targetX = nearestEnemy.x;
        targetY = nearestEnemy.y;
      } else {
        // Within engagement range: strafe perpendicular
        const perpAngle = npc.angle + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
        targetX = npc.x + Math.cos(perpAngle) * 50;
        targetY = npc.y + Math.sin(perpAngle) * 50;
      }

      // Shoot if within range and roughly facing the enemy
      if (nearestDist < NPC_SHOOT_RANGE) {
        const angleToEnemy = Math.atan2(dy, dx);
        let angleDiff = Math.abs(npc.angle - angleToEnemy);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        if (angleDiff < NPC_SHOOT_ANGLE_TOLERANCE) {
          shouldShoot = true;
        }
      }
    } else {
      // 3. No enemy found — wander toward centroid with some randomness
      if (now - npc._wanderChangeTime > NPC_WANDER_CHANGE_INTERVAL) {
        npc._wanderAngle = Math.atan2(
          game.arenaCentroid.y - npc.y,
          game.arenaCentroid.x - npc.x
        ) + (Math.random() - 0.5) * 1.5;
        npc._wanderChangeTime = now;
      }
      targetX = npc.x + Math.cos(npc._wanderAngle) * 100;
      targetY = npc.y + Math.sin(npc._wanderAngle) * 100;
      npc.angle = npc._wanderAngle;
    }
  }

  // Convert target direction to WASD input
  if (targetX !== null && targetY !== null) {
    const dx = targetX - npc.x;
    const dy = targetY - npc.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      // Normalize direction
      const ndx = dx / dist;
      const ndy = dy / dist;

      // Map to cardinal directions using thresholds
      if (ndx < -0.3) npc.input.left = true;
      if (ndx > 0.3) npc.input.right = true;
      if (ndy < -0.3) npc.input.up = true;
      if (ndy > 0.3) npc.input.down = true;
    }
  }

  // Attempt to shoot
  if (shouldShoot) {
    game.tryShoot(npc);
  }
}

module.exports = {
  NPC_NAMES,
  MAX_NPC_COUNT,
  MIN_REAL_PLAYERS_FOR_NO_BOTS,
  NPC_SHOOT_RANGE,
  NPC_SHOOT_ANGLE_TOLERANCE,
  createNPC,
  pickNPCName,
  updateNPCAI,
};
