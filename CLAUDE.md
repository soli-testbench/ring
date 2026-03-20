# Integration Summary

## Plan Branch
agent/7b877254-e6c5-4e94-87a7-82052ec9e98a
## Upstream Repository
soli-testbench/ring

## Suggested PR Title
fix(game): preserve arena polygon across countdown-to-round transition

## Suggested PR Description
## Summary
- **Bug**: `startRound()` was regenerating the convex polygon arena (`arenaVertices` and `arenaCentroid`), causing the map shape and player positions to visibly change when the countdown ended and the round began.
- **Fix**: Removed the `generateConvexPolygon()` and `getPolygonCentroid()` calls from `startRound()`. The polygon is now only generated in the `Game` constructor (first round) and `resetForNextRound()` (subsequent rounds), ensuring the map shown during the lobby/countdown is the same map used when the round starts.
- **Tests**: Updated the "each new round generates a different polygon" test to verify the polygon changes in `resetForNextRound()` (the correct lifecycle point). Added a new test confirming `startRound()` preserves the lobby polygon and centroid. All 891 tests pass.

## Test plan
- [x] `npm test` passes (891/891)
- [x] New test verifies `arenaVertices` and `arenaCentroid` are identical before and after `startRound()`
- [x] Existing polygon-change test updated to test `resetForNextRound()` instead of `startRound()`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## Original Task

**Description**: There's a bug where the map during the countdown and the player positioning during the countdown isn't the same as the map when the round starts. Please fix. 

**Acceptance Criteria**: