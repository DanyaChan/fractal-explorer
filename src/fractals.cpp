// Fractal renderers compiled to freestanding wasm32 (no libc, no Emscripten).
//
// JS fills the palette (and, for Newton fractals, the polynomial), calls prepare()
// to size the pixel buffer at __heap_base, then render() for a strip of rows.

#include <stddef.h>
#include <stdint.h>

#define EXPORT(name) extern "C" __attribute__((export_name(name)))

extern "C" unsigned char __heap_base;

namespace {

enum Kind { kMandelbrot = 0, kNewton = 1 };

constexpr int kPaletteSize = 256;
constexpr int kMaxDegree = 16;
constexpr uint32_t kPageSize = 65536;
constexpr uint32_t kInside = 0xff000000;  // opaque black (ABGR in memory)
constexpr double kBailout = 256.0;        // |z|^2 escape radius; large for smooth coloring
constexpr double kNewtonTol2 = 1e-12;     // |step|^2 below which Newton has converged

struct Complex {
  double re, im;
};

Complex operator+(Complex a, Complex b) { return {a.re + b.re, a.im + b.im}; }
Complex operator-(Complex a, Complex b) { return {a.re - b.re, a.im - b.im}; }
Complex operator*(Complex a, Complex b) {
  return {a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re};
}
double norm(Complex a) { return a.re * a.re + a.im * a.im; }
Complex operator/(Complex a, Complex b) {
  double d = norm(b);
  return {(a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d};
}

uint32_t g_palette[kPaletteSize];
Complex g_coef[kMaxDegree + 1];  // ascending powers, written by JS
Complex g_roots[kMaxDegree];
int g_degree = 0;

uint32_t* pixels() { return reinterpret_cast<uint32_t*>(&__heap_base); }

// log2 for positive finite doubles via exponent extraction plus an atanh series
// on the mantissa. Error < 1e-6, which is plenty for coloring.
double log2_approx(double x) {
  uint64_t bits = __builtin_bit_cast(uint64_t, x);
  int exponent = int((bits >> 52) & 0x7ff) - 1023;
  bits = (bits & 0x000fffffffffffffull) | 0x3ff0000000000000ull;
  double m = __builtin_bit_cast(double, bits);  // m in [1, 2)
  double s = (m - 1.0) / (m + 1.0);             // s in [0, 1/3)
  double s2 = s * s;
  double series = s * (1.0 + s2 * (1.0 / 3 + s2 * (1.0 / 5 + s2 * (1.0 / 7 + s2 * (1.0 / 9)))));
  return exponent + series * 2.8853900817779268;  // 2 / ln(2)
}

uint32_t lerp_color(uint32_t a, uint32_t b, double t) {
  uint32_t out = 0xff000000;
  for (int shift = 0; shift < 24; shift += 8) {
    double ca = (a >> shift) & 0xff;
    double cb = (b >> shift) & 0xff;
    out |= uint32_t(ca + (cb - ca) * t + 0.5) << shift;
  }
  return out;
}

uint32_t scale_color(uint32_t c, double k) {
  uint32_t out = 0xff000000;
  for (int shift = 0; shift < 24; shift += 8) {
    out |= uint32_t(((c >> shift) & 0xff) * k + 0.5) << shift;
  }
  return out;
}

// Samples the palette cyclically at t (only the fractional part matters).
uint32_t palette_at(double t) {
  t -= __builtin_floor(t);
  double pos = t * kPaletteSize;
  int i = int(pos);
  return lerp_color(g_palette[i], g_palette[(i + 1) % kPaletteSize], pos - i);
}

// ---------------------------------------------------------------------------
// Mandelbrot: z -> z^2 + c, colored by smooth escape count.

uint32_t shade_mandelbrot(double cr, double ci, int max_iter, double density) {
  // Points in the main cardioid and the period-2 bulb never escape; skip them.
  double xq = cr - 0.25;
  double q = xq * xq + ci * ci;
  if (q * (q + xq) <= 0.25 * ci * ci) return kInside;
  if ((cr + 1.0) * (cr + 1.0) + ci * ci <= 0.0625) return kInside;

  double zr = 0, zi = 0, zr2 = 0, zi2 = 0;
  int n = 0;
  while (n < max_iter && zr2 + zi2 <= kBailout) {
    zi = 2.0 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr;
    zi2 = zi * zi;
    ++n;
  }
  if (n == max_iter) return kInside;

  // Continuous escape count: mu = n + 1 - log2(log2|z|).
  double mu = n + 1 - log2_approx(0.5 * log2_approx(zr2 + zi2));
  return palette_at(mu * density);
}

// ---------------------------------------------------------------------------
// Newton: z -> z - p(z)/p'(z), colored by which root z converges to and shaded
// by how many steps it took.

void eval_poly(Complex z, Complex& p, Complex& dp) {
  p = g_coef[g_degree];
  dp = {0, 0};
  for (int k = g_degree - 1; k >= 0; --k) {
    dp = dp * z + p;
    p = p * z + g_coef[k];
  }
}

// Durand–Kerner: refine all roots simultaneously from points on a spiral.
void find_roots() {
  Complex seed{0.4, 0.9}, power{1, 0};
  for (int i = 0; i < g_degree; ++i) {
    g_roots[i] = power;
    power = power * seed;
  }
  for (int iter = 0; iter < 1000; ++iter) {
    double change = 0;
    for (int i = 0; i < g_degree; ++i) {
      Complex p, dp;
      eval_poly(g_roots[i], p, dp);
      Complex denom = g_coef[g_degree];
      for (int j = 0; j < g_degree; ++j) {
        if (j != i) denom = denom * (g_roots[i] - g_roots[j]);
      }
      Complex step = p / denom;
      g_roots[i] = g_roots[i] - step;
      change += norm(step);
    }
    if (change < 1e-30) break;
  }
}

int nearest_root(Complex z) {
  int best = 0;
  double best_d = norm(z - g_roots[0]);
  for (int i = 1; i < g_degree; ++i) {
    double d = norm(z - g_roots[i]);
    if (d < best_d) best_d = d, best = i;
  }
  return best;
}

uint32_t shade_newton(double cr, double ci, int max_iter, double density) {
  Complex z{cr, ci};
  for (int n = 0; n < max_iter; ++n) {
    Complex p, dp;
    eval_poly(z, p, dp);
    if (norm(dp) < 1e-300) break;  // critical point: the step is undefined
    Complex step = p / dp;
    z = z - step;
    double s = norm(step);
    if (s < kNewtonTol2) {
      // Convergence is quadratic, so log|step| roughly doubles each iteration;
      // this interpolates the step count continuously between n and n + 1.
      double ratio = log2_approx(s) / log2_approx(kNewtonTol2);
      double mu = n + 1 - (ratio > 1 ? log2_approx(ratio) : 0);
      double brightness = 1.0 / (1.0 + mu * density * 8.0);
      uint32_t color = g_palette[nearest_root(z) * kPaletteSize / g_degree];
      return scale_color(color, brightness);
    }
  }
  return kInside;  // stuck in a cycle or at a critical point
}

}  // namespace

EXPORT("palette_ptr") uint32_t* palette_ptr() { return g_palette; }
EXPORT("palette_size") int palette_size() { return kPaletteSize; }

// Coefficients as interleaved (re, im) doubles, constant term first.
EXPORT("poly_ptr") double* poly_ptr() { return &g_coef[0].re; }
EXPORT("max_degree") int max_degree() { return kMaxDegree; }

// Activates the polynomial written at poly_ptr() and finds its roots.
// Returns the degree, or 0 if it is out of range or the leading coefficient is 0.
EXPORT("set_polynomial") int set_polynomial(int degree) {
  if (degree < 1 || degree > kMaxDegree || norm(g_coef[degree]) == 0) return 0;
  g_degree = degree;
  find_roots();
  return degree;
}

// Ensures linear memory can hold width x rows pixels. Returns the pixel buffer,
// or null if memory could not grow.
EXPORT("prepare") uint32_t* prepare(int width, int rows) {
  uintptr_t end = reinterpret_cast<uintptr_t>(pixels() + size_t(width) * rows);
  uintptr_t have = __builtin_wasm_memory_size(0) * kPageSize;
  if (end > have) {
    size_t pages = (end - have + kPageSize - 1) / kPageSize;
    if (__builtin_wasm_memory_grow(0, pages) == size_t(-1)) return nullptr;
  }
  return pixels();
}

// Renders rows [row0, row0 + rows) of a width x height view into the pixel buffer.
// (center_x, center_y) is the complex point at the view center; pixel_size is the
// complex distance between adjacent pixels. Imaginary axis points up.
EXPORT("render")
void render(int kind, int width, int height, int row0, int rows, double center_x,
            double center_y, double pixel_size, int max_iter, double density) {
  uint32_t* out = pixels();
  double half_w = width * 0.5, half_h = height * 0.5;
  for (int py = row0; py < row0 + rows; ++py) {
    double ci = center_y - (py + 0.5 - half_h) * pixel_size;
    for (int px = 0; px < width; ++px) {
      double cr = center_x + (px + 0.5 - half_w) * pixel_size;
      *out++ = kind == kNewton ? shade_newton(cr, ci, max_iter, density)
                               : shade_mandelbrot(cr, ci, max_iter, density);
    }
  }
}
