#include "include/analytic-path.h"

// Independent implementation of the public Loop/Blinn construction (2005),
// GPU Gems 3 chapter 25. No allocation, host math/runtime, or sampled
// polylines.
namespace {
using P = SAInkPoint;
static double ab(double x) { return x < 0 ? -x : x; }
static double mn(double a, double b) { return a < b ? a : b; }
static double mx(double a, double b) { return a > b ? a : b; }
static bool fin(double x) { return __builtin_isfinite(x); }
static P add(P a, P b) { return {a.x + b.x, a.y + b.y}; }
static P sub(P a, P b) { return {a.x - b.x, a.y - b.y}; }
static P mul(P a, double s) { return {a.x * s, a.y * s}; }
static P lerp(P a, P b, double t) { return add(mul(a, 1 - t), mul(b, t)); }
static double cross(P a, P b) { return a.x * b.y - a.y * b.x; }
static double turn(P a, P b, P c) {
  P u = sub(b, a), v = sub(c, a);
  double scale = mx(mx(ab(u.x), ab(u.y)), mx(ab(v.x), ab(v.y)));
  if (!scale)
    return 0;
  return cross({u.x / scale, u.y / scale}, {v.x / scale, v.y / scale});
}
static bool same(P a, P b) { return a.x == b.x && a.y == b.y; }
static P map(const double *m, P p) {
  return {m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]};
}
static P evaluate(const P *p, double t) {
  P a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), c = lerp(p[2], p[3], t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}
