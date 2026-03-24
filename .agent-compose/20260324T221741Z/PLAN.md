# Plan: Nerf Bot AI Difficulty

## Summary

Add NPC bot AI to Ring - Battle Royale with intentionally nerfed combat parameters so bots feel like easy-but-functional opponents. The codebase currently has **zero NPC/bot logic** — this is a greenfield addition to the server-side `game.js` module with NPC lifecycle managed in `server/index.js`.

## Current State

- **Tech stack**: Node.js, vanilla JS client, HTML5 Canvas, `ws` WebSocket lib
- **Server**: `server/game.js` (Game class with tick loop, movement, shooting, ring) + `server/index.js` (HTTP + WS server)
- **Client**: `client/client.js` (rendering, input) — no changes needed for server-side bots
- **Tests**: `test/game.test.js` (889 passing, custom assert harness)
- **No existing NPC/bot code**: The task description's references to `NPC_SHOOT_RANGE = 250` and `NPC_SHOOT_ANGLE_TOLERANCE = 0.3` describe the *previous* desired values, not existing code. We implement the nerfed values directly.

## Architecture

### Bot Design

Bots are server-side fake players — they have entries in `game.players` but no WebSocket connection (`ws: null`). The Game class tick loop already handles movement, shooting, bullet collisions, and ring damage for all players. Bots just need:

1. **AI decision-making** each tick — set `player.input` directions and call `tryShoot()` when appropriate
2. **NPC constants** — tunable parameters for range, accuracy, reaction delay
3. **Lifecycle management** — spawn bots when needed, remove when real players join

### NPC Constants (Nerfed Values)

| Constant | Value | Rationale |
|---|---|---|
| `NPC_SHOOT_RANGE` | 180 | Reduced from task's "original" 250; bots only engage at close range |
| `NPC_SHOOT_ANGLE_TOLERANCE` | 0.55 rad (~31°) | Wider than 0.3 rad; bots miss more often |
| `NPC_REACTION_DELAY_MS` | 400 | 400ms delay before first shot on a new target |
| `NPC_STRAFE_RANGE` | 80 | Distance at which bots start strafing instead of approaching |
| `NPC_RING_SAFETY_MARGIN` | 50 | How far inside the ring bots try to stay |
| `NPC_WANDER_INTERVAL_MS` | 2000 | How often bots pick a new wander direction |
| `NPC_COUNT` | 3 | Default number of bots to fill the lobby |

### Bot AI Behavior (per tick)

1. **Ring avoidance** (highest priority): If bot is outside ring or within `NPC_RING_SAFETY_MARGIN` of ring edge, move toward centroid.
2. **Target acquisition**: Find nearest alive non-bot enemy within `NPC_SHOOT_RANGE`.
3. **Reaction delay**: Track `lastTargetId` and `targetAcquiredAt` per bot. Only allow shooting after `NPC_REACTION_DELAY_MS` has elapsed since acquiring a *new* target.
4. **Combat movement**: If target found and within `NPC_STRAFE_RANGE`, strafe (perpendicular movement). Otherwise, move toward target.
5. **Shooting**: If target is within range AND angle to target is within `NPC_SHOOT_ANGLE_TOLERANCE` AND reaction delay has passed, call `tryShoot()`.
6. **Wandering**: If no target, pick a random direction every `NPC_WANDER_INTERVAL_MS` and walk.

### Files Changed

| File | Changes |
|---|---|
| `server/game.js` | Add NPC constants, `npcState` map, `tickNPCs()` method, `addBot()`/`removeBot()` methods, call `tickNPCs()` from `tickActive()`, mark bots with `isBot: true` flag, export new constants |
| `server/index.js` | Spawn bots on server start and manage bot count (add/remove as human players join/leave) |
| `test/game.test.js` | Add tests for bot AI: spawning, shooting range, angle tolerance, reaction delay, ring avoidance, wandering |

### Key Design Decisions

1. **Bots as players with `ws: null`**: Simplest approach — reuse all existing player infrastructure (HP, collision, ring damage). The `handleInput()` function checks `player.ws` but bots bypass it by directly setting `player.input` in `tickNPCs()`.
2. **Bot AI in Game class**: Keeps all game logic server-authoritative and testable without WebSocket mocking.
3. **No new dependencies**: Pure logic, no libraries needed.
4. **Client needs no changes**: Bots appear as regular players in the state broadcast. The `isBot` flag can optionally be sent for UI differentiation but is not required.

## Single-Task Justification

This is a contained server-side feature touching 3 files with tightly coupled logic (game.js bot AI + index.js lifecycle + tests). Splitting would create unnecessary coordination overhead.
