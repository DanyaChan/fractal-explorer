// Fractal definitions. `kind` selects the renderer in the wasm module (see Kind in
// src/fractals.cpp). Newton fractals list polynomial coefficients from the constant
// term up; each is a real number or an [re, im] pair.

export const KIND = { mandelbrot: 0, newton: 1 };

const newton = (label, coefficients, span = 3) => ({
  label,
  kind: KIND.newton,
  coefficients,
  home: { x: 0, y: 0, span },
  palette: 'Rainbow',
  shadingLabel: 'Shading falloff',
  autoIter: (depth) => Math.min(2000, Math.round(100 + 12 * depth)),
});

export const FRACTALS = {
  'mandelbrot': {
    label: 'Mandelbrot',
    kind: KIND.mandelbrot,
    home: { x: -0.75, y: 0, span: 3 },
    palette: 'Classic',
    shadingLabel: 'Color cycle',
    autoIter: (depth) => Math.min(50000, Math.round(250 + 110 * depth)),
  },
  'newton3': newton('Newton: z³ − 1', [-1, 0, 0, 1]),
  'newton4': newton('Newton: z⁴ − 1', [-1, 0, 0, 0, 1]),
  'newton5': newton('Newton: z⁵ − 1', [-1, 0, 0, 0, 0, 1]),
  'newton-cycle': newton('Newton: z³ − 2z + 2', [2, -2, 0, 1], 4),
  'newton-6-3': newton('Newton: z⁶ + z³ − 1', [-1, 0, 0, 1, 0, 0, 1]),
  'newton-8-4': newton('Newton: z⁸ + 15z⁴ − 16', [-16, 0, 0, 0, 15, 0, 0, 0, 1], 5),
  'newton-complex': newton('Newton: z⁵ − 3iz³ − (5+2i)z² + 3z + 1',
                           [1, 3, [-5, -2], [0, -3], 0, 1], 4),
};

// Interleaved [re, im, re, im, ...] for the worker.
export function packCoefficients(coefficients) {
  return new Float64Array(coefficients.flatMap((c) => (Array.isArray(c) ? c : [c, 0])));
}