static void split(const P *p, double t, P *l, P *r) {
  P a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), c = lerp(p[2], p[3], t),
    d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
  l[0] = p[0];
  l[1] = a;
  l[2] = d;
  l[3] = f;
  r[0] = f;
  r[1] = e;
  r[2] = c;
  r[3] = p[3];
}
static bool valid_points(const P *p) {
  for (int i = 0; i < 4; i++)
    if (!fin(p[i].x) || !fin(p[i].y) || ab(p[i].x) > 1e150 ||
        ab(p[i].y) > 1e150)
      return false;
  return true;
}
static bool affine_valid(const double *m) {
  if (!m)
    return false;
  for (int i = 0; i < 6; i++)
    if (!fin(m[i]))
      return false;
  return true;
}
// Stable quadratic roots. Scaling before products prevents exponent overflow.
static int affine_orientation(const double *m) {
  double a = mx(ab(m[0]), ab(m[1])), b = mx(ab(m[2]), ab(m[3]));
  if (!a || !b)
    return 0;
  double d = (m[0] / a) * (m[3] / b) - (m[1] / a) * (m[2] / b);
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}
static int roots(double a, double b, double c, double *r) {
  double s = mx(ab(a), mx(ab(b), ab(c)));
  if (!s)
    return 0;
  a /= s;
  b /= s;
  c /= s;
  if (!a) {
    if (!b)
      return 0;
    r[0] = -c / b;
    return 1;
  }
  double d = b * b - 4 * a * c;
  if (d < 0)
    return 0;
  double q = -0.5 * (b + (b < 0 ? -1 : 1) * __builtin_sqrt(d));
  if (!q) {
    r[0] = -b / (2 * a);
    return 1;
  }
  r[0] = q / a;
  r[1] = c / q;
  if (r[0] > r[1]) {
    double t = r[0];
    r[0] = r[1];
    r[1] = t;
  }
  return d == 0 ? 1 : 2;
}
static int cuts_y(const P *p, double *r) {
  double a = -p[0].y + 3 * p[1].y - 3 * p[2].y + p[3].y,
         b = 2 * (p[0].y - 2 * p[1].y + p[2].y), c = p[1].y - p[0].y;
  double tmp[2];
  int n = roots(a, b, c, tmp), k = 0;
  r[k++] = 0;
  for (int i = 0; i < n; i++)
    if (tmp[i] > 0 && tmp[i] < 1)
      r[k++] = tmp[i];
  r[k++] = 1;
  return k;
}
static int line_winding(P a, P b, double x, double y, bool &boundary) {
  double side = turn(a, b, {x, y});
  if (side == 0 && x >= mn(a.x, b.x) && x <= mx(a.x, b.x) &&
      y >= mn(a.y, b.y) && y <= mx(a.y, b.y))
    boundary = true;
  if (a.y <= y && y < b.y)
    return side > 0 ? 1 : 0;
  if (b.y <= y && y < a.y)
    return side < 0 ? -1 : 0;
  return 0;
}
static int curve_winding(const P *p, double x, double y, bool &boundary) {
  double cut[4];
  int n = cuts_y(p, cut), w = 0;
  for (int i = 1; i < n; i++) {
    double lo = cut[i - 1], hi = cut[i];
    P a = evaluate(p, lo), b = evaluate(p, hi);
    int dir = b.y > a.y ? 1 : -1;
    if ((a.x == x && a.y == y) || (b.x == x && b.y == y))
      boundary = true;
    if (!(mn(a.y, b.y) <= y && y < mx(a.y, b.y)))
      continue;
    for (int j = 0; j < 80; j++) {
      double mid = (lo + hi) * 0.5;
      if (mid == lo || mid == hi)
        break;
      double v = evaluate(p, mid).y;
      if ((v < y) == (dir > 0))
        lo = mid;
      else
        hi = mid;
    }
    P q = evaluate(p, (lo + hi) * 0.5);
    if (q.x == x)
      boundary = true;
    if (q.x > x)
      w += dir;
  }
  return w;
}
static P evaluate_quad(P a, P q, P z, double t) {
  return lerp(lerp(a, q, t), lerp(q, z, t), t);
}
static int quad_winding(P a, P q, P z, double x, double y, bool &boundary) {
  double cuts[3] = {0, 1, 0};
  int n = 2;
  double den = a.y - 2 * q.y + z.y;
  if (den) {
    double t = (a.y - q.y) / den;
    if (t > 0 && t < 1) {
      cuts[1] = t;
      cuts[2] = 1;
      n = 3;
    }
  }
  int w = 0;
  for (int i = 1; i < n; i++) {
    double lo = cuts[i - 1], hi = cuts[i];
    P p = evaluate_quad(a, q, z, lo), r = evaluate_quad(a, q, z, hi);
    if ((p.x == x && p.y == y) || (r.x == x && r.y == y))
      boundary = true;
    int dir = r.y > p.y ? 1 : -1;
    if (!(mn(p.y, r.y) <= y && y < mx(p.y, r.y)))
      continue;
    for (int j = 0; j < 80; j++) {
      double t = (lo + hi) * .5;
      if (t == lo || t == hi)
        break;
      double v = evaluate_quad(a, q, z, t).y;
      if ((v < y) == (dir > 0))
        lo = t;
      else
        hi = t;
    }
    P v = evaluate_quad(a, q, z, (lo + hi) * .5);
    if (v.x == x)
      boundary = true;
    if (v.x > x)
      w += dir;
  }
  return w;
}
// A bounded exact dyadic certificate is used ONLY for singular classifications.
// If the local binary64 grid needs more than 22 bits, no rounding/snap occurs:
// the curve uses analytic ray mode. 22-bit coordinates keep determinants in
// int64; the discriminant is compared with an owned two-word integer product.
struct U128 {
  uint64_t hi, lo;
};
static U128 product(uint64_t a, uint64_t b) {
  const uint64_t mask = 0xffffffffu;
  uint64_t a0 = a & mask, a1 = a >> 32, b0 = b & mask, b1 = b >> 32,
           t = a0 * b0, w0 = t & mask, k = t >> 32;
  t = a1 * b0 + k;
  uint64_t w1 = t & mask, w2 = t >> 32;
  t = a0 * b1 + w1;
  return {a1 * b1 + w2 + (t >> 32), (t << 32) + w0};
}
static U128 times(U128 a, uint32_t n) {
  U128 r = {0, 0};
  for (uint32_t i = 0; i < n; i++) {
    uint64_t before = r.lo;
    r.lo += a.lo;
    r.hi += a.hi + (r.lo < before);
  }
  return r;
}
static double power_scale(double s) {
  union {
    double d;
    uint64_t u;
  } v = {s};
  uint64_t exponent = (v.u >> 52) & 2047;
  if (!exponent)
    return s;
  v.u = exponent << 52;
  return v.d;
}
static bool exact_singular(const P *q, bool &d1zero, bool &d2zero,
                           bool &disczero) {
  uint64_t mantissa[8];
  int exponent[8], minimum = 2048;
  bool negative[8];
  for (int i = 0; i < 8; i++) {
    double x = i % 2 ? q[i / 2].y : q[i / 2].x;
    union {
      double d;
      uint64_t u;
    } v = {x};
    negative[i] = (v.u >> 63) != 0;
    uint64_t e = (v.u >> 52) & 2047, m = v.u & 0xfffffffffffffu;
    if (!e && m)
      return false;
    if (!m && !e) {
      mantissa[i] = 0;
      exponent[i] = 0;
      continue;
    }
    m |= 1ull << 52;
    int power = (int)e - 1023 - 52;
    while ((m & 1) == 0) {
      m >>= 1;
      power++;
    }
    mantissa[i] = m;
    exponent[i] = power;
    if (power < minimum)
      minimum = power;
  }
  int64_t value[8];
  for (int i = 0; i < 8; i++) {
    if (!mantissa[i]) {
      value[i] = 0;
      continue;
    }
    int bits = 0;
    for (uint64_t x = mantissa[i]; x; x >>= 1)
      bits++;
    int shift = exponent[i] - minimum;
    if (shift < 0 || shift + bits > 22)
      return false;
    int64_t x = (int64_t)(mantissa[i] << shift);
    value[i] = negative[i] ? -x : x;
  }
  auto det = [&](int a, int b) {
    return value[a * 2] * value[b * 2 + 1] - value[a * 2 + 1] * value[b * 2];
  };
  int64_t a1 = det(3, 2), a2 = det(3, 1), a3 = det(2, 1),
          d1 = a1 - 2 * a2 + 3 * a3, d2 = -a2 + 3 * a3, d3 = 3 * a3;
  d1zero = d1 == 0;
  d2zero = d2 == 0;
  if (d1 != 0 && d3 != 0 && (d1 < 0) != (d3 < 0)) {
    disczero = false;
    return true;
  }
  uint64_t x = d2 < 0 ? (uint64_t)-d2 : (uint64_t)d2,
           y = d1 < 0 ? (uint64_t)-d1 : (uint64_t)d1,
           z = d3 < 0 ? (uint64_t)-d3 : (uint64_t)d3;
  U128 left = times(product(x, x), 3), right = times(product(y, z), 4);
  disczero = left.hi == right.hi && left.lo == right.lo;
  return true;
}
struct CurveData {
  double v[4][3];
  double d1, d2, d3, disc;
  int kind;
};
// Coordinates are normalized before classification, not quantized. A doubtful
// determinant is NOT rounded to zero or to a quadratic: use analytic ray mode.
static bool data(const P *p, CurveData &d) {
  P q[4];
  double scale = 0;
  for (int i = 0; i < 4; i++) {
    q[i] = sub(p[i], p[0]);
    scale = mx(scale, mx(ab(q[i].x), ab(q[i].y)));
  }
  if (!scale) {
    d.kind = 0;
    return true;
  }
  scale = power_scale(scale);
  for (int i = 0; i < 4; i++)
    q[i] = {q[i].x / scale, q[i].y / scale};
  double a1 = cross(q[3], q[2]), a2 = cross(q[3], q[1]), a3 = cross(q[2], q[1]);
  d.d1 = a1 - 2 * a2 + 3 * a3;
  d.d2 = -a2 + 3 * a3;
  d.d3 = 3 * a3;
  d.disc = 3 * d.d2 * d.d2 - 4 * d.d1 * d.d3;
  // Conservative roundoff guard; zero only has line semantics when the actual
  // control points are collinear. All other uncertain classifications are rays.
  double err = 256 * 0x1p-52 * (ab(a1) + 2 * ab(a2) + 3 * ab(a3));
  bool d1zero = false, d2zero = false, disczero = false;
  bool certified = false;
  if (ab(d.d1) <= err) {
    certified = exact_singular(q, d1zero, d2zero, disczero);
    if (!certified || !d1zero || d2zero)
      return false;
    d.kind = 3;
  } else {
    double de = 512 * 0x1p-52 * (3 * d.d2 * d.d2 + ab(4 * d.d1 * d.d3));
    if (ab(d.disc) <= de) {
      certified = exact_singular(q, d1zero, d2zero, disczero);
      if (!certified || !disczero || d1zero)
        return false;
      d.disc = 0;
    }
    d.kind = d.disc >= 0 ? 1 : 2;
  }
  double L[2], M[2];
  if (d.kind == 3) {
    L[0] = d.d3;
    L[1] = -3 * d.d2;
    M[0] = 1;
    M[1] = 0;
  } else {
    double z = __builtin_sqrt(ab(d.disc) / (d.kind == 1 ? 3 : 1));
    L[0] = d.d2 + z;
    M[0] = d.d2 - z;
    L[1] = M[1] = -2 * d.d1;
  }
  double ls = mx(ab(L[0]), ab(L[1])), ms = mx(ab(M[0]), ab(M[1]));
  if (!ls || !ms)
    return false;
  L[0] /= ls;
  L[1] /= ls;
  M[0] /= ms;
  M[1] /= ms;
  double powers[3][4] = {{0}};
  powers[0][0] = L[0] * M[0];
  powers[0][1] = L[0] * M[1] + L[1] * M[0];
  powers[0][2] = L[1] * M[1];
  if (d.kind == 3) {
    powers[0][0] = L[0];
    powers[0][1] = L[1];
    powers[0][2] = 0;
    powers[2][0] = 1;
  }
  for (int c = 1; c <= (d.kind == 3 ? 1 : 2); c++) {
    double A[2] = {L[0], L[1]}, B[2] = {L[0], L[1]}, C[2] = {L[0], L[1]};
    if (d.kind == 1 && c == 2) {
      A[0] = B[0] = C[0] = M[0];
      A[1] = B[1] = C[1] = M[1];
    }
    if (d.kind == 2) {
      C[0] = M[0];
      C[1] = M[1];
      if (c == 2) {
        B[0] = M[0];
        B[1] = M[1];
      }
    }
    for (int i = 0; i < 2; i++)
      for (int j = 0; j < 2; j++)
        for (int k = 0; k < 2; k++)
          powers[c][i + j + k] += A[i] * B[j] * C[k];
  }
  for (int c = 0; c < 3; c++) {
    const double *f = powers[c];
    d.v[0][c] = f[0];
    d.v[1][c] = f[0] + f[1] / 3;
    d.v[2][c] = f[0] + 2 * f[1] / 3 + f[2] / 3;
    d.v[3][c] = f[0] + f[1] + f[2] + f[3];
  }
  return true;
}
// Affine coordinates from the widest control triangle. The fourth control's
// residual verifies numerical rank; ill-conditioned implicitization stays rays.
static bool functionals(const P *p, const CurveData &d, double f[3][3]) {
  int a = 0, b = 1, c = 2;
  double det = 0;
  for (int i = 0; i < 4; i++)
    for (int j = i + 1; j < 4; j++)
      for (int k = j + 1; k < 4; k++) {
        double z = cross(sub(p[j], p[i]), sub(p[k], p[i]));
        if (ab(z) > ab(det)) {
          det = z;
          a = i;
          b = j;
          c = k;
        }
      }
  if (!det || !fin(det))
    return false;
  P u = sub(p[b], p[a]), v = sub(p[c], p[a]);
  for (int j = 0; j < 3; j++) {
    double r = d.v[b][j] - d.v[a][j], s = d.v[c][j] - d.v[a][j];
    f[j][0] = (r * v.y - s * u.y) / det;
    f[j][1] = (u.x * s - v.x * r) / det;
    f[j][2] = d.v[a][j] - f[j][0] * p[a].x - f[j][1] * p[a].y;
    for (int i = 0; i < 4; i++) {
      double actual = f[j][0] * p[i].x + f[j][1] * p[i].y + f[j][2];
      if (!fin(actual) || ab(actual - d.v[i][j]) > 1e-9)
        return false;
    }
  }
  return true;
}
static double implicit(const double f[3][3], P p) {
  double k = f[0][0] * p.x + f[0][1] * p.y + f[0][2],
         l = f[1][0] * p.x + f[1][1] * p.y + f[1][2],
         m = f[2][0] * p.x + f[2][1] * p.y + f[2][2];
  return k * k * k - l * m;
}
// Four-point convex hull. Sorting is literal numeric order and has no epsilon.
static int hull(const P *p, P *out) {
  P a[4];
  for (int i = 0; i < 4; i++)
    a[i] = p[i];
  for (int i = 1; i < 4; i++) {
    P v = a[i];
    int j = i;
    while (j > 0 &&
           (v.x < a[j - 1].x || (v.x == a[j - 1].x && v.y < a[j - 1].y))) {
      a[j] = a[j - 1];
      j--;
    }
    a[j] = v;
  }
  P h[8];
  int n = 0;
  for (int i = 0; i < 4; i++) {
    if (i && same(a[i], a[i - 1]))
      continue;
    while (n >= 2 && turn(h[n - 2], h[n - 1], a[i]) <= 0)
      n--;
    h[n++] = a[i];
  }
  int lower = n;
  for (int i = 2; i >= 0; i--) {
    if (same(a[i], a[i + 1]))
      continue;
    while (n > lower && turn(h[n - 2], h[n - 1], a[i]) <= 0)
      n--;
    h[n++] = a[i];
  }
  if (n > 1)
    n--;
  if (n > 4)
    return -1;
  for (int i = 0; i < n; i++)
    out[i] = h[i];
  return n;
}
static bool convex(const P *p) {
  double scale = 0;
  for (int i = 1; i < 4; i++)
    scale = mx(scale, mx(ab(p[i].x - p[0].x), ab(p[i].y - p[0].y)));
  P chord = sub(p[3], p[0]);
  if (mx(ab(chord.x), ab(chord.y)) < scale * 1e-10)
    return false;
  int sign = 0;
  for (int i = 0; i < 4; i++) {
    double t = turn(p[i], p[(i + 1) % 4], p[(i + 2) % 4]);
    if (t) {
      int q = t > 0 ? 1 : -1;
      if (sign && q != sign)
        return false;
      sign = q;
    }
  }
  return sign != 0;
}
struct Sink {
  const SAAnalyticBudget *b;
  SAAnalyticPatch *patches;
  SAAnalyticVertex *vertices;
  SAAnalyticCounts counts;
  SAInkStatus error;
  const double *matrix;
  int orientation;
  P offset(P p) const {
    return {matrix[0] * p.x + matrix[2] * p.y,
            matrix[1] * p.x + matrix[3] * p.y};
  }
  void emit(const P *p, const P *poly, int n, uint32_t mode, int winding,
            float sign, const double f[3][3], uint32_t ci, double t0, double t1,
            const P *texture = nullptr) {
    if (error != SA_INK_OK)
      return;
    if (n < 3)
      return;
    uint32_t nv = (uint32_t)(n - 2) * 3;
    if (counts.patches >= b->max_patches ||
        counts.vertices > 0xffffffffu - nv) {
      error = SA_INK_RANGE;
      return;
    }
    SAAnalyticPatch patch = {};
    P origin = map(matrix, poly[0]);
    patch.origin[0] = origin.x;
    patch.origin[1] = origin.y;
    for (int i = 0; i < 4; i++) {
      P q = map(matrix, p[i]);
      patch.controls[2 * i] = q.x;
      patch.controls[2 * i + 1] = q.y;
    }
    patch.parameter_start = t0;
    patch.parameter_end = t1;
    patch.first_vertex = counts.vertices;
    patch.vertex_count = nv;
    patch.command_index = ci;
    patch.mode = mode;
    patch.winding = winding * orientation;
    patch.sign = sign;
    SAAnalyticVertex tmp[6];
    if (n > 4) {
      error = SA_INK_INVALID;
      return;
    }
    int v = 0;
    for (int i = 1; i < n - 1; i++)
      for (int j = 0; j < 3; j++) {
        P q = j == 0 ? poly[0] : j == 1 ? poly[i] : poly[i + 1];
        SAAnalyticVertex z = {};
        P delta = offset(sub(q, poly[0]));
        z.x = (float)delta.x;
        z.y = (float)delta.y;
        if (!fin(z.x) || !fin(z.y) || (delta.x != 0 && z.x == 0) ||
            (delta.y != 0 && z.y == 0)) {
          error = SA_INK_RANGE;
          return;
        }
        if (f) {
          P texturePoint = texture ? (j == 0   ? texture[0]
                                      : j == 1 ? texture[i]
                                               : texture[i + 1])
                                   : q;
          z.k = (float)(f[0][0] * texturePoint.x + f[0][1] * texturePoint.y +
                        f[0][2]);
          z.l = (float)(f[1][0] * texturePoint.x + f[1][1] * texturePoint.y +
                        f[1][2]);
          z.m = (float)(f[2][0] * texturePoint.x + f[2][1] * texturePoint.y +
                        f[2][2]);
          if (!fin(z.k) || !fin(z.l) || !fin(z.m)) {
            error = SA_INK_RANGE;
            return;
          }
        }
        tmp[v++] = z;
      }
    if (patches) {
      patches[counts.patches] = patch;
      for (uint32_t i = 0; i < nv; i++)
        vertices[counts.vertices + i] = tmp[i];
    }
    counts.patches++;
    counts.vertices += nv;
    if (mode == SA_ANALYTIC_RAY)
      counts.ray_patches++;
  }
  void solid(P anchor, P a, P z, uint32_t ci) {
    P p[4] = {a, a, z, z}, tri[3] = {anchor, a, z};
    double det = turn(anchor, a, z);
    if (!det)
      return;
    if (det < 0) {
      tri[1] = z;
      tri[2] = a;
    }
    emit(p, tri, 3, SA_ANALYTIC_SOLID, det > 0 ? 1 : -1, 1, nullptr, ci, 0, 1);
  }
  void ray(const P *p, uint32_t ci, double t0, double t1) {
    double x = p[0].x, y = p[0].y, X = x, Y = y;
    for (int i = 1; i < 4; i++) {
      x = mn(x, p[i].x);
      X = mx(X, p[i].x);
      y = mn(y, p[i].y);
      Y = mx(Y, p[i].y);
    }
    if (x == X || y == Y)
      return;
    P rect[4] = {{x, y}, {X, y}, {X, Y}, {x, Y}};
    emit(p, rect, 4, SA_ANALYTIC_RAY, 0, 1, nullptr, ci, t0, t1);
  }
  void cubic(P anchor, const P *p, uint32_t ci, double t0, double t1,
             uint32_t depth) {
    if (error != SA_INK_OK)
      return;
    P poly[4];
    int n = hull(p, poly);
    if (n < 0) {
      solid(anchor, p[0], p[3], ci);
      ray(p, ci, t0, t1);
      return;
    }
    if (n < 3) {
      solid(anchor, p[0], p[3], ci);
      return;
    }
    CurveData d;
    bool ready = data(p, d);
    if (!ready) {
      solid(anchor, p[0], p[3], ci);
      ray(p, ci, t0, t1);
      return;
    }
    if (d.kind == 1 && d.disc == 0) {
      double t = d.d2 / (2 * d.d1);
      if (t > 1e-8 && t < 1 - 1e-8) {
        if (depth >= b->max_depth) {
          solid(anchor, p[0], p[3], ci);
          ray(p, ci, t0, t1);
          return;
        }
        P l[4], r[4];
        split(p, t, l, r);
        double tm = t0 + (t1 - t0) * t;
        cubic(anchor, l, ci, t0, tm, depth + 1);
        cubic(anchor, r, ci, tm, t1, depth + 1);
        return;
      }
    }
    P normalized[4];
    double control_scale = 0;
    for (int i = 0; i < 4; i++) {
      normalized[i] = sub(p[i], p[0]);
      control_scale =
          mx(control_scale, mx(ab(normalized[i].x), ab(normalized[i].y)));
    }
    control_scale = power_scale(control_scale);
    for (int i = 0; i < 4; i++)
      normalized[i] = {normalized[i].x / control_scale,
                       normalized[i].y / control_scale};
    P ca =
          add(sub(normalized[3], mul(normalized[2], 3)), mul(normalized[1], 3)),
      cb = mul(sub(normalized[2], mul(normalized[1], 2)), 3),
      cc = mul(normalized[1], 3);
    double inflections[2];
    int ni =
        roots(3 * cross(cb, ca), 3 * cross(cc, ca), cross(cc, cb), inflections);
    for (int i = 0; i < ni; i++)
      if (inflections[i] > 1e-8 && inflections[i] < 1 - 1e-8) {
        if (depth >= b->max_depth) {
          solid(anchor, p[0], p[3], ci);
          ray(p, ci, t0, t1);
          return;
        }
        P l[4], r[4];
        split(p, inflections[i], l, r);
        double tm = t0 + (t1 - t0) * inflections[i];
        cubic(anchor, l, ci, t0, tm, depth + 1);
        cubic(anchor, r, ci, tm, t1, depth + 1);
        return;
      }
    if (ready && d.kind == 2) {
      double rr[2];
      int nr = roots(-d.d1 * d.d1, d.d1 * d.d2, d.d1 * d.d3 - d.d2 * d.d2, rr);
      for (int i = 0; i < nr; i++)
        if (rr[i] > 1e-10 && rr[i] < 1 - 1e-10) {
          if (depth >= b->max_depth) {
            // Near-degenerate loop roots may recur after binary64 splitting.
            // Preserve the actual remaining cubic lens, exactly as the bounded
            // inflection fallback above; exhausting classification depth is not
            // permission to drop a valid curve or force more subdivisions.
            solid(anchor, p[0], p[3], ci);
            ray(p, ci, t0, t1);
            return;
          }
          P l[4], r[4];
          split(p, rr[i], l, r);
          double tm = t0 + (t1 - t0) * rr[i];
          cubic(anchor, l, ci, t0, tm, depth + 1);
          cubic(anchor, r, ci, tm, t1, depth + 1);
          return;
        }
    }
    if (!convex(p)) {
      if (depth >= b->max_depth) {
        solid(anchor, p[0], p[3], ci);
        ray(p, ci, t0, t1);
        return;
      }
      P l[4], r[4];
      split(p, .5, l, r);
      double tm = (t0 + t1) * .5;
      cubic(anchor, l, ci, t0, tm, depth + 1);
      cubic(anchor, r, ci, tm, t1, depth + 1);
      return;
    }
    solid(anchor, p[0], p[3], ci);
    // Work in a local normalized frame to compute KLM. This also avoids losing
    // all low bits when the document has a very large world-space translation.
    P local[4];
    double scale = 0;
    for (int i = 0; i < 4; i++) {
      local[i] = sub(p[i], p[0]);
      scale = mx(scale, mx(ab(local[i].x), ab(local[i].y)));
    }
    scale = power_scale(scale);
    for (int i = 0; i < 4; i++)
      local[i] = {local[i].x / scale, local[i].y / scale};
    double f[3][3];
    if (!ready || !functionals(local, d, f)) {
      ray(p, ci, t0, t1);
      return;
    }
    P probe =
        mul(add(evaluate(local, .5), mul(add(local[0], local[3]), .5)), .5);
    double val = implicit(f, probe);
    if (!fin(val) || ab(val) < 1e-12) {
      ray(p, ci, t0, t1);
      return;
    }
    double side = turn(local[0], local[3], evaluate(local, .5));
    if (!side) {
      ray(p, ci, t0, t1);
      return;
    }
    // Texture functionals stay canonical; the emitter independently maps the
    // actual geometry. No temporary normalized geometry reaches
    // output/preflight.
    P localHull[4];
    for (int i = 0; i < n; i++) {
      P delta = sub(poly[i], p[0]);
      localHull[i] = {delta.x / scale, delta.y / scale};
    }
    emit(p, poly, n, SA_ANALYTIC_CUBIC, side > 0 ? -1 : 1, val > 0 ? 1 : -1, f,
         ci, t0, t1, localHull);
  }

