// Color palettes, sampled into PALETTE_SIZE packed RGBA words (little-endian ABGR)
// that the wasm renderer interpolates between.

export const PALETTE_SIZE = 256;

// Piecewise-linear gradient through [position, [r, g, b]] stops; wraps from 1 back to 0.
function gradient(stops) {
  return (t) => {
    let i = 0;
    while (i < stops.length - 1 && stops[i + 1][0] <= t) i++;
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[(i + 1) % stops.length];
    const span = (i + 1 < stops.length ? p1 : p1 + 1) - p0;
    const f = span > 0 ? (t - p0) / span : 0;
    return c0.map((v, k) => v + (c1[k] - v) * f);
  };
}

// Inigo Quilez's cosine palette: a + b * cos(2π(c·t + d)).
function cosine(a, b, c, d) {
  return (t) => a.map((_, k) => 255 * (a[k] + b[k] * Math.cos(2 * Math.PI * (c[k] * t + d[k]))));
}

export const PALETTES = {
  'Classic': gradient([
    [0.0, [0, 7, 100]],
    [0.16, [32, 107, 203]],
    [0.42, [237, 255, 255]],
    [0.6425, [255, 170, 0]],
    [0.8575, [0, 2, 0]],
  ]),
  'Fire': gradient([
    [0.0, [10, 0, 0]],
    [0.25, [150, 20, 0]],
    [0.45, [255, 140, 0]],
    [0.6, [255, 240, 140]],
    [0.75, [255, 140, 0]],
    [0.9, [150, 20, 0]],
  ]),
  'Ice': gradient([
    [0.0, [2, 8, 30]],
    [0.3, [20, 90, 170]],
    [0.55, [180, 240, 255]],
    [0.8, [20, 90, 170]],
  ]),
  'Rainbow': cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0.0, 0.33, 0.67]),
  'Sunset': cosine([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0.0, 0.1, 0.2]),
  'Mono': gradient([
    [0.0, [0, 0, 0]],
    [0.5, [255, 255, 255]],
  ]),
};

export function samplePalette(name) {
  const fn = PALETTES[name];
  const out = new Uint32Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = fn(i / PALETTE_SIZE).map((v) => Math.max(0, Math.min(255, Math.round(v))));
    out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return out;
}
