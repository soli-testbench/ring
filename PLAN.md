# Plan: Make Game + Map Higher Resolution

## Problem

The game canvas renders fuzzy/blurry on high-DPI (Retina) displays. This is the classic HTML5 Canvas resolution problem — the canvas backing buffer matches CSS pixels rather than device pixels, causing the browser to upscale a low-resolution buffer.

## Root Cause Analysis

In `client/client.js`, the `resizeCanvas()` function (line 7–11) sets:
```js
canvas.width = size;   // CSS pixels
canvas.height = size;  // CSS pixels
```

On a 2x Retina display, this means a 600×600 CSS-pixel canvas has only a 600×600 backing buffer, but the display renders it at 1200×1200 physical pixels — the browser upscales it, producing blur.

Additionally, all rendering uses fixed small pixel values (bullet radius 3px, line widths 2px, font sizes) that compound the fuzzy appearance.

## Solution

Apply the standard Canvas HiDPI fix — a well-known pattern with no external dependencies:

1. **Scale the canvas backing buffer** by `window.devicePixelRatio`
2. **Set CSS dimensions** explicitly to maintain the same visual size
3. **Scale the 2D context** by `devicePixelRatio` so all drawing coordinates remain unchanged
4. **Reset context transform** at the start of each render frame (since `resizeCanvas` may be called on window resize)

### Key Changes (all in `client/client.js`)

**`resizeCanvas()` function** — multiply backing buffer by DPR, set CSS size, apply context scale:
```js
function resizeCanvas() {
  const size = Math.min(window.innerWidth - 20, window.innerHeight - 80);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
```

**Add a `canvasSize` variable** — tracks the logical (CSS) size so rendering and input code use CSS coordinates instead of `canvas.width`/`canvas.height` (which are now DPR-scaled).

**`render()` function** — replace `canvas.width`/`canvas.height` with `canvasSize` for coordinate math. Use `canvas.width`/`canvas.height` only for the initial `clearRect` (which needs physical pixels, so save/restore transform around it).

**`sendInput()` function** — replace `canvas.width` with `canvasSize` for aim angle calculation.

**Mouse coordinates** — already correct since `getBoundingClientRect()` returns CSS coordinates, and our context is scaled by DPR.

### What Stays The Same
- All drawing coordinates, font sizes, line widths, and radii remain exactly the same in code — the DPR scaling is handled at the context transform level
- Server-side code (`server/game.js`, `server/index.js`) is untouched
- All 44 existing tests continue to pass (they only test server-side logic)

## Files Modified
- `client/client.js` — resizeCanvas(), render(), sendInput(), add canvasSize variable

## Risks
- None significant. This is a standard, well-tested pattern. The only client-side file is modified; server logic is untouched.

## References
- [MDN: Window.devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) — standard web API
- This is the canonical approach used by every major Canvas library (Pixi.js, Fabric.js, Konva, etc.)
