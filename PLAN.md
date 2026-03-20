# Plan: Fix Countdown Map vs Playable Map Bug

## Problem

When 2+ players join the lobby, a 5-second countdown starts. During this countdown, players see **map A** (the polygon generated in `resetForNextRound()` or the constructor) and their characters are positioned on map A. However, when `startRound()` fires at the end of the countdown, it **regenerates the polygon** (lines 382-386 of `server/game.js`), creating **map B**. Players are then repositioned onto map B. This causes a jarring visual jump — the arena shape changes and players teleport.

## Root Cause

In `server/game.js`, the `startRound()` method (line 380) calls `generateConvexPolygon()` to create new `arenaVertices`, `arenaCentroid`, and `ringVertices`. This overwrites the polygon that was already being shown to players during the lobby/countdown phase. The polygon is already generated at two appropriate lifecycle points:
1. In the `Game` constructor (for the very first round)
2. In `resetForNextRound()` (for subsequent rounds)

The `startRound()` method should NOT regenerate the polygon — it should reuse what's already there.

## Fix

### `server/game.js` — `startRound()` method (lines 380-408)

**Remove** lines 382-386 (the polygon regeneration):
```js
// DELETE THESE LINES:
this.arenaVertices = generateConvexPolygon(
  5 + Math.floor(Math.random() * 6),
  ARENA_RADIUS
);
this.arenaCentroid = getPolygonCentroid(this.arenaVertices);
```

**Keep** the ring vertex reset — the ring must be reset to the full arena size at round start (it may have shrunk in a previous round), but referencing the existing `arenaVertices`:
```js
this.ringVertices = this.arenaVertices.map((v) => ({ x: v.x, y: v.y }));
```

Player respawning (lines 393-408) continues to work as-is since it uses `this.arenaVertices` and `this.arenaCentroid`, which now refer to the same polygon shown during countdown.

### `test/game.test.js` — Update "Each new round generates a different polygon shape" test

This test currently calls `startRound()` twice expecting different polygons. Since `startRound()` will no longer regenerate the polygon, update the test to verify that `resetForNextRound()` (which runs between rounds) generates a new polygon.

### Add new test: "Countdown map matches round map"

Add a test that verifies `arenaVertices` before and after `startRound()` are identical — confirming the bug is fixed.

## Scope

**Mode: single** — This is a well-contained bug fix in `server/game.js` with a corresponding test update in `test/game.test.js`. No client changes needed since the client renders whatever `arenaVertices` the server sends.

## Verification

- `npm test` passes with all existing + new tests
- The "Each new round generates a different polygon shape" test is updated to test the correct lifecycle point
- A new test confirms `startRound()` preserves the lobby polygon
- Visual: During countdown, the map shape and player positions remain identical when the round begins
