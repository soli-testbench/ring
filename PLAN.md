# Implementation Plan: NPC Bots for Solo/Low-Player Matches

## Overview

Add AI-controlled NPC (bot) players that fill matches when there are insufficient human players. NPCs participate in the full battle royale loop — moving, shooting, avoiding the ring — and are clearly labeled as bots in the client UI.

## Architecture

This is a **single-agent** task. All changes are tightly coupled: the NPC AI module depends on Game internals, the Game class must integrate NPC lifecycle, and the client must render the `isNPC` flag. Splitting these into parallel agents would create merge conflicts and require excessive interface contracts for a codebase of this size (~650 lines of server code, ~430 lines of client code).

## Tech Stack & Conventions

- **Language**: Vanilla JavaScript with `'use strict'`, Node.js (no TypeScript, matching existing codebase)
- **Server**: `ws@^8.16.0` WebSocket, custom Game class in `server/game.js`
- **Client**: Vanilla JS + HTML5 Canvas in `client/client.js` and `client/index.html`
- **Tests**: Custom test harness in `test/game.test.js` (877 tests currently passing)
- **Style**: No build system, no framework — plain CJS modules, `module.exports`

## Key Design Decisions

### 1. NPC Module (`server/npc.js`)

A new file `server/npc.js` containing:

- **`NPC_NAMES`**: Array of bot names (e.g., "Alpha", "Bravo", "Charlie", etc.) for variety
- **`MAX_NPC_COUNT`**: Max bots to fill (default: 4, so a match has up to 5 total with 1 human)
- **`MIN_REAL_PLAYERS_FOR_NO_BOTS`**: Threshold above which no bots are added (default: 4)
- **`createNPC(id, name)`**: Factory function returning a player-shaped object with `isNPC: true`, no `ws` reference
- **`updateNPCAI(npc, game, dt)`**: Per-tick AI logic:
  - **Ring avoidance**: If NPC is outside ring or near ring boundary, move toward centroid
  - **Target acquisition**: Find nearest alive non-self player, navigate toward them
  - **Shooting**: When within distance threshold and facing target (angle within tolerance), trigger shoot
  - **Wandering**: When no target is nearby, move in a semi-random direction biased toward centroid

### 2. Game Class Modifications (`server/game.js`)

**New fields on Game:**
- `npcIds`: `Set` tracking which player IDs are NPCs

**New methods:**
- `addNPC()`: Creates an NPC player object (no WebSocket), adds to `this.players`, marks in `npcIds`, spawns it
- `removeNPC(id)`: Removes an NPC from `this.players` and `npcIds`
- `removeAllNPCs()`: Clears all NPCs (used on round reset)
- `fillWithNPCs()`: Called during lobby — calculates how many bots needed, adds them
- `tickNPCs(dt)`: Called each active tick — runs AI update for each NPC

**Modified methods:**
- `removePlayer(id)`: After removing a real player, re-evaluate NPC count in lobby
- `tickLobby()`: Call `fillWithNPCs()` to ensure enough players for match start
- `tickActive(dt, now)`: Add `this.tickNPCs(dt)` call to set NPC inputs before movement
- `resetForNextRound()`: Remove all NPCs before resetting (they'll be re-added in lobby if needed)
- `getState(forPlayerId)`: Add `isNPC: npcIds.has(p.id)` to each player in serialized state
- `checkWinCondition()`: Keep existing logic — NPCs count as alive players. Round ends when ≤1 alive total. If all real players die, last NPC "wins" (or draw). This keeps logic simple.

### 3. NPC Spawn/Despawn Logic

- **Lobby phase**: When real player count < `MIN_REAL_PLAYERS_FOR_NO_BOTS`, fill with NPCs up to target total
- **When real player joins lobby**: If total exceeds desired count, remove excess NPCs
- **During active game**: No adding/removing NPCs — they stay until eliminated or round ends
- **Round reset**: Remove all NPCs, then re-evaluate in next lobby tick

### 4. Client-Side Rendering (`client/client.js`)

- In `drawStickFigure()`: Check `player.isNPC` flag
  - Prefix name with `[BOT] ` in the name label
  - Use a distinct color for bot name labels (`#f80` orange instead of `#aaa` gray)
- In `updateHUD()`: Show bot count alongside player count in lobby info

### 5. Test Coverage (`test/game.test.js`)

New tests to add:
- NPC spawning when 1 real player is in lobby — NPCs fill to target count
- NPC removal when enough real players join
- NPC AI tick — NPCs update their input state each tick
- NPC elimination — NPCs take damage and die like normal players
- NPC in game state — `getState()` includes `isNPC: true` for NPCs
- NPC cleanup on round reset — all NPCs removed during `resetForNextRound()`
- Win condition with NPCs — round ends correctly when mixing real and NPC players

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `server/npc.js` | **Create** | NPC factory, AI logic, constants |
| `server/game.js` | **Modify** | Integrate NPC lifecycle, spawn/despawn, tick AI, isNPC in state |
| `client/client.js` | **Modify** | Render [BOT] label, distinct color for NPCs |
| `test/game.test.js` | **Modify** | Add NPC-specific test cases |

## Risks & Mitigations

- **NPC AI performance**: AI is simple (nearest-enemy + ring avoidance), O(n²) per tick where n ≤ ~8 players. No concern at this scale.
- **Existing test breakage**: NPC changes add a `npcIds` set and modify `getState()`. Existing tests should pass since `isNPC` is an additive field and `checkWinCondition` counts all alive players (unchanged).
- **NPC shooting timing**: NPCs use the same `tryShoot()` method with cooldown, so they can't fire faster than real players.
