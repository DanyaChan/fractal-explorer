import { FRACTALS, KIND, packCoefficients } from './fractals.js';
import { PALETTES, samplePalette } from './palettes.js';

// ---------------------------------------------------------------------------
// View state. `span` is the complex distance across the shorter side of the
// viewport, so the view survives window resizes and DPR changes. The imaginary
// axis points up.

let fractalId = 'mandelbrot';
const fractal = () => FRACTALS[fractalId];
const STRIP_ROWS = 16;
// Below this (relative to |c|) adjacent pixels stop being distinct doubles.
const MIN_RELATIVE_PS = 2e-15;

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const back = document.createElement('canvas');
const backCtx = back.getContext('2d');

const ui = {
  panel: document.getElementById('panel'),
  toggle: document.getElementById('toggle'),
  fractal: document.getElementById('fractal'),
  palette: document.getElementById('palette'),
  cycle: document.getElementById('cycle'),
  cycleLabel: document.getElementById('cycle-label'),
  cycleOut: document.getElementById('cycle-out'),
  iters: document.getElementById('iters'),
  autoIters: document.getElementById('auto-iters'),
  reset: document.getElementById('reset'),
  stats: document.getElementById('stats'),
};

const view = { ...fractal().home };

// Complex distance per CSS pixel.
function pixelSize() {
  return view.span / Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
}

function resetView() {
  Object.assign(view, fractal().home);
}

function zoomFactor() {
  return fractal().home.span / view.span;
}

function minSpan() {
  const shortSide = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
  return MIN_RELATIVE_PS * shortSide * Math.max(1, Math.abs(view.x), Math.abs(view.y));
}

function maxIterations() {
  if (!ui.autoIters.checked) return Math.max(16, Math.round(+ui.iters.value) || 16);
  const depth = Math.max(0, Math.log2(zoomFactor()));
  const n = fractal().autoIter(depth);
  ui.iters.value = n;
  return n;
}

// Complex coordinate under a CSS-pixel position on the canvas.
function toComplex(sx, sy) {
  const ps = pixelSize();
  return {
    x: view.x + (sx - canvas.clientWidth / 2) * ps,
    y: view.y - (sy - canvas.clientHeight / 2) * ps,
  };
}

// Zoom by `factor` (>1 zooms in) keeping the point under (sx, sy) fixed.
function zoomAt(sx, sy, factor) {
  const anchor = toComplex(sx, sy);
  view.span = Math.max(minSpan(), view.span / factor);
  const ps = pixelSize();
  view.x = anchor.x - (sx - canvas.clientWidth / 2) * ps;
  view.y = anchor.y + (sy - canvas.clientHeight / 2) * ps;
  requestRender();
}

function panBy(dx, dy) {
  const ps = pixelSize();
  view.x -= dx * ps;
  view.y += dy * ps;
  requestRender();
}

// ---------------------------------------------------------------------------
// Worker pool. Each frame is split into strips that idle workers pull from a queue;
// strips from superseded frames are dropped on arrival.

const workerCount = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 16));
const workers = [];
const idle = [];
let queue = [];
let frame = null;
let jobId = 0;
let lastFrameMs = 0;

for (let i = 0; i < workerCount; i++) {
  const w = new Worker('worker.js');
  w.onmessage = (e) => onWorkerMessage(w, e.data);
  w.onerror = (e) => showError(e.message || 'worker failed to load');
  workers.push(w);
}

function onWorkerMessage(worker, msg) {
  if (msg.type === 'ready') {
    idle.push(worker);
    pump();
    return;
  }
  if (msg.type !== 'strip') return;

  idle.push(worker);
  if (frame && msg.job === frame.job) {
    ctx.putImageData(new ImageData(msg.pixels, msg.width, msg.rows), 0, msg.row0);
    if (--frame.remaining === 0) {
      lastFrameMs = performance.now() - frame.start;
      updateStats();
    }
  }
  pump();
}

