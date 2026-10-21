#include "include/ink-stroke-kernel.h"

// Independent circular-sweep mathematics, not recovered vendor implementation.
// Formula and singular cases:
// https://luthert.web.illinois.edu/blog/posts/775.html Endpoint Hermite
// interpolation is ordinary cubic polynomial interpolation. For circular arcs
// its coordinate remainder is <= r*angle^4/384, hence the Euclidean bound
// sqrt(2)*r*angle^4/384 (plus conservative binary64 allowance).
namespace {
constexpr double PI = 3.1415926535897932384626433832795, TAU = 2 * PI;
constexpr double SQRT2 = 1.4142135623730950488;
struct V {
  double x, y;
};
struct Curve {
  V p[4];
  double r0, r1;
  uint32_t degree;
};
struct Envelope {
  V p, d;
};
struct Run {
  const SAInkStrokeOptions &o;
  SAInkStrokeResult result{};
  SAInkPathCommand *output;
  SAInkStatus status = SA_INK_OK;
  bool pending_fallback = false;
  Curve pending{};
};
static double abs(double v) { return v < 0 ? -v : v; }
static double max(double a, double b) { return a > b ? a : b; }
static double min(double a, double b) { return a < b ? a : b; }
static bool finite(double x) { return __builtin_isfinite(x); }
static V add(V a, V b) { return {a.x + b.x, a.y + b.y}; }
static V sub(V a, V b) { return {a.x - b.x, a.y - b.y}; }
static V mul(V a, double b) { return {a.x * b, a.y * b}; }
static double dot(V a, V b) { return a.x * b.x + a.y * b.y; }
static V turn(V a) { return {a.y, -a.x}; }
static double norm(V a) { return __builtin_sqrt(dot(a, a)); }
static V mix(V a, V b, double t) { return add(mul(a, 1 - t), mul(b, t)); }
// Shared fixed-order elementary math avoids host libm/native-Wasm differences.
static void trig(double x, double &s, double &c) {
  while (x > PI)
    x -= TAU;
  while (x < -PI)
    x += TAU;
  double sign = 1;
  if (x > PI / 2) {
    x -= PI;
    sign = -1;
  } else if (x < -PI / 2) {
    x += PI;
    sign = -1;
  }
  double z = x * x, st = x, ct = 1;
  s = st;
  c = ct;
  for (uint32_t i = 1; i <= 15; i++) {
    st *= -z / ((2.0 * i) * (2.0 * i + 1));
    ct *= -z / ((2.0 * i - 1) * (2.0 * i));
    s += st;
    c += ct;
  }
  s *= sign;
  c *= sign;
}
static double atanUnit(double x) {
  bool reciprocal = x > 1;
  if (reciprocal)
    x = 1 / x;
  bool shift = x > 0.4142135623730950488;
  if (shift)
    x = (x - 1) / (x + 1);
  double z = x * x, term = x, a = x;
  for (uint32_t i = 1; i < 32; i++) {
    term *= -z;
    a += term / (2.0 * i + 1);
  }
  if (shift)
    a += PI / 4;
  return reciprocal ? PI / 2 - a : a;
}
static double angle(V p) {
  if (!p.x)
    return p.y > 0 ? PI / 2 : p.y < 0 ? -PI / 2 : 0;
  double a = atanUnit(abs(p.y / p.x));
  if (p.x < 0)
    a = PI - a;
  return p.y < 0 ? -a : a;
}
static V value(const Curve &c, double t) {
  V a[4];
  for (uint32_t i = 0; i <= c.degree; i++)
    a[i] = c.p[i];
  for (uint32_t n = c.degree; n; n--)
    for (uint32_t i = 0; i < n; i++)
      a[i] = mix(a[i], a[i + 1], t);
  return a[0];
}
static V derivative(const Curve &c, double t) {
  if (!c.degree)
    return {0, 0};
  V a[3];
  for (uint32_t i = 0; i < c.degree; i++)
    a[i] = mul(sub(c.p[i + 1], c.p[i]), c.degree);
  for (uint32_t n = c.degree - 1; n; n--)
    for (uint32_t i = 0; i < n; i++)
      a[i] = mix(a[i], a[i + 1], t);
  return a[0];
}
static V second(const Curve &c, double t) {
  if (c.degree < 2)
    return {0, 0};
  V a[2];
  for (uint32_t i = 0; i < c.degree - 1; i++)
    a[i] = mul(add(sub(c.p[i + 2], mul(c.p[i + 1], 2)), c.p[i]),
               c.degree * (c.degree - 1));
  return c.degree == 3 ? mix(a[0], a[1], t) : a[0];
}
static void split(const Curve &c, Curve &a, Curve &b) {
  a = c;
  b = c;
  V p[4];
  for (uint32_t i = 0; i <= c.degree; i++)
    p[i] = c.p[i];
  for (uint32_t n = c.degree; n; n--) {
    for (uint32_t i = 0; i < n; i++)
      p[i] = mix(p[i], p[i + 1], .5);
    a.p[c.degree - n + 1] = p[0];
    b.p[n - 1] = p[n - 1];
  }
  a.r1 = b.r0 = (c.r0 + c.r1) * .5;
}
static double chordBound(const Curve &c) {
  double bound = 0;
  for (uint32_t i = 1; i < c.degree; i++)
    bound = max(bound, norm(sub(c.p[i], mix(c.p[0], c.p[c.degree],
                                            double(i) / c.degree))));
  return bound;
}
static Envelope envelope(const Curve &c, double t, double side) {
  V v = derivative(c, t), a = second(c, t), p = value(c, t);
  double q = c.r1 - c.r0, s = dot(v, v), ds = 2 * dot(v, a),
         z = __builtin_sqrt(s - q * q);
  V n = add(mul(v, -q), mul(turn(v), side * z));
  V dn = add(mul(a, -q),
             add(mul(turn(v), side * ds / (2 * z)), mul(turn(a), side * z)));
  V u = mul(n, 1 / s), du = mul(sub(mul(dn, s), mul(n, ds)), 1 / (s * s));
  double r = c.r0 + (c.r1 - c.r0) * t;
  return {add(p, mul(u, r)), add(v, add(mul(u, q), mul(du, r)))};
}
// A second, sufficient regularity certificate works on the exact polynomial
// inputs, not sampled envelope points. Let s=|c'|^2, D=c'.c'', C=c' cross c'',
// q=r' (constant on this authored element), and B=s^2-q^2*s+r*q*D. Direct
// differentiation gives s*(E'_+/- . c')=B +/- r*sqrt(s-q^2)*C. Thus strict
// positivity of S=s-q^2, B and P=B^2-r^2*S*C^2 proves forward progress of BOTH
// envelopes. At q=0 this reduces to s>0 and s^3-r^2*C^2>0: tangential center
// acceleration cancels exactly, instead of being mistaken for curvature.
//
// Every scalar operation is enclosed by adjacent binary64 values. Positive
// Bernstein lower bounds prove positivity over the WHOLE parameter interval.
// Bounded midpoint subdivision only tightens the certificate; an uncertain,
// singular, nonfinite or exhausted certificate takes the existing fallback.
// No allocator, libm nextafter, sampled acceptance, radius-knot removal or
// change to the envelope fitting/arc tolerances is involved.
struct ProgressInterval {
  double lo, hi;
};
struct ProgressPolynomial {
  ProgressInterval a[17]{};
  uint32_t degree = 0;
};
static double progressStep(double x, bool up) {
  static_assert(sizeof(double) == 8 && sizeof(uint64_t) == 8,
                "binary64 interval arithmetic");
  if (!finite(x))
    return x;
  uint64_t bits;
  __builtin_memcpy(&bits, &x, sizeof(bits));
  if (x == 0) {
    bits = up ? uint64_t(1) : (uint64_t(1) << 63) | 1;
  } else if ((x > 0) == up) {
    ++bits;
  } else {
    --bits;
  }
  double result;
  __builtin_memcpy(&result, &bits, sizeof(result));
  return result;
}
static ProgressInterval progressPoint(double x) { return {x, x}; }
static bool progressZero(ProgressInterval a) { return a.lo == 0 && a.hi == 0; }
static ProgressInterval progressAdd(ProgressInterval a, ProgressInterval b) {
  if (progressZero(a))
    return b;
  if (progressZero(b))
    return a;
  return {progressStep(a.lo + b.lo, false), progressStep(a.hi + b.hi, true)};
}
static ProgressInterval progressNegate(ProgressInterval a) {
  return {-a.hi, -a.lo};
}
static ProgressInterval progressMultiply(ProgressInterval a,
                                         ProgressInterval b) {
  if (progressZero(a) || progressZero(b))
    return {0, 0};
  double v[4] = {a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi};
  double lo = v[0], hi = v[0];
  for (uint32_t i = 1; i < 4; i++) {
    lo = min(lo, v[i]);
    hi = max(hi, v[i]);
  }
  return {progressStep(lo, false), progressStep(hi, true)};
}
static ProgressPolynomial progressConstant(ProgressInterval a) {
  ProgressPolynomial p{};
  p.a[0] = a;
  return p;
}
static ProgressPolynomial progressScale(const ProgressPolynomial &p,
                                        ProgressInterval a) {
  ProgressPolynomial q{};
  q.degree = p.degree;
  for (uint32_t i = 0; i <= p.degree; i++)
    q.a[i] = progressMultiply(p.a[i], a);
  return q;
}
static ProgressPolynomial progressSum(const ProgressPolynomial &a,
                                      const ProgressPolynomial &b,
                                      bool subtract = false) {
  ProgressPolynomial q{};
  q.degree = a.degree > b.degree ? a.degree : b.degree;
  for (uint32_t i = 0; i <= q.degree; i++) {
    ProgressInterval x = i <= a.degree ? a.a[i] : progressPoint(0),
                     y = i <= b.degree ? b.a[i] : progressPoint(0);
    q.a[i] = progressAdd(x, subtract ? progressNegate(y) : y);
  }
  return q;
}
static ProgressPolynomial progressProduct(const ProgressPolynomial &a,
                                          const ProgressPolynomial &b) {
  ProgressPolynomial q{};
  q.degree = a.degree + b.degree;
  for (uint32_t i = 0; i <= a.degree; i++)
    for (uint32_t j = 0; j <= b.degree; j++)
      q.a[i + j] = progressAdd(q.a[i + j], progressMultiply(a.a[i], b.a[j]));
  return q;
}
static ProgressPolynomial progressDerivative(const ProgressPolynomial &p) {
  ProgressPolynomial q{};
  q.degree = p.degree ? p.degree - 1 : 0;
  for (uint32_t i = 1; i <= p.degree; i++)
    q.a[i - 1] = progressMultiply(p.a[i], progressPoint(i));
  return q;
}
static ProgressPolynomial progressVelocity(const Curve &c, bool y) {
  ProgressInterval d[3]{};
  for (uint32_t i = 0; i < c.degree; i++)
    d[i] = progressAdd(progressPoint(y ? c.p[i + 1].y : c.p[i + 1].x),
                       progressPoint(-(y ? c.p[i].y : c.p[i].x)));
  ProgressPolynomial v{};
  v.degree = c.degree - 1;
  v.a[0] = progressMultiply(d[0], progressPoint(c.degree));
  if (c.degree >= 2)
    v.a[1] = progressMultiply(progressAdd(d[1], progressNegate(d[0])),
                              progressPoint(c.degree == 3 ? 6 : 2));
  if (c.degree == 3)
    v.a[2] = progressMultiply(
        progressAdd(
            progressAdd(d[2], progressMultiply(d[1], progressPoint(-2))), d[0]),
        progressPoint(3));
  return v;
}
static uint32_t progressBinomial(uint32_t n, uint32_t k) {
  if (k > n - k)
    k = n - k;
  uint32_t result = 1;
  for (uint32_t i = 1; i <= k; i++)
    result = result * (n - i + 1) / i;
  return result;
}
static bool progressPositive(const ProgressInterval *a, uint32_t degree,
                             uint32_t depth, uint32_t &budget) {
  if (!budget)
    return false;
  --budget;
  bool positive = true;
  for (uint32_t i = 0; i <= degree; i++) {
    if (!finite(a[i].lo) || !finite(a[i].hi))
      return false;
    if (!(a[i].lo > 0))
      positive = false;
  }
  if (positive)
    return true;
  if (depth == 8 || a[0].hi <= 0 || a[degree].hi <= 0)
    return false;
  ProgressInterval p[17], left[17], right[17];
  for (uint32_t i = 0; i <= degree; i++)
    p[i] = a[i];
  left[0] = p[0];
  right[degree] = p[degree];
  for (uint32_t n = degree; n; n--) {
    for (uint32_t i = 0; i < n; i++)
      p[i] = progressMultiply(progressAdd(p[i], p[i + 1]), progressPoint(.5));
    left[degree - n + 1] = p[0];
    right[n - 1] = p[n - 1];
  }
  return progressPositive(left, degree, depth + 1, budget) &&
         progressPositive(right, degree, depth + 1, budget);
}
static bool progressCertificate(const ProgressPolynomial &p, uint32_t &budget) {
  ProgressInterval b[17]{};
  for (uint32_t k = 0; k <= p.degree; k++)
    for (uint32_t i = 0; i <= k; i++) {
      uint32_t numerator = progressBinomial(k, i),
               denominator = progressBinomial(p.degree, i);
      double ratio = double(numerator) / denominator;
      ProgressInterval weight =
          numerator == denominator
              ? progressPoint(1)
              : ProgressInterval{progressStep(ratio, false),
                                 progressStep(ratio, true)};
      b[k] = progressAdd(b[k], progressMultiply(p.a[i], weight));
    }
  return progressPositive(b, p.degree, 0, budget);
}
static bool certifiedProgress(const Curve &c) {
  if (!c.degree)
    return false;
  auto vx = progressVelocity(c, false), vy = progressVelocity(c, true);
  auto ax = progressDerivative(vx), ay = progressDerivative(vy);
  auto s = progressSum(progressProduct(vx, vx), progressProduct(vy, vy));
  auto cross =
      progressSum(progressProduct(vx, ay), progressProduct(vy, ax), true);
  ProgressInterval q = progressAdd(progressPoint(c.r1), progressPoint(-c.r0));
  uint32_t budget = 64;
  if (c.r0 == c.r1) {
    if (!progressCertificate(s, budget))
      return false;
    auto p = progressSum(progressProduct(progressProduct(s, s), s),
                         progressScale(progressProduct(cross, cross),
                                       progressMultiply(progressPoint(c.r0),
                                                        progressPoint(c.r0))),
                         true);
    return progressCertificate(p, budget);
  }
  auto S = progressSum(s, progressConstant(progressMultiply(q, q)), true);
  if (!progressCertificate(S, budget))
    return false;
  ProgressPolynomial radius{};
  radius.degree = 1;
  radius.a[0] = progressPoint(c.r0);
  radius.a[1] = q;
  auto dotProduct =
      progressSum(progressProduct(vx, ax), progressProduct(vy, ay));
  auto B =
      progressSum(progressSum(progressProduct(s, s),
                              progressScale(s, progressMultiply(q, q)), true),
                  progressScale(progressProduct(radius, dotProduct), q));
  if (!progressCertificate(B, budget))
    return false;
  auto P = progressSum(
      progressProduct(B, B),
      progressProduct(progressProduct(progressProduct(radius, radius), S),
                      progressProduct(cross, cross)),
      true);
  return progressCertificate(P, budget);
}
// Convex-hull derivative bounds certify positive progress of both envelope
// sides. This excludes local folded ribbons, not merely zero sqrt arguments.
// A failed certificate subdivides, or selects the explicit disk-union fallback.
static bool regular(const Curve &c) {
  if (!c.degree)
    return false;
  V chord = sub(c.p[c.degree], c.p[0]);
  double length = norm(chord);
  if (!length)
    return false;
  V axis = mul(chord, 1 / length);
  double h = 1e100, A = 0;
  for (uint32_t i = 0; i < c.degree; i++)
    h = min(h, dot(mul(sub(c.p[i + 1], c.p[i]), c.degree), axis));
  if (!(h > 0))
    return false;
  for (uint32_t i = 0; i + 1 < c.degree; i++)
    A = max(A, norm(mul(add(sub(c.p[i + 2], mul(c.p[i + 1], 2)), c.p[i]),
                        c.degree * (c.degree - 1))));
  double q = abs(c.r1 - c.r0);
  if (!(h > q * 1.000001))
    return false;
  double beta = __builtin_sqrt(1 - (q / h) * (q / h));
  double up = q * A / (h * h) * (1 + q / (h * beta)) + 2 * A / h;
  if (q + max(c.r0, c.r1) * up < h * .9)
    return true;
  return certifiedProgress(c);
}
static bool leaf(Run &r, uint32_t depth) {
  r.result.maximum_depth =
      depth > r.result.maximum_depth ? depth : r.result.maximum_depth;
  if (r.result.leaves >= r.o.max_leaves) {
    r.status = SA_INK_CAPACITY;
    return false;
  }
  ++r.result.leaves;
  return true;
}
static void command(Run &r, uint32_t op, V a = {0, 0}, V b = {0, 0},
                    V c = {0, 0}) {
  if (r.status != SA_INK_OK)
    return;
  if (r.result.commands >= r.o.max_commands) {
    r.status = SA_INK_CAPACITY;
    return;
  }
  if (!finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y) ||
      !finite(c.x) || !finite(c.y)) {
    r.status = SA_INK_RANGE;
    return;
  }
  if (r.output)
    r.output[r.result.commands] = {op, 0, {a.x, a.y, b.x, b.y, c.x, c.y}};
  ++r.result.commands;
}
// Counterclockwise circular arc. Its angular Hermite error is bounded
// independently of the sampled envelope error. No argument-spread/host trig.
static void arc(Run &r, V center, double radius, V start, V end,
                bool full = false) {
  if (radius == 0)
    return;
  double first = angle(sub(start, center)), last = angle(sub(end, center)),
         span = last - first;
  if (full)
    span = TAU;
  else {
    while (span < 0)
      span += TAU;
    while (span >= TAU)
      span -= TAU;
  }
  if (!span)
    return;
  uint32_t pieces = 1;
  double allowance = r.o.tolerance * .25;
  while (true) {
    double h = span / pieces,
           bound = SQRT2 * radius * h * h * h * h / 384 +
                   64 * 2.220446049250313e-16 * (1 + norm(center) + radius);
    if (h <= PI / 2 && bound <= allowance) {
      r.result.arc_error_bound = max(r.result.arc_error_bound, bound);
      break;
    }
    if (pieces > r.o.max_commands / 2) {
      r.status = SA_INK_CAPACITY;
      return;
    }
    pieces *= 2;
  }
  V p = start;
  for (uint32_t i = 0; i < pieces; i++) {
    double h = span / pieces, a = first + h * i, b = a + h, sa, ca, sb, cb;
    trig(a, sa, ca);
    trig(b, sb, cb);
    V q = i + 1 == pieces ? end : add(center, mul({cb, sb}, radius));
    command(r, SA_INK_CUBIC, add(p, mul({-sa, ca}, radius * h / 3)),
            sub(q, mul({-sb, cb}, radius * h / 3)), q);
    p = q;
  }
}
static void disk(Run &r, V p, double radius) {
  if (radius == 0)
    return;
  V start = add(p, {radius, 0});
  command(r, SA_INK_MOVE, start);
  arc(r, p, radius, start, start, true);
  command(r, SA_INK_CLOSE);
  ++r.result.contours;
}
static void emitHull(Run &r, const Curve &c) {
  uint32_t contours = r.result.contours;
  V a = c.p[0], b = c.p[c.degree], d = sub(b, a);
  double length = norm(d), dr = c.r1 - c.r0;
  if (length <= abs(dr) || !length) {
    disk(r, c.r1 >= c.r0 ? b : a, max(c.r0, c.r1));
    r.result.fallback_contours += r.result.contours - contours;
    return;
  }
  V e = mul(d, 1 / length), n = {-e.y, e.x};
  double x = -dr / length, z = 1 - x * x;
  if (z < 0) {
    r.status = SA_INK_RANGE;
    return;
  }
  double y = __builtin_sqrt(z);
  V top = add(mul(e, x), mul(n, y)), bottom = sub(mul(e, x), mul(n, y));
  V ab = add(a, mul(bottom, c.r0)), bb = add(b, mul(bottom, c.r1)),
    bt = add(b, mul(top, c.r1)), at = add(a, mul(top, c.r0));
  command(r, SA_INK_MOVE, ab);
  command(r, SA_INK_LINE, bb);
  arc(r, b, c.r1, bb, bt);
  command(r, SA_INK_LINE, at);
  arc(r, a, c.r0, at, ab);
  command(r, SA_INK_CLOSE);
  ++r.result.contours;
  ++r.result.fallback_contours;
}
static void flushFallback(Run &r) {
  if (r.pending_fallback && r.status == SA_INK_OK)
    emitHull(r, r.pending);
  r.pending_fallback = false;
}
static bool containedDisk(V a, double ar, V b, double br) {
  if (a.x == b.x && a.y == b.y && ar == br)
    return true;
  double rounding =
      64 * 2.220446049250313e-16 * (1 + norm(a) + norm(b) + ar + br);
  return norm(sub(a, b)) + ar < br - rounding;
}
static bool containedHull(const Curve &a, const Curve &b) {
  // A hull is the convex hull of its two endpoint disks. Containment of BOTH
  // disks in ONE endpoint disk of B is sufficient; no sampled visibility test
  // or guessed radius dominance can remove source coverage.
  for (uint32_t k = 0; k < 2; ++k) {
    V p = b.p[k ? b.degree : 0];
    double radius = k ? b.r1 : b.r0;
    if (containedDisk(a.p[0], a.r0, p, radius) &&
        containedDisk(a.p[a.degree], a.r1, p, radius))
      return true;
  }
  return false;
}
static void hull(Run &r, const Curve &c, uint32_t depth) {
  if (!leaf(r, depth))
    return;
  ++r.result.fallback_leaves;
  r.result.fallback_center_bound =
      max(r.result.fallback_center_bound, chordBound(c));
  if (r.pending_fallback) {
    if (containedHull(c, r.pending))
      return;
    if (!containedHull(r.pending, c))
      flushFallback(r);
  }
  r.pending = c;
  r.pending_fallback = true;
}
static V cubic(V a, V b, V c, V d, double t) {
  double u = 1 - t;
  return add(add(mul(a, u * u * u), mul(b, 3 * u * u * t)),
             add(mul(c, 3 * u * t * t), mul(d, t * t * t)));
}
static void fittedSide(Run &r, const Curve &c, double side, double lo,
                       double hi, uint32_t depth, bool reverse) {
  if (r.status != SA_INK_OK)
    return;
  Envelope a = envelope(c, lo, side), b = envelope(c, hi, side);
  double dt = hi - lo;
  V p1 = add(a.p, mul(a.d, dt / 3)), p2 = sub(b.p, mul(b.d, dt / 3));
  double error = 0;
  for (uint32_t i = 1; i < 4; i++) {
    double t = i * .25;
    error = max(error, norm(sub(cubic(a.p, p1, p2, b.p, t),
                                envelope(c, lo + dt * t, side).p)));
    ++r.result.sampled_checks;
  }
  if (!finite(error)) {
    r.status = SA_INK_RANGE;
    return;
  }
  if (error > r.o.tolerance * .5) {
    if (depth >= r.o.max_depth) {
      r.status = SA_INK_CAPACITY;
      return;
    }
    double mid = (lo + hi) * .5;
    if (reverse) {
      fittedSide(r, c, side, mid, hi, depth + 1, true);
      fittedSide(r, c, side, lo, mid, depth + 1, true);
    } else {
      fittedSide(r, c, side, lo, mid, depth + 1, false);
      fittedSide(r, c, side, mid, hi, depth + 1, false);
    }
    return;
  }
  if (!leaf(r, depth))
    return;
  r.result.sampled_envelope_error = max(r.result.sampled_envelope_error, error);
  ++r.result.envelope_curves;
  if (reverse)
    command(r, SA_INK_CUBIC, p2, p1, a.p);
  else
    command(r, SA_INK_CUBIC, p1, p2, b.p);
}
static Curve curve(const SAInkStrokeSegment &s) {
  Curve c{};
  c.degree = s.degree;
  c.r0 = s.radius[0];
  c.r1 = s.radius[1];
  for (uint32_t k = 0; k <= c.degree; k++)
    c.p[k] = {s.controls[2 * k], s.controls[2 * k + 1]};
  return c;
}
static bool adjacent(const Curve &a, const Curve &b) {
  V x = a.p[a.degree], y = b.p[0];
  return x.x == y.x && x.y == y.y && a.r1 == b.r0 &&
         dot(derivative(a, 1), derivative(b, 0)) > 0;
}
static void roundJoin(Run &r, V center, double radius, V a, V b) {
  // Concave corners stay inside their shared endpoint disk. Convex corners use
  // its short positive arc. A reversal never reaches this path: adjacent()
  // breaks that run into two complete round-capped sweep contours.
  if (norm(sub(a, b)) <= r.o.tolerance * .001)
    return;
  double d = angle(sub(b, center)) - angle(sub(a, center));
  while (d > PI)
    d -= TAU;
  while (d < -PI)
    d += TAU;
  if (d > 0)
    arc(r, center, radius, a, b);
  else
    command(r, SA_INK_LINE, b);
}
static void regularRun(Run &r, const SAInkStrokeSegment *segments,
                       uint32_t begin, uint32_t end) {
  flushFallback(r);
  Curve first = curve(segments[begin]), last = curve(segments[end - 1]);
  V start = envelope(first, 0, 1).p;
  command(r, SA_INK_MOVE, start);
  for (uint32_t i = begin; i < end && r.status == SA_INK_OK; i++) {
    Curve c = curve(segments[i]);
    if (i > begin) {
      Curve before = curve(segments[i - 1]);
      roundJoin(r, c.p[0], c.r0, envelope(before, 1, 1).p, envelope(c, 0, 1).p);
    }
    fittedSide(r, c, 1, 0, 1, 0, false);
  }
  arc(r, last.p[last.degree], last.r1, envelope(last, 1, 1).p,
      envelope(last, 1, -1).p);
  for (uint32_t i = end; i > begin && r.status == SA_INK_OK; i--) {
    Curve c = curve(segments[i - 1]);
    if (i < end) {
      Curve after = curve(segments[i]);
      roundJoin(r, c.p[c.degree], c.r1, envelope(after, 0, -1).p,
                envelope(c, 1, -1).p);
    }
    fittedSide(r, c, -1, 0, 1, 0, true);
  }
  arc(r, first.p[0], first.r0, envelope(first, 0, -1).p, start);
  command(r, SA_INK_CLOSE);
  ++r.result.contours;
}
static void sweep(Run &r, const Curve &c, uint32_t depth) {
  if (r.status != SA_INK_OK)
    return;
  if (c.degree == 0) {
    hull(r, c, depth);
    return;
  }
  if (regular(c)) {
    flushFallback(r);
    V start = envelope(c, 0, 1).p, end = envelope(c, 1, 1).p,
      otherEnd = envelope(c, 1, -1).p;
    command(r, SA_INK_MOVE, start);
    fittedSide(r, c, 1, 0, 1, depth, false);
    arc(r, c.p[c.degree], c.r1, end, otherEnd);
    fittedSide(r, c, -1, 0, 1, depth, true);
    arc(r, c.p[0], c.r0, envelope(c, 0, -1).p, start);
    command(r, SA_INK_CLOSE);
    ++r.result.contours;
    return;
  }
  if (chordBound(c) <= r.o.tolerance * .5) {
    hull(r, c, depth);
    return;
  }
  if (depth >= r.o.max_depth) {
    r.status = SA_INK_CAPACITY;
    return;
  }
  Curve a, b;
  split(c, a, b);
  sweep(r, a, depth + 1);
  sweep(r, b, depth + 1);
}
static bool overlap(const void *a, uint64_t an, const void *b, uint64_t bn) {
  if (!an || !bn)
    return false;
  uintptr_t x = (uintptr_t)a, y = (uintptr_t)b;
  if (an > UINTPTR_MAX - x || bn > UINTPTR_MAX - y)
    return true;
  return x < y + bn && y < x + an;
}
static bool span(const void *p, uint64_t bytes) {
  return !bytes || (p && bytes <= UINTPTR_MAX - (uintptr_t)p);
}
static bool aligned(const void *p) { return (uintptr_t)p % 8 == 0; }
static SAInkStatus prepare(const SAInkStrokeSegment *segments, uint32_t count,
                           const SAInkStrokeOptions *o,
                           SAInkPathCommand *output,
                           SAInkStrokeResult &result) {
  if (!span(o, sizeof(*o)) || !aligned(o) ||
      !span(segments, uint64_t(count) * sizeof(*segments)) || count > 100000 ||
      (count && !aligned(segments)) ||
      o->geometry_version != SA_INK_STROKE_GEOMETRY_VERSION ||
      !finite(o->tolerance) || o->tolerance < 1e-8 || o->tolerance > 1000 ||
      !o->max_depth || o->max_depth > 24 || !o->max_leaves ||
      o->max_leaves > 1000000 || !o->max_commands || o->max_commands > 4000000)
    return SA_INK_INVALID;
  for (uint32_t i = 0; i < count; i++) {
    const auto &s = segments[i];
    if (s.degree > 3 || s.reserved)
      return SA_INK_INVALID;
    for (uint32_t k = 0; k < 8; k++)
      if (!finite(s.controls[k]) || abs(s.controls[k]) > 1e6 ||
          (k > 2 * s.degree + 1 && s.controls[k] != 0))
        return SA_INK_INVALID;
    for (uint32_t k = 0; k < 2; k++)
      if (!finite(s.radius[k]) || s.radius[k] < 0 || s.radius[k] > 1e4)
        return SA_INK_INVALID;
    if (!s.degree && s.radius[0] != s.radius[1])
      return SA_INK_INVALID;
  }
  Run run{*o, {}, output, SA_INK_OK};
  for (uint32_t i = 0; i < count && run.status == SA_INK_OK;) {
    Curve c = curve(segments[i]);
    if (regular(c)) {
      uint32_t end = i + 1;
      Curve previous = c;
      while (end < count) {
        Curve next = curve(segments[end]);
        if (!regular(next) || !adjacent(previous, next))
          break;
        previous = next;
        ++end;
      }
      regularRun(run, segments, i, end);
      i = end;
    } else {
      sweep(run, c, 0);
      ++i;
    }
  }
  flushFallback(run);
  if (run.status == SA_INK_OK)
    result = run.result;
  return run.status;
}
} // namespace
extern "C" {
uint32_t sa_stroke_geometry_version() { return SA_INK_STROKE_GEOMETRY_VERSION; }
uint32_t sa_stroke_sizeof_segment() { return sizeof(SAInkStrokeSegment); }
uint32_t sa_stroke_sizeof_options() { return sizeof(SAInkStrokeOptions); }
uint32_t sa_stroke_sizeof_style() { return sizeof(SAInkStrokeStyle); }
uint32_t sa_stroke_sizeof_result() { return sizeof(SAInkStrokeResult); }
SAInkStatus sa_stroke_resolve_segments(const SAInkStrokeSegment *input,
                                       uint32_t count,
                                       const SAInkStrokeStyle *style,
                                       SAInkStrokeSegment *out,
                                       uint32_t capacity) {
  uint64_t bytes = uint64_t(count) * sizeof(*input);
  if (!span(style, sizeof(*style)) || !aligned(style) || !span(input, bytes) ||
      (count && !aligned(input)) || count > 100000 ||
      !finite(style->source_width) || style->source_width < .5 ||
      style->source_width > 40 || !finite(style->width) || style->width < .5 ||
      style->width > 40 || style->pressure > 1 || style->reserved ||
      !span(out, bytes) || (count && !aligned(out)) ||
      (input != out && overlap(input, bytes, out, bytes)) ||
      overlap(style, sizeof(*style), out, bytes))
    return SA_INK_INVALID;
  if (capacity < count)
    return SA_INK_CAPACITY;
  double ratio = style->width / style->source_width;
  for (uint32_t i = 0; i < count; i++) {
    const auto &s = input[i];
    if (s.degree > 3 || s.reserved)
      return SA_INK_INVALID;
    for (uint32_t k = 0; k < 8; k++)
      if (!finite(s.controls[k]) || abs(s.controls[k]) > 1e6 ||
          (k > 2 * s.degree + 1 && s.controls[k] != 0))
        return SA_INK_INVALID;
    for (uint32_t k = 0; k < 2; k++) {
      if (!finite(s.radius[k]) || s.radius[k] < 0 || s.radius[k] > 1e4)
        return SA_INK_INVALID;
      double r = style->pressure ? s.radius[k] * ratio : style->width * .5;
      if (!finite(r) || r > 1e4)
        return SA_INK_RANGE;
    }
    if (!s.degree && s.radius[0] != s.radius[1])
      return SA_INK_INVALID;
  }
  for (uint32_t i = 0; i < count; i++) {
    SAInkStrokeSegment s = input[i];
    s.radius[0] = style->pressure ? s.radius[0] * ratio : style->width * .5;
    s.radius[1] = style->pressure ? s.radius[1] * ratio : style->width * .5;
    out[i] = s;
  }
  return SA_INK_OK;
}
SAInkStatus sa_stroke_path_counts(const SAInkStrokeSegment *s, uint32_t n,
                                  const SAInkStrokeOptions *o,
                                  SAInkStrokeResult *out) {
  if (!span(out, sizeof(*out)) || !aligned(out) ||
      overlap(out, sizeof(*out), s, uint64_t(n) * sizeof(*s)) ||
      overlap(out, sizeof(*out), o, sizeof(*o)))
    return SA_INK_INVALID;
  SAInkStrokeResult result;
  auto status = prepare(s, n, o, nullptr, result);
  if (status == SA_INK_OK)
    *out = result;
  return status;
}
SAInkStatus sa_stroke_path_build(const SAInkStrokeSegment *s, uint32_t n,
                                 const SAInkStrokeOptions *o,
                                 SAInkPathCommand *commands, uint32_t capacity,
                                 SAInkStrokeResult *out) {
  if (!span(out, sizeof(*out)) || !aligned(out))
    return SA_INK_INVALID;
  SAInkStrokeResult result;
  auto status = prepare(s, n, o, nullptr, result);
  if (status != SA_INK_OK)
    return status;
  if (capacity < result.commands)
    return SA_INK_CAPACITY;
  if (result.commands && (!commands || !aligned(commands)))
    return SA_INK_INVALID;
  uint64_t bytes = uint64_t(result.commands) * sizeof(*commands),
           input = uint64_t(n) * sizeof(*s);
  if (overlap(commands, bytes, s, input) ||
      overlap(commands, bytes, o, sizeof(*o)) ||
      overlap(out, sizeof(*out), commands, bytes) ||
      overlap(out, sizeof(*out), s, input) ||
      overlap(out, sizeof(*out), o, sizeof(*o)))
    return SA_INK_INVALID;
  status = prepare(s, n, o, commands, result);
  if (status == SA_INK_OK)
    *out = result;
  return status;
}
}

