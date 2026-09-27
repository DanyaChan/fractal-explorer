# Fractal Explorer

Interactive explorer for the Mandelbrot set and Newton fractals. The renderer is freestanding C++ compiled straight to
wasm32 with clang + wasm-ld (no Emscripten, no libc); the page splits each frame into
strips rendered in parallel by a pool of Web Workers.

## Build & run

```sh
brew install llvm lld   # clang with the wasm32 target + wasm-ld
make serve              # builds web/fractals.wasm, serves on http://localhost:8000
```

## Controls

- Drag to pan, scroll / pinch to zoom, double-click to zoom in (Shift to zoom out)
- Arrow keys pan, `+`/`-` zoom, `R` resets, `H` hides the panel
- The URL hash holds the current view, so links are shareable

## Layout

- `src/fractals.cpp` — Mandelbrot escape-time and Newton kernels, root finding, coloring
- `web/worker.js` — loads the wasm module, renders strips on request
- `web/main.js` — view state, input, worker scheduling, HUD
- `web/fractals.js` — fractal list; a Newton fractal is just a coefficient array
- `web/palettes.js` — color palettes

Zoom is limited to ~10¹²× by double precision.