function pump() {
  while (idle.length && queue.length) idle.pop().postMessage(queue.shift());
}

function broadcastPalette() {
  const colors = samplePalette(ui.palette.value);
  for (const w of workers) w.postMessage({ type: 'palette', colors });
}

function broadcastFractal() {
  const f = fractal();
  if (f.kind !== KIND.newton) return;
  const coefficients = packCoefficients(f.coefficients);
  for (const w of workers) w.postMessage({ type: 'polynomial', coefficients });
}

// ---------------------------------------------------------------------------
// Frame scheduling.

let rafPending = false;
let shown = null; // device-pixel view of what is currently on the canvas

function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(startFrame);
}

function startFrame() {
  rafPending = false;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const next = { x: view.x, y: view.y, ps: pixelSize() / dpr, width, height };

  // Reproject the current image into the new view as an instant preview; fresh
  // strips paint over it as they arrive.
  if (shown) {
    back.width = canvas.width;
    back.height = canvas.height;
    backCtx.drawImage(canvas, 0, 0);
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (shown) {
    const s = shown.ps / next.ps;
    const dx = width / 2 - (shown.width / 2) * s + (shown.x - next.x) / next.ps;
    const dy = height / 2 - (shown.height / 2) * s - (shown.y - next.y) / next.ps;
    ctx.drawImage(back, dx, dy, shown.width * s, shown.height * s);
  }
  shown = next;

  const job = ++jobId;
  const kind = fractal().kind;
  const maxIter = maxIterations();
  const density = 1 / 2 ** +ui.cycle.value;
  const strips = [];
  for (let row0 = 0; row0 < height; row0 += STRIP_ROWS) {
    strips.push({
      type: 'render', job, kind, width, height, row0,
      rows: Math.min(STRIP_ROWS, height - row0),
      cx: next.x, cy: next.y, pixelSize: next.ps, maxIter, density,
    });
  }
  // Center-out order: the middle of the screen, where you're looking, resolves first.
  strips.sort((a, b) => Math.abs(a.row0 - height / 2) - Math.abs(b.row0 - height / 2));

  queue = strips;
  frame = { job, remaining: strips.length, start: performance.now() };
  pump();
  updateStats();
  scheduleHashUpdate();
}

// ---------------------------------------------------------------------------
// HUD and URL state.

function fmtZoom(z) {
  return z < 1e4 ? z.toFixed(z < 10 ? 2 : 0) : z.toExponential(2);
}

function updateStats() {
  const done = frame && frame.remaining === 0;
  const atLimit = view.span <= minSpan() * 1.0001;
  ui.stats.innerHTML = [
    `re <b>${view.x.toPrecision(16)}</b>`,
    `im <b>${view.y.toPrecision(16)}</b>`,
    `zoom <b>${fmtZoom(zoomFactor())}×</b>` +
      (atLimit ? ' <span class="warn">(double precision limit)</span>' : ''),
    `iter <b>${ui.iters.value}</b> · ${workerCount} workers`,
    done ? `frame <b>${lastFrameMs.toFixed(0)} ms</b>` : 'rendering…',
  ].join('<br>');
}

function showError(message) {
  ui.stats.innerHTML = `<span class="warn">${message}</span>`;
}

let hashTimer = 0;
function scheduleHashUpdate() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const params = new URLSearchParams({
      f: fractalId,
      x: view.x.toPrecision(17),
      y: view.y.toPrecision(17),
      zoom: zoomFactor().toPrecision(8),
      palette: ui.palette.value,
      cycle: ui.cycle.value,
    });
    if (!ui.autoIters.checked) params.set('iter', ui.iters.value);
    history.replaceState(null, '', '#' + params);
  }, 300);
}