// Path queries consume the SAME generated Bezier contours. This is a detached,
// bounded measurement/selection representation, never persisted rendering data.
#include "include/analytic-path.h"
namespace {
struct PathWalk {
  double tolerance;
  uint32_t budget;
  SAInkStrokePathMeasure result{};
  SAInkPoint *points = nullptr;
  SAInkContour *contours = nullptr;
  bool query = false, bounds_only = false;
  V probe{};
  double distance = __builtin_inf();
  V first{}, last{};
  uint32_t contour_start = 0;
  bool open = false, has_bounds = false;
  SAInkStatus status = SA_INK_OK;
};
static V mapped(const double *m, V p) {
  return {m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]};
}
static double segmentDistance(V p, V a, V b) {
  V d = sub(b, a);
  double s = dot(d, d);
  double t = s ? max(0, min(1, dot(sub(p, a), d) / s)) : 0;
  return norm(sub(p, add(a, mul(d, t))));
}
static void include(PathWalk &w, V p) {
  if (!w.has_bounds) {
    w.result.bounds = {p.x, p.y, 0, 0};
    w.has_bounds = true;
    return;
  }
  auto &b = w.result.bounds;
  double right = max(b.x + b.width, p.x), bottom = max(b.y + b.height, p.y);
  b.x = min(b.x, p.x);
  b.y = min(b.y, p.y);
  b.width = right - b.x;
  b.height = bottom - b.y;
}
static void extremum(PathWalk &w, const Curve &c, double t) {
  if (t > 0 && t < 1)
    include(w, value(c, t));
}
static void curveBounds(PathWalk &w, const Curve &c) {
  include(w, c.p[0]);
  include(w, c.p[c.degree]);
  for (uint32_t axis = 0; axis < 2; axis++) {
    double v[4];
    for (uint32_t i = 0; i <= c.degree; i++)
      v[i] = axis ? c.p[i].y : c.p[i].x;
    if (c.degree == 2) {
      double a = v[0] - 2 * v[1] + v[2];
      if (a)
        extremum(w, c, (v[0] - v[1]) / a);
    }
    if (c.degree == 3) {
      double a = -v[0] + 3 * v[1] - 3 * v[2] + v[3],
             b = 2 * (v[0] - 2 * v[1] + v[2]), d = v[1] - v[0],
             scale = max(abs(a), max(abs(b), abs(d)));
      if (!scale)
        continue;
      a /= scale;
      b /= scale;
      d /= scale;
      if (!a) {
        if (b)
          extremum(w, c, -d / b);
      } else {
        double disc = b * b - 4 * a * d;
        if (disc >= 0) {
          double root = __builtin_sqrt(disc),
                 q = -(b + (b < 0 ? -root : root)) * .5;
          extremum(w, c, q / a);
          if (q)
            extremum(w, c, d / q);
        }
      }
    }
  }
}
static void pathPoint(PathWalk &w, V p) {
  if (w.status != SA_INK_OK)
    return;
  if (w.result.points >= w.budget) {
    w.status = SA_INK_CAPACITY;
    return;
  }
  if (w.query && w.result.points > w.contour_start)
    w.distance = min(w.distance, segmentDistance(w.probe, w.last, p));
  if (w.points)
    w.points[w.result.points] = {p.x, p.y};
  ++w.result.points;
  w.last = p;
}
static void finishContour(PathWalk &w) {
  if (!w.open || w.status != SA_INK_OK)
    return;
  if (w.query)
    w.distance = min(w.distance, segmentDistance(w.probe, w.last, w.first));
  if (w.contours)
    w.contours[w.result.contours] = {w.contour_start,
                                     w.result.points - w.contour_start};
  ++w.result.contours;
  w.open = false;
}
static void flatCurve(PathWalk &w, const Curve &c, uint32_t depth) {
  if (w.status != SA_INK_OK)
    return;
  if (chordBound(c) <= w.tolerance) {
    pathPoint(w, c.p[c.degree]);
    return;
  }
  if (depth >= 24) {
    w.status = SA_INK_CAPACITY;
    return;
  }
  Curve a, b;
  split(c, a, b);
  flatCurve(w, a, depth + 1);
  flatCurve(w, b, depth + 1);
}
static SAInkStatus pathWalk(const SAInkPathCommand *commands, uint32_t n,
                            const double *m, PathWalk &w) {
  if (!span(commands, uint64_t(n) * sizeof(*commands)) ||
      (n && !aligned(commands)) || n > 4000000 || !span(m, 48) || !aligned(m) ||
      !finite(w.tolerance) || w.tolerance < 1e-9 || w.tolerance > 1000 ||
      !w.budget || w.budget > 4000000)
    return SA_INK_INVALID;
  for (uint32_t i = 0; i < 6; i++)
    if (!finite(m[i]))
      return SA_INK_INVALID;
  for (uint32_t i = 0; i < n; i++) {
    const auto &c = commands[i];
    if (c.reserved || c.operation > SA_INK_CLOSE)
      return SA_INK_INVALID;
    for (uint32_t k = 0; k < 6; k++)
      if (!finite(c.values[k]))
        return SA_INK_INVALID;
    if (c.operation == SA_INK_MOVE) {
      finishContour(w);
      V p = mapped(m, {c.values[0], c.values[1]});
      if (!finite(p.x) || !finite(p.y))
        return SA_INK_RANGE;
      w.contour_start = w.result.points;
      w.first = p;
      w.open = true;
      pathPoint(w, p);
      include(w, p);
    } else {
      if (!w.open)
        return SA_INK_INVALID;
      if (c.operation == SA_INK_CLOSE) {
        finishContour(w);
        continue;
      }
      Curve curve{};
      curve.p[0] = w.last;
      curve.degree = c.operation;
      for (uint32_t k = 0; k < curve.degree; k++) {
        curve.p[k + 1] = mapped(m, {c.values[k * 2], c.values[k * 2 + 1]});
        if (!finite(curve.p[k + 1].x) || !finite(curve.p[k + 1].y))
          return SA_INK_RANGE;
      }
      curveBounds(w, curve);
      if (w.bounds_only)
        pathPoint(w, curve.p[curve.degree]);
      else
        flatCurve(w, curve, 0);
    }
    if (w.status != SA_INK_OK)
      return w.status;
  }
  finishContour(w);
  return w.status;
}
} // namespace
extern "C" {
uint32_t sa_stroke_sizeof_path_measure() {
  return sizeof(SAInkStrokePathMeasure);
}
SAInkStatus sa_stroke_path_bounds(const SAInkPathCommand *c, uint32_t n,
                                  const double *m, SAInkBounds *out) {
  if (!span(out, sizeof(*out)) || !aligned(out) ||
      overlap(out, sizeof(*out), c, uint64_t(n) * sizeof(*c)) ||
      overlap(out, sizeof(*out), m, 48))
    return SA_INK_INVALID;
  PathWalk w{1, 4000000};
  w.bounds_only = true;
  auto status = pathWalk(c, n, m, w);
  if (status == SA_INK_OK)
    *out = w.result.bounds;
  return status;
}
SAInkStatus sa_stroke_path_measure(const SAInkPathCommand *c, uint32_t n,
                                   const double *m, double tolerance,
                                   uint32_t budget,
                                   SAInkStrokePathMeasure *out) {
  if (!span(out, sizeof(*out)) || !aligned(out) ||
      overlap(out, sizeof(*out), c, uint64_t(n) * sizeof(*c)) ||
      overlap(out, sizeof(*out), m, 48))
    return SA_INK_INVALID;
  PathWalk w{tolerance, budget};
  auto status = pathWalk(c, n, m, w);
  if (status == SA_INK_OK)
    *out = w.result;
  return status;
}
SAInkStatus sa_stroke_path_flatten(const SAInkPathCommand *c, uint32_t n,
                                   const double *m, double tolerance,
                                   uint32_t budget, SAInkPoint *p, uint32_t pn,
                                   SAInkContour *contours, uint32_t cn,
                                   SAInkStrokePathMeasure *out) {
  SAInkStrokePathMeasure required;
  auto status = sa_stroke_path_measure(c, n, m, tolerance, budget, &required);
  if (status != SA_INK_OK)
    return status;
  if (pn < required.points || cn < required.contours)
    return SA_INK_CAPACITY;
  uint64_t pb = uint64_t(required.points) * sizeof(*p),
           cb = uint64_t(required.contours) * sizeof(*contours),
           input = uint64_t(n) * sizeof(*c);
  if (!span(out, sizeof(*out)) || !aligned(out) || !span(p, pb) ||
      (pb && !aligned(p)) || !span(contours, cb) ||
      (cb && (uintptr_t)contours % 4) || overlap(p, pb, contours, cb) ||
      overlap(p, pb, c, input) || overlap(p, pb, m, 48) ||
      overlap(contours, cb, c, input) || overlap(contours, cb, m, 48) ||
      overlap(out, sizeof(*out), p, pb) ||
      overlap(out, sizeof(*out), contours, cb) ||
      overlap(out, sizeof(*out), c, input) || overlap(out, sizeof(*out), m, 48))
    return SA_INK_INVALID;
  PathWalk w{tolerance, budget};
  w.points = p;
  w.contours = contours;
  status = pathWalk(c, n, m, w);
  if (status == SA_INK_OK)
    *out = w.result;
  return status;
}
SAInkStatus sa_stroke_path_query(const SAInkPathCommand *c, uint32_t n,
                                 const double *m, double x, double y,
                                 double tolerance, uint32_t budget,
                                 SAInkHit *out) {
  if (!span(out, sizeof(*out)) || !aligned(out) || !finite(x) || !finite(y) ||
      overlap(out, sizeof(*out), c, uint64_t(n) * sizeof(*c)) ||
      overlap(out, sizeof(*out), m, 48))
    return SA_INK_INVALID;
  PathWalk w{tolerance, budget};
  w.query = true;
  w.probe = {x, y};
  auto status = pathWalk(c, n, m, w);
  if (status != SA_INK_OK)
    return status;
  SAAnalyticHit hit{};
  status = sa_analytic_path_winding_extended(c, n, m, x, y, SA_ANALYTIC_NONZERO,
                                             4000000, &hit);
  if (status != SA_INK_OK)
    return status;
  *out = {hit.inside || hit.boundary, 0,
          (hit.inside || hit.boundary) ? 0 : w.distance};
  return SA_INK_OK;
}
}