  void quad(P anchor, P a, P q, P z, uint32_t ci) {
    P p[4] = {a, lerp(a, q, 2.0 / 3), lerp(z, q, 2.0 / 3), z};
    solid(anchor, a, z, ci);
    double side = turn(a, z, q);
    if (!side)
      return;
    P tri[3] = {a, q, z};
    SAAnalyticCounts before = counts;
    emit(p, tri, 3, SA_ANALYTIC_QUADRATIC, side > 0 ? -1 : 1, -1, nullptr, ci,
         0, 1);
    if (patches && counts.patches > before.patches) {
      SAAnalyticVertex *vtx = vertices + before.vertices;
      vtx[0].k = 0;
      vtx[0].l = 0;
      vtx[1].k = .5;
      vtx[1].l = 0;
      vtx[2].k = 1;
      vtx[2].l = 1;
    }
  }
};
// One parser drives sizing/build and the independent full path oracle.
static SAInkStatus walk(const SAInkPathCommand *commands, uint32_t count,
                        const double *m, Sink *s, double x, double y, int *w,
                        bool *boundary, uint32_t command_limit = 100000) {
  if ((count && !commands) || count > command_limit || !affine_valid(m))
    return SA_INK_INVALID;
  if (affine_orientation(m) == 0) {
    s = nullptr;
    w = nullptr;
    boundary = nullptr;
  }
  const double *world = m;
  const double identity[6] = {1, 0, 0, 1, 0, 0};
  if (s)
    m = identity;
  P at = {}, start = {};
  bool open = false, has_move = false;
  for (uint32_t i = 0; i <= count; i++) {
    uint32_t op = i < count ? commands[i].operation : SA_INK_MOVE;
    if (i < count) {
      const SAInkPathCommand &c = commands[i];
      if (op > SA_INK_CLOSE || c.reserved)
        return SA_INK_INVALID;
      int n = op == SA_INK_MOVE || op == SA_INK_LINE ? 2
              : op == SA_INK_QUAD                    ? 4
              : op == SA_INK_CUBIC                   ? 6
                                                     : 0;
      for (int j = 0; j < n; j++)
        if (!fin(c.values[j]))
          return SA_INK_INVALID;
      for (int j = 0; j < n; j += 2) {
        P q = map(world, {c.values[j], c.values[j + 1]});
        if (!fin(q.x) || !fin(q.y) || ab(q.x) > 1e150 || ab(q.y) > 1e150)
          return SA_INK_RANGE;
      }
    }
    if ((op == SA_INK_MOVE || op == SA_INK_CLOSE) && open) {
      if (s)
        s->solid(start, at, start, i < count ? i : count);
      if (w)
        *w += line_winding(at, start, x, y, *boundary);
      at = start;
      open = false;
    }
    if (i == count)
      break;
    const double *v = commands[i].values;
    if (op == SA_INK_MOVE) {
      at = start = map(m, {v[0], v[1]});
      if (!fin(at.x) || !fin(at.y) || ab(at.x) > 1e150 || ab(at.y) > 1e150)
        return SA_INK_RANGE;
      open = true;
      has_move = true;
      continue;
    }
    if (op == SA_INK_CLOSE) {
      if (!has_move)
        return SA_INK_INVALID;
      continue;
    }
    if (!open) {
      if (!has_move)
        return SA_INK_INVALID;
      open = true;
    }
    P p[4], quad = {};
    p[0] = at;
    if (op == SA_INK_LINE) {
      p[3] = map(m, {v[0], v[1]});
      p[1] = p[0];
      p[2] = p[3];
    } else if (op == SA_INK_QUAD) {
      P q = map(m, {v[0], v[1]});
      quad = q;
      p[3] = map(m, {v[2], v[3]});
      p[1] = lerp(at, q, 2.0 / 3);
      p[2] = lerp(p[3], q, 2.0 / 3);
      if (!valid_points(p))
        return SA_INK_RANGE;
      if (s)
        s->quad(start, at, q, p[3], i);
    } else {
      p[1] = map(m, {v[0], v[1]});
      p[2] = map(m, {v[2], v[3]});
      p[3] = map(m, {v[4], v[5]});
      if (s && valid_points(p))
        s->cubic(start, p, i, 0, 1, 0);
    }
    if (!valid_points(p))
      return SA_INK_RANGE;
    if (s && op == SA_INK_LINE)
      s->solid(start, at, p[3], i);
    if (w)
      *w += op == SA_INK_LINE   ? line_winding(at, p[3], x, y, *boundary)
            : op == SA_INK_QUAD ? quad_winding(at, quad, p[3], x, y, *boundary)
                                : curve_winding(p, x, y, *boundary);
    at = p[3];
    if (s && s->error != SA_INK_OK)
      return s->error;
  }
  return SA_INK_OK;
}
static bool budget_valid(const SAAnalyticBudget *b, uint32_t n) {
  return b && b->max_commands > 0 && n <= b->max_commands &&
         b->max_commands <= 100000 && b->max_patches > 0 &&
         b->max_patches <= 10000000 && b->max_depth > 0 && b->max_depth <= 24 &&
         b->reserved == 0;
}
static bool overlap(const void *a, uint64_t an, const void *b, uint64_t bn) {
  if (!an || !bn)
    return false;
  uintptr_t x = (uintptr_t)a, y = (uintptr_t)b;
  return x <= y ? y - x < an : x - y < bn;
}
static void hit(int w, bool boundary, uint32_t fill, SAAnalyticHit *out) {
  *out = {w, (uint32_t)(fill == SA_ANALYTIC_EVENODD ? (w % 2 != 0) : (w != 0)),
          (uint32_t)boundary, 0};
}
static int triangle(const SAAnalyticVertex *a, double x, double y, double *bary,
                    bool &boundary) {
  double dx1 = (double)a[1].x - a[0].x, dy1 = (double)a[1].y - a[0].y,
         dx2 = (double)a[2].x - a[0].x, dy2 = (double)a[2].y - a[0].y;
  double det = dx1 * dy2 - dy1 * dx2;
  if (!det)
    return 0;
  double dx = x - a[0].x, dy = y - a[0].y, u = (dx * dy2 - dy * dx2) / det,
         v = (dx1 * dy - dy1 * dx) / det;
  double z = 1 - u - v;
  if (u < 0 || v < 0 || z < 0)
    return 0;
  double vals[3] = {z, u, v};
  for (int i = 0; i < 3; i++)
    if (vals[i] == 0) {
      boundary = true;
      const auto &A = a[(i + 1) % 3];
      const auto &B = a[(i + 2) % 3];
      double ex = B.x - A.x, ey = B.y - A.y;
      if (det < 0) {
        ex = -ex;
        ey = -ey;
      }
      if (!(ey > 0 || (ey == 0 && ex < 0)))
        return 0;
    }
  bary[0] = z;
  bary[1] = u;
  bary[2] = v;
  return 1;
}
} // namespace
extern "C" {
uint32_t sa_analytic_abi_version() { return SA_ANALYTIC_ABI_VERSION; }
uint32_t sa_analytic_sizeof_patch() { return sizeof(SAAnalyticPatch); }
uint32_t sa_analytic_sizeof_vertex() { return sizeof(SAAnalyticVertex); }
SAInkStatus sa_analytic_path_counts(const SAInkPathCommand *c, uint32_t n,
                                    const double *m, const SAAnalyticBudget *b,
                                    SAAnalyticCounts *out) {
  if (!out || !budget_valid(b, n) || !affine_valid(m) ||
      overlap(out, sizeof(*out), c, (uint64_t)n * sizeof(*c)) ||
      overlap(out, sizeof(*out), m, 48) ||
      overlap(out, sizeof(*out), b, sizeof(*b)))
    return SA_INK_INVALID;
  Sink s = {b, nullptr, nullptr, {}, SA_INK_OK, m, affine_orientation(m)};
  auto status = walk(c, n, m, &s, 0, 0, nullptr, nullptr);
  if (status == SA_INK_OK)
    *out = s.counts;
  return status;
}
SAInkStatus sa_analytic_path_build(const SAInkPathCommand *c, uint32_t n,
                                   const double *m, const SAAnalyticBudget *b,
                                   SAAnalyticPatch *p, uint32_t pc,
                                   SAAnalyticVertex *v, uint32_t vc,
                                   SAAnalyticCounts *out) {
  SAAnalyticCounts required;
  auto status = sa_analytic_path_counts(c, n, m, b, &required);
  if (status != SA_INK_OK)
    return status;
  if (!out || (required.patches && !p) || (required.vertices && !v) ||
      pc < required.patches || vc < required.vertices)
    return SA_INK_CAPACITY;
  uint64_t pn = (uint64_t)required.patches * sizeof(*p),
           vn = (uint64_t)required.vertices * sizeof(*v),
           cn = (uint64_t)n * sizeof(*c);
  if (overlap(p, pn, v, vn) || overlap(p, pn, c, cn) || overlap(v, vn, c, cn) ||
      overlap(p, pn, m, 48) || overlap(v, vn, m, 48) ||
      overlap(p, pn, b, sizeof(*b)) || overlap(v, vn, b, sizeof(*b)) ||
      overlap(out, sizeof(*out), p, pn) || overlap(out, sizeof(*out), v, vn) ||
      overlap(out, sizeof(*out), c, cn) || overlap(out, sizeof(*out), m, 48) ||
      overlap(out, sizeof(*out), b, sizeof(*b)))
    return SA_INK_INVALID;
  Sink s = {b, p, v, {}, SA_INK_OK, m, affine_orientation(m)};
  status = walk(c, n, m, &s, 0, 0, nullptr, nullptr);
  if (status == SA_INK_OK)
    *out = s.counts;
  return status;
}
SAInkStatus sa_analytic_bezier_evaluate(const double *c, uint32_t degree,
                                        double t, SAInkPoint *out,
                                        SAInkPoint *derivative) {
  if (!c || !out || !derivative || degree < 1 || degree > 3 || !fin(t) ||
      t < 0 || t > 1)
    return SA_INK_INVALID;
  P p[4];
  for (uint32_t i = 0; i <= degree; i++) {
    p[i] = {c[2 * i], c[2 * i + 1]};
    if (!fin(p[i].x) || !fin(p[i].y) || ab(p[i].x) > 1e150 ||
        ab(p[i].y) > 1e150)
      return SA_INK_INVALID;
  }
  P d[3];
  for (uint32_t i = 0; i < degree; i++)
    d[i] = mul(sub(p[i + 1], p[i]), degree);
  for (uint32_t k = degree; k > 0; k--)
    for (uint32_t i = 0; i < k; i++)
      p[i] = lerp(p[i], p[i + 1], t);
  for (uint32_t k = degree - 1; k > 0; k--)
    for (uint32_t i = 0; i < k; i++)
      d[i] = lerp(d[i], d[i + 1], t);
  *out = p[0];
  *derivative = d[0];
  return SA_INK_OK;
}
SAInkStatus sa_analytic_curve_evaluate(const double *c, double t,
                                       SAInkPoint *out,
                                       SAInkPoint *derivative) {
  if (!c || !out || !derivative || !fin(t) || t < 0 || t > 1)
    return SA_INK_INVALID;
  P p[4];
  for (int i = 0; i < 4; i++)
    p[i] = {c[2 * i], c[2 * i + 1]};
  if (!valid_points(p))
    return SA_INK_INVALID;
  P a = sub(p[1], p[0]), b = sub(p[2], p[1]), d = sub(p[3], p[2]);
  *out = evaluate(p, t);
  *derivative = mul(lerp(lerp(a, b, t), lerp(b, d, t), t), 3);
  return SA_INK_OK;
}
SAInkStatus sa_analytic_implicit_evaluate(uint32_t mode, float sign,
                                          const double *k, const double *dx,
                                          const double *dy,
                                          SAAnalyticEvaluation *out) {
  if (!k || !dx || !dy || !out ||
      (mode != SA_ANALYTIC_QUADRATIC && mode != SA_ANALYTIC_CUBIC) ||
      (sign != 1 && sign != -1))
    return SA_INK_INVALID;
  for (int i = 0; i < 3; i++)
    if (!fin(k[i]) || !fin(dx[i]) || !fin(dy[i]))
      return SA_INK_INVALID;
  SAAnalyticEvaluation e = {};
  if (mode == SA_ANALYTIC_QUADRATIC) {
    e.value = k[0] * k[0] - k[1];
    e.dx = 2 * k[0] * dx[0] - dx[1];
    e.dy = 2 * k[0] * dy[0] - dy[1];
  } else {
    e.value = k[0] * k[0] * k[0] - k[1] * k[2];
    e.dx = 3 * k[0] * k[0] * dx[0] - k[2] * dx[1] - k[1] * dx[2];
    e.dy = 3 * k[0] * k[0] * dy[0] - k[2] * dy[1] - k[1] * dy[2];
  }
  if (!fin(e.value) || !fin(e.dx) || !fin(e.dy))
    return SA_INK_RANGE;
  double scale = mx(ab(e.dx), ab(e.dy)),
         gradient =
             scale ? scale * __builtin_sqrt((e.dx / scale) * (e.dx / scale) +
                                            (e.dy / scale) * (e.dy / scale))
                   : 0;
  e.coverage = gradient       ? mn(1, mx(0, .5 + sign * e.value / gradient))
               : e.value == 0 ? .5
               : sign * e.value > 0 ? 1
                                    : 0;
  *out = e;
  return SA_INK_OK;
}
SAInkStatus sa_analytic_path_winding(const SAInkPathCommand *c, uint32_t n,
                                     const double *m, double x, double y,
                                     uint32_t fill, SAAnalyticHit *out) {
  if (!out || !fin(x) || !fin(y) || fill > 1)
    return SA_INK_INVALID;
  int w = 0;
  bool boundary = false;
  auto status = walk(c, n, m, nullptr, x, y, &w, &boundary);
  if (status == SA_INK_OK)
    hit(w, boundary, fill, out);
  return status;
}
SAInkStatus sa_analytic_path_winding_extended(const SAInkPathCommand *c,
                                              uint32_t n, const double *m,
                                              double x, double y, uint32_t fill,
                                              uint32_t max_commands,
                                              SAAnalyticHit *out) {
  auto span = [](const void *p, uint64_t bytes) {
    return !bytes || (p && bytes <= UINTPTR_MAX - (uintptr_t)p);
  };
  const uint64_t bytes = uint64_t(n) * sizeof(*c);
  if (!max_commands || max_commands > 4000000 || n > max_commands ||
      !span(c, bytes) || (n && (uintptr_t)c % 8) || !span(m, 48) ||
      (uintptr_t)m % 8 || !span(out, sizeof(*out)) || (uintptr_t)out % 4 ||
      !fin(x) || !fin(y) || fill > 1 || overlap(out, sizeof(*out), c, bytes) ||
      overlap(out, sizeof(*out), m, 48))
    return SA_INK_INVALID;
  int winding = 0;
  bool boundary = false;
  auto status = walk(c, n, m, nullptr, x, y, &winding, &boundary, max_commands);
  if (status == SA_INK_OK)
    hit(winding, boundary, fill, out);
  return status;
}
SAInkStatus sa_analytic_patch_winding(const SAAnalyticPatch *p,
                                      const SAAnalyticVertex *v, uint32_t n,
                                      double x, double y, SAAnalyticHit *out) {
  if (!p || !out || !fin(x) || !fin(y) || p->mode > SA_ANALYTIC_RAY ||
      p->first_vertex > n || p->vertex_count > n - p->first_vertex ||
      p->vertex_count % 3 || (!v && p->vertex_count))
    return SA_INK_INVALID;
  if (!fin(p->origin[0]) || !fin(p->origin[1]) || !fin(p->parameter_start) ||
      !fin(p->parameter_end) || p->parameter_start < 0 ||
      p->parameter_end > 1 || p->parameter_start > p->parameter_end ||
      p->winding < -1 || p->winding > 1 || (p->sign != 1 && p->sign != -1))
    return SA_INK_INVALID;
  for (uint32_t i = 0; i < p->vertex_count; i++) {
    const auto &q = v[p->first_vertex + i];
    if (!fin(q.x) || !fin(q.y) || !fin(q.k) || !fin(q.l) || !fin(q.m))
      return SA_INK_INVALID;
  }
  bool boundary = false;
  int w = 0;
  if (p->mode == SA_ANALYTIC_RAY) {
    P q[4];
    for (int i = 0; i < 4; i++)
      q[i] = {p->controls[i * 2], p->controls[i * 2 + 1]};
    if (!valid_points(q))
      return SA_INK_INVALID;
    w = curve_winding(q, x, y, boundary) +
        line_winding(q[3], q[0], x, y, boundary);
  } else {
    double px = x - p->origin[0], py = y - p->origin[1];
    for (uint32_t i = 0; i < p->vertex_count; i += 3) {
      const auto *a = v + p->first_vertex + i;
      double b[3];
      if (!triangle(a, px, py, b, boundary))
        continue;
      double k = 0, l = 0, m = 0;
      for (int j = 0; j < 3; j++) {
        k += b[j] * a[j].k;
        l += b[j] * a[j].l;
        m += b[j] * a[j].m;
      }
      double f =
          p->mode == SA_ANALYTIC_QUADRATIC ? k * k - l : k * k * k - l * m;
      if (p->mode != SA_ANALYTIC_SOLID && f == 0)
        boundary = true;
      if (p->mode == SA_ANALYTIC_SOLID || p->sign * f >= 0)
        w += p->winding;
    }
  }
  hit(w, boundary, SA_ANALYTIC_NONZERO, out);
  return SA_INK_OK;
}
SAInkStatus sa_analytic_mesh_winding(const SAAnalyticPatch *p, uint32_t pn,
                                     const SAAnalyticVertex *v, uint32_t vn,
                                     double x, double y, uint32_t fill,
                                     SAAnalyticHit *out) {
  if (!out || (pn && !p) || fill > 1 || !fin(x) || !fin(y) || pn > 10000000)
    return SA_INK_INVALID;
  int w = 0;
  bool boundary = false;
  for (uint32_t i = 0; i < pn; i++) {
    SAAnalyticHit q;
    auto s = sa_analytic_patch_winding(p + i, v, vn, x, y, &q);
    if (s != SA_INK_OK)
      return s;
    w += q.winding;
    boundary = boundary || q.boundary;
  }
  hit(w, boundary, fill, out);
  return SA_INK_OK;
}
}