function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k) => (p.has(k) && Number.isFinite(+p.get(k)) ? +p.get(k) : null);
  if (Object.hasOwn(FRACTALS, p.get('f'))) selectFractal(p.get('f'));
  if (Object.hasOwn(PALETTES, p.get('palette'))) ui.palette.value = p.get('palette');
  if (num('cycle') !== null) ui.cycle.value = num('cycle');
  if (num('iter') !== null) {
    ui.autoIters.checked = false;
    ui.iters.value = num('iter');
  }
  if (num('x') !== null) view.x = num('x');
  if (num('y') !== null) view.y = num('y');
  if (num('zoom') > 0) view.span = Math.max(minSpan(), fractal().home.span / num('zoom'));
}

// ---------------------------------------------------------------------------
// Input.

const pointers = new Map();
let gesture = null; // last { x, y, dist } midpoint/spread of active pointers

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function gestureState() {
  const pts = [...pointers.values()];
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  return { x, y, dist };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, canvasPoint(e));
  gesture = gestureState();
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, canvasPoint(e));
  const g = gestureState();
  panBy(g.x - gesture.x, g.y - gesture.y);
  if (pointers.size > 1 && gesture.dist > 0 && g.dist > 0) zoomAt(g.x, g.y, g.dist / gesture.dist);
  gesture = g;
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  gesture = pointers.size ? gestureState() : null;
  if (!pointers.size) canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  // Pixel-mode deltas from trackpads are small and frequent; line-mode deltas are coarse.
  const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(p.x, p.y, Math.exp(-delta * 0.002));
}, { passive: false });

canvas.addEventListener('dblclick', (e) => {
  const p = canvasPoint(e);
  zoomAt(p.x, p.y, e.shiftKey ? 0.5 : 2);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const step = 60;
  const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
  switch (e.key) {
    case 'ArrowLeft': panBy(step, 0); break;
    case 'ArrowRight': panBy(-step, 0); break;
    case 'ArrowUp': panBy(0, step); break;
    case 'ArrowDown': panBy(0, -step); break;
    case '+': case '=': zoomAt(cx, cy, 1.5); break;
    case '-': case '_': zoomAt(cx, cy, 1 / 1.5); break;
    case 'r': case 'R': resetView(); requestRender(); break;
    case 'h': case 'H': ui.panel.classList.toggle('collapsed'); break;
    default: return;
  }
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// Controls.

for (const [id, f] of Object.entries(FRACTALS)) ui.fractal.add(new Option(f.label, id));
for (const name of Object.keys(PALETTES)) ui.palette.add(new Option(name, name));

// Switches fractal and resets the view and palette to its defaults. Callers
// broadcast to workers and request a render.
function selectFractal(id) {
  fractalId = id;
  ui.fractal.value = id;
  ui.palette.value = fractal().palette;
  ui.cycleLabel.textContent = fractal().shadingLabel;
  resetView();
  shown = null; // don't reproject the previous fractal as a preview
}

function syncCycleLabel() {
  // Newton shading halves in brightness every 2^cycle / 8 steps (see shade_newton).
  const n = 2 ** +ui.cycle.value / (fractal().kind === KIND.newton ? 8 : 1);
  ui.cycleOut.value = `${Math.round(n)} iter`;
}

ui.fractal.addEventListener('change', () => {
  selectFractal(ui.fractal.value);
  syncCycleLabel();
  broadcastFractal();
  broadcastPalette();
  requestRender();
});
ui.palette.addEventListener('change', () => { broadcastPalette(); requestRender(); });
ui.cycle.addEventListener('input', () => { syncCycleLabel(); requestRender(); });
ui.iters.addEventListener('change', () => { ui.autoIters.checked = false; requestRender(); });
ui.autoIters.addEventListener('change', requestRender);
ui.reset.addEventListener('click', () => { resetView(); requestRender(); });
ui.toggle.addEventListener('click', () => ui.panel.classList.toggle('collapsed'));

new ResizeObserver(requestRender).observe(canvas);

selectFractal(fractalId);
loadHash();
syncCycleLabel();
broadcastFractal();
broadcastPalette();
requestRender();
