# Implementation Plan: Dynamic Maps with Randomly Generated Arena Shapes

## Overview

Replace the static circular arena in Ring - Battle Royale with randomly generated convex polygon arenas that change each round. The shrinking ring contracts the polygon toward its centroid. All boundary checks switch from distance-from-center to point-in-polygon math.

## Technical Approach

### 1. Polygon Geometry Utilities (server/game.js)

Add pure functions for convex polygon operations. No external dependencies needed — the math is straightforward.

**`generateConvexPolygon(numVertices, radius)`**
- Generate N random angles, sort them, place vertices on the circle at `radius` with slight radial jitter (0.75–1.0 × radius) for variety.
- Returns `[{x, y}, ...]` in CCW order.
- Vertex count: random integer in [5, 10].

**`getPolygonCentroid(vertices)`**
- Standard centroid formula: average of all vertex coordinates (sufficient for convex polygons with roughly uniform vertex distribution).

**`scalePolygonTowardCentroid(vertices, centroid, t)`**
- Returns new vertices where each vertex is lerped toward centroid by factor `t` (0 = original, 1 = collapsed to centroid).
- `newVertex = centroid + (vertex - centroid) * (1 - t)`

**`pointInConvexPolygon(px, py, vertices)`**
- Cross-product winding test: for each edge, check that point is on the same side (left/CCW) of every edge. O(N) where N ≤ 10, so trivially fast.

**`clampPointToPolygon(px, py, vertices)`**
- If point is inside, return as-is.
- Otherwise, find the closest point on the polygon boundary: project onto each edge segment, return the nearest projection. O(N).

**`randomPointInConvexPolygon(vertices, centroid, radiusFraction)`**
- For spawns: pick a point at ~80% distance from centroid toward a polygon vertex/edge. Use angular distribution around centroid scaled to the polygon boundary.

### 2. Server Game Logic Changes (server/game.js)

**New state fields on Game:**
- `this.arenaVertices` — the full-size polygon for the current round (array of {x,y})
- `this.arenaCentroid` — centroid of arenaVertices
- `this.ringVertices` — the current shrunk polygon (recomputed each tick)

**`constructor()` changes:**
- Initialize `arenaVertices` with a default polygon (for lobby display).
- Compute and store `arenaCentroid`.
- Set `ringVertices = [...arenaVertices]`.

**`startRound()` changes:**
- Call `generateConvexPolygon(randomInt(5,10), ARENA_RADIUS)` to create new arena shape.
- Compute centroid.
- Store `arenaVertices` and `arenaCentroid`.
- Set `ringVertices = arenaVertices` (ring starts at full size).
- Spawn players inside polygon.

**`resetForNextRound()` changes:**
- Generate a new polygon for the lobby.
- Spawn players inside polygon.

**`tickActive()` changes:**
- Compute `shrinkProgress` as before (0→1 over 75s).
- `ringVertices = scalePolygonTowardCentroid(arenaVertices, arenaCentroid, shrinkProgress * 0.95)`.

**`movePlayer()` changes:**
- Replace distance-from-center check with `pointInConvexPolygon`.
- If outside, use `clampPointToPolygon` to push to nearest edge.

**`updateBullets()` changes:**
- Replace `dist > ARENA_RADIUS + 50` with `!pointInConvexPolygon(bullet.x, bullet.y, arenaVertices)`. Add small margin by checking against a slightly expanded version of arenaVertices.

**`applyRingDamage()` changes:**
- Replace `dist > this.ringRadius` with `!pointInConvexPolygon(player.x, player.y, this.ringVertices)`.

**`spawnPlayer()` and `startRound()` spawn logic changes:**
- Replace circular spawn with point inside current arena polygon at ~80% from centroid.

**`getState()` changes:**
- Add `arenaVertices` and `ringVertices` arrays to serialized state.
- Keep `arenaRadius` for backward compatibility / camera framing.

### 3. Client Rendering Changes (client/client.js)

**Arena background:**
- Replace `ctx.arc(cx, cy, arenaRadius * scale, ...)` with polygon path using `gameState.arenaVertices`.

**Ring boundary:**
- Replace ring arc with polygon path using `gameState.ringVertices`.

**Danger zone:**
- Draw arena polygon fill, then clip to ring polygon inverse for the red tint overlay.

**State reception:**
- Read `arenaVertices` and `ringVertices` from game state messages.

### 4. Test Updates (test/game.test.js)

Tests affected:
- **"Game initializes in lobby state"** — check `arenaVertices` exists, is array with 5-10 vertices.
- **"Players spawn around arena edge in lobby"** — verify spawn is inside polygon.
- **"Movement is clamped to arena bounds"** — verify clamped to polygon edge.
- **"Ring shrinks during active game"** — verify ringVertices are closer to centroid than arenaVertices.
- **"Ring damage applies to players outside ring"** — place player outside ringVertices polygon.
- **"Game state serialization works"** — check for `arenaVertices` and `ringVertices` fields.

New tests to add:
- Polygon generation produces valid convex polygon with correct vertex count.
- Point-in-polygon correctly classifies inside/outside points.
- Polygon scaling produces smaller polygon.
- Bullets removed when exiting polygon.
- Each new round generates a different polygon shape.

### 5. Performance Considerations

- Point-in-polygon with N ≤ 10 vertices is ~10 cross-product operations — negligible.
- `clampPointToPolygon` iterates edges (≤ 10) — negligible.
- Ring vertices recomputed each tick (20 Hz) with ≤ 10 lerps — negligible.
- No performance concerns for this vertex count.

## Execution Strategy

**Single agent** — all changes are tightly coupled. The polygon math, game logic, client rendering, and tests all depend on consistent polygon data structures and interfaces. Splitting would create merge conflicts and integration complexity.

## Files Modified

1. `server/game.js` — polygon generation, boundary logic, state serialization
2. `client/client.js` — polygon rendering
3. `test/game.test.js` — updated and new tests

## Sources

- Point-in-polygon (cross-product method for convex polygons): standard computational geometry, no external library needed
- Convex polygon generation via sorted random angles: standard approach for generating random convex polygons inscribed in a circle
