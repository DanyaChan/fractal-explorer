// Render worker: owns one wasm instance and renders horizontal strips on request.

let wasm = null;
const pending = [];

async function load() {
  const url = new URL('fractals.wasm', self.location.href);
  let result;
  try {
    result = await WebAssembly.instantiateStreaming(fetch(url));
  } catch {
    // Fallback for servers that don't send application/wasm.
    const bytes = await (await fetch(url)).arrayBuffer();
    result = await WebAssembly.instantiate(bytes);
  }
  wasm = result.instance.exports;
  for (const msg of pending.splice(0)) handle(msg);
}

function handle(msg) {
  if (msg.type === 'palette') {
    const ptr = wasm.palette_ptr();
    new Uint32Array(wasm.memory.buffer, ptr, wasm.palette_size()).set(msg.colors);
    return;
  }

  if (msg.type === 'polynomial') {
    // msg.coefficients: interleaved [re, im] pairs, constant term first.
    const degree = msg.coefficients.length / 2 - 1;
    if (degree > wasm.max_degree()) throw new Error(`degree ${degree} exceeds ${wasm.max_degree()}`);
    const ptr = wasm.poly_ptr();
    new Float64Array(wasm.memory.buffer, ptr, msg.coefficients.length).set(msg.coefficients);
    if (!wasm.set_polynomial(degree)) throw new Error('invalid polynomial');
    return;
  }

  if (msg.type === 'render') {
    const { job, kind, width, height, row0, rows, cx, cy, pixelSize, maxIter, density } = msg;
    const t0 = performance.now();
    const ptr = wasm.prepare(width, rows);
    if (!ptr) throw new Error('wasm memory grow failed');
    wasm.render(kind, width, height, row0, rows, cx, cy, pixelSize, maxIter, density);
    // Copy out of wasm memory (memory.buffer can be replaced by a later grow).
    const pixels = new Uint8ClampedArray(wasm.memory.buffer, ptr, width * rows * 4).slice();
    self.postMessage({ type: 'strip', job, row0, rows, width, pixels, ms: performance.now() - t0 },
                     [pixels.buffer]);
  }
}

self.onmessage = (e) => (wasm ? handle(e.data) : pending.push(e.data));
load().then(() => self.postMessage({ type: 'ready' }));
