#include "include/ink-stroke-kernel.h"
#include "stroke-path-checked.hpp"
#if !defined(__wasm__)
#include "include/stroke-plan-private.h"
#include <new>
#endif

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
  uint32_t output_capacity = 0xffffffffu;
  bool pending_fallback = false;
  Curve pending{};
  V fan_origin{};
  bool has_disk = false;
  V last_disk{};
  double last_radius = 0;
  bool fit_seen = false, fit_continuous = true;
  V fit_first_l{}, fit_first_r{}, fit_last_l{}, fit_last_r{};
};
static double abs(double v) { return v < 0 ? -v : v; }
static double stroke_abs(double v) { return abs(v); }
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
  if (a.lo == a.hi && b.lo == b.hi && a.lo == -b.lo)
    return {0, 0};
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
                             uint32_t depth, uint32_t &budget,
                             bool nonnegative = false) {
  if (!budget)
    return false;
  --budget;
  bool positive = true;
  for (uint32_t i = 0; i <= degree; i++) {
    if (!finite(a[i].lo) || !finite(a[i].hi))
      return false;
    if (!(nonnegative ? a[i].lo >= 0 : a[i].lo > 0))
      positive = false;
  }
  if (positive)
    return true;
  if (depth == 8 || (nonnegative ? a[0].hi < 0 : a[0].hi <= 0) ||
      (nonnegative ? a[degree].hi < 0 : a[degree].hi <= 0))
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
  return progressPositive(left, degree, depth + 1, budget, nonnegative) &&
         progressPositive(right, degree, depth + 1, budget, nonnegative);
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
  if (r.result.commands >= r.o.max_commands || (r.output && r.result.commands >= r.output_capacity)) {
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

static ProgressInterval positiveDifference(double a, double b) {
  return progressAdd(progressPoint(a), progressPoint(-b));
}
// For S(t,u)=(1-u)L(t)+uR(t), det(S_t,S_u) interpolates these
// two degree-five polynomials. Nonnegative Bernstein lower bounds prove the
// actual fitted strip's degree cannot be negative, even under self-overlap.
// This is independent of the separate true-envelope regularity certificate.
static bool positiveRibbonSide(const V *L, const V *R, bool rightSide) {
  ProgressInterval dx[4], dy[4], vx[3], vy[3], coefficients[6]{};
  const V *edge = rightSide ? R : L;
  for (uint32_t i = 0; i < 4; i++) {
    dx[i] = positiveDifference(R[i].x, L[i].x);
    dy[i] = positiveDifference(R[i].y, L[i].y);
  }
  for (uint32_t i = 0; i < 3; i++) {
    vx[i] = progressMultiply(positiveDifference(edge[i + 1].x, edge[i].x),
                             progressPoint(3));
    vy[i] = progressMultiply(positiveDifference(edge[i + 1].y, edge[i].y),
                             progressPoint(3));
  }
  for (uint32_t i = 0; i < 3; i++)
    for (uint32_t j = 0; j < 4; j++) {
      double numerator = progressBinomial(2, i) * progressBinomial(3, j),
             denominator = progressBinomial(5, i + j),
             ratio = numerator / denominator;
      ProgressInterval weight =
          numerator == denominator
              ? progressPoint(1)
              : ProgressInterval{progressStep(ratio, false),
                                 progressStep(ratio, true)};
      auto determinant =
          progressAdd(progressMultiply(vx[i], dy[j]),
                      progressNegate(progressMultiply(vy[i], dx[j])));
      coefficients[i + j] = progressAdd(coefficients[i + j],
                                        progressMultiply(determinant, weight));
    }
  uint32_t budget = 64;
  return progressPositive(coefficients, 5, 0, budget, true);
}
static bool positiveBoundary(V origin, V a, V b, V c, V d) {
  // A boundary fan has Jacobian u*det(E',origin-E). The closed contour is
  // algebraically the sum of positively certified fans; radial edges cancel.
  // Validate actual emitted controls, not ideal trigonometric construction.
  V edge[4] = {a, b, c, d}, center[4] = {origin, origin, origin, origin};
  return positiveRibbonSide(edge, center, false);
}
static bool positiveLine(V origin, V a, V b) {
  auto x = positiveDifference(b.x, a.x), y = positiveDifference(b.y, a.y),
       u = positiveDifference(origin.x, a.x),
       v = positiveDifference(origin.y, a.y);
  auto determinant = progressAdd(progressMultiply(x, v),
                                 progressNegate(progressMultiply(y, u)));
  return determinant.lo >= 0;
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
    V p1 = add(p, mul({-sa, ca}, radius * h / 3)),
      p2 = sub(q, mul({-sb, cb}, radius * h / 3));
    if (!positiveBoundary(r.fan_origin, p, p1, p2, q)) {
      r.status = SA_INK_RANGE;
      return;
    }
    command(r, SA_INK_CUBIC, p1, p2, q);
    p = q;
  }
}
static void disk(Run &r, V p, double radius) {
  if (r.has_disk && p.x == r.last_disk.x && p.y == r.last_disk.y &&
      radius == r.last_radius)
    return;
  r.fan_origin = p;
  if (radius == 0)
    return;
  V start = add(p, {radius, 0});
  command(r, SA_INK_MOVE, start);
  arc(r, p, radius, start, start, true);
  command(r, SA_INK_CLOSE);
  ++r.result.contours;
  r.has_disk = true;
  r.last_disk = p;
  r.last_radius = radius;
}
struct GapVertex {
  V p;
  uint32_t mask;
  bool circle;
};
static ProgressInterval gapDet(V a, V b) {
  return progressAdd(
      progressMultiply(progressPoint(a.x), progressPoint(b.y)),
      progressNegate(progressMultiply(progressPoint(a.y), progressPoint(b.x))));
}
static ProgressInterval gapSide(V a, V b, V p) {
  auto x = positiveDifference(b.x, a.x), y = positiveDifference(b.y, a.y),
       u = positiveDifference(p.x, a.x), v = positiveDifference(p.y, a.y);
  return progressAdd(progressMultiply(x, v),
                     progressNegate(progressMultiply(y, u)));
}
static ProgressInterval gapScore(V p, V center, V n, double distance) {
  return progressAdd(
      progressAdd(progressMultiply(positiveDifference(p.x, center.x),
                                   progressPoint(n.x)),
                  progressMultiply(positiveDifference(p.y, center.y),
                                   progressPoint(n.y))),
      progressPoint(-distance));
}
static ProgressInterval gapDivide(ProgressInterval a, ProgressInterval b) {
  double v[4] = {a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi}, lo = v[0],
         hi = v[0];
  for (uint32_t i = 1; i < 4; i++) {
    lo = min(lo, v[i]);
    hi = max(hi, v[i]);
  }
  return {progressStep(lo, false), progressStep(hi, true)};
}
static bool buildGapBand(Run &r, V center, double radius, V axis, double first,
                         double second, double error) {
  auto norm2 = progressAdd(
      progressMultiply(progressPoint(axis.x), progressPoint(axis.x)),
      progressMultiply(progressPoint(axis.y), progressPoint(axis.y)));
  ProgressInterval length = {progressStep(__builtin_sqrt(norm2.lo), false),
                             progressStep(__builtin_sqrt(norm2.hi), true)};
  if (!(length.lo > 0))
    return false;
  double rounding = 64 * 2.220446049250313e-16 * (1 + norm(center) + radius);
  double lower = gapDivide(progressPoint(first), length).lo - rounding;
  double upper = gapDivide(progressAdd(progressPoint(-second),
                                       progressMultiply(progressPoint(radius),
                                                        progressPoint(error))),
                           length)
                     .hi +
                 rounding;
  if (lower >= upper || lower >= radius || upper <= -radius)
    return true;
  lower = max(-radius, lower);
  upper = min(radius, upper);
  V x = mul(axis, 1 / norm(axis)), y = {-x.y, x.x};
  double l = __builtin_sqrt(max(0, radius * radius - lower * lower)),
         u = __builtin_sqrt(max(0, radius * radius - upper * upper));
  V a = add(center, sub(mul(x, lower), mul(y, l))),
    b = add(center, sub(mul(x, upper), mul(y, u))),
    c = add(center, add(mul(x, upper), mul(y, u))),
    d = add(center, add(mul(x, lower), mul(y, l)));
  r.fan_origin = add(center, mul(x, (lower + upper) * .5));
  if (!positiveLine(r.fan_origin, b, c) || !positiveLine(r.fan_origin, d, a))
    return false;
  command(r, SA_INK_MOVE, a);
  arc(r, center, radius, a, b, false);
  command(r, SA_INK_LINE, c);
  arc(r, center, radius, c, d, false);
  command(r, SA_INK_LINE, a);
  command(r, SA_INK_CLOSE);
  ++r.result.contours;
  return r.status == SA_INK_OK;
}
static bool buildGap(Run &r, const Curve &a, const Curve &b) {
  V center = b.p[0];
  double radius = b.r0;
  if (radius == 0)
    return true;
  V va = derivative(a, 1), vb = derivative(b, 0);
  double sa = norm(va), sb = norm(vb), qa = a.r1 - a.r0, qb = b.r1 - b.r0;
  if (qa == 0 && qb == 0) {
    V first, last;
    double delta = angle(vb) - angle(va);
    while (delta > PI)
      delta -= TAU;
    while (delta < -PI)
      delta += TAU;
    if (delta == 0)
      return true;
    if (delta > 0) {
      first = envelope(a, 1, 1).p;
      last = envelope(b, 0, 1).p;
    } else {
      first = envelope(b, 0, -1).p;
      last = envelope(a, 1, -1).p;
    }
    if (first.x == last.x && first.y == last.y)
      return true;
    r.fan_origin = center;
    command(r, SA_INK_MOVE, center);
    command(r, SA_INK_LINE, first);
    arc(r, center, radius, first, last, false);
    command(r, SA_INK_CLOSE);
    ++r.result.contours;
    return r.status == SA_INK_OK;
  }
  V n[2] = {mul(va, 1 / sa), mul(vb, -1 / sb)};
  double distances[2] = {-radius * qa / sa, radius * qb / sb};
  auto ex = progressAdd(progressPoint(n[0].x), progressPoint(n[1].x)),
       ey = progressAdd(progressPoint(n[0].y), progressPoint(n[1].y));
  auto e2 = progressAdd(progressMultiply(ex, ex), progressMultiply(ey, ey));
  double error = progressStep(__builtin_sqrt(max(0, e2.hi)), true);
  // If n1=-n0+e, a disk/halfplane-intersection point satisfies
  // d0<=n0.p<=-d1+r|e|. This enclosing band remains in the canonical endpoint
  // disk. Extra band coverage neither adds a foreign nib nor erases a width
  // knot. It avoids an ill-conditioned near-parallel plane intersection.
  if (error < .125)
    return buildGapBand(r, center, radius, n[0], distances[0], distances[1],
                        error);

  GapVertex vertices[8];
  uint32_t count = 0;
  V candidates[4] = {envelope(a, 1, 1).p, envelope(a, 1, -1).p,
                     envelope(b, 0, 1).p, envelope(b, 0, -1).p};
  for (uint32_t i = 0; i < 4; i++) {
    uint32_t own = i / 2, other = 1 - own;
    auto score = gapScore(candidates[i], center, n[other], distances[other]);
    if (!finite(score.lo) || !finite(score.hi))
      return false;
    if (score.hi >= 0)
      vertices[count++] = {candidates[i], uint32_t(1) << own, true};
  }
  auto det = gapDet(n[0], n[1]);
  if (!finite(det.lo) || !finite(det.hi) || (det.lo <= 0 && det.hi >= 0))
    return false;
  auto nx = progressAdd(
      progressMultiply(progressPoint(distances[0]), progressPoint(n[1].y)),
      progressNegate(progressMultiply(progressPoint(n[0].y),
                                      progressPoint(distances[1]))));
  auto ny = progressAdd(
      progressMultiply(progressPoint(n[0].x), progressPoint(distances[1])),
      progressNegate(progressMultiply(progressPoint(distances[0]),
                                      progressPoint(n[1].x))));
  auto ix = gapDivide(nx, det), iy = gapDivide(ny, det),
       norm2 = progressAdd(progressMultiply(ix, ix), progressMultiply(iy, iy)),
       rr = progressMultiply(progressPoint(radius), progressPoint(radius));
  if (!finite(norm2.lo) || !finite(norm2.hi))
    return false;
  if (norm2.hi < rr.lo) {
    // Keep the whole certified intersection box, not a rounded midpoint which
    // could cut off a true gap vertex. Its box is inside the endpoint disk;
    // convexifying it only adds already-canonical disk coverage.
    auto wx = progressAdd(ix, progressPoint(center.x)),
         wy = progressAdd(iy, progressPoint(center.y));
    auto dx = progressAdd(wx, progressPoint(-center.x)),
         dy = progressAdd(wy, progressPoint(-center.y));
    if (progressAdd(progressMultiply(dx, dx), progressMultiply(dy, dy)).hi >=
        rr.lo)
      return false;
    vertices[count++] = {{wx.lo, wy.lo}, 3, false};
    vertices[count++] = {{wx.lo, wy.hi}, 3, false};
    vertices[count++] = {{wx.hi, wy.lo}, 3, false};
    vertices[count++] = {{wx.hi, wy.hi}, 3, false};
  } else if (!(norm2.lo > rr.hi))
    return false;
  if (count == 0)
    return true;
  if (count == 1)
    return false;
  for (uint32_t i = 1; i < count; i++) {
    auto v = vertices[i];
    uint32_t j = i;
    while (j &&
           (vertices[j - 1].p.x > v.p.x ||
            (vertices[j - 1].p.x == v.p.x && vertices[j - 1].p.y > v.p.y))) {
      vertices[j] = vertices[j - 1];
      j--;
    }
    vertices[j] = v;
  }
  uint32_t unique = 0;
  for (uint32_t i = 0; i < count; i++) {
    if (unique && vertices[i].p.x == vertices[unique - 1].p.x &&
        vertices[i].p.y == vertices[unique - 1].p.y) {
      vertices[unique - 1].mask |= vertices[i].mask;
      vertices[unique - 1].circle |= vertices[i].circle;
    } else
      vertices[unique++] = vertices[i];
  }
  count = unique;
  if (count < 2)
    return false;
  GapVertex hull[16];
  uint32_t size = 0;
  for (uint32_t phase = 0; phase < 2; phase++) {
    uint32_t start = size;
    for (uint32_t j = 0; j < count; j++) {
      auto v = vertices[phase ? count - 1 - j : j];
      while (size >= start + 2) {
        auto turn = gapSide(hull[size - 2].p, hull[size - 1].p, v.p);
        if (turn.lo > 0)
          break;
        if (turn.hi < 0 || (turn.lo == 0 && turn.hi == 0)) {
          size--;
          continue;
        }
        return false;
      }
      hull[size++] = v;
    }
    size--;
  }
  if (size < 2)
    return false;
  V origin = {0, 0};
  for (uint32_t i = 0; i < size; i++)
    origin = add(origin, hull[i].p);
  origin = mul(origin, 1.0 / size);
  if (size == 2) {
    bool found = false;
    for (uint32_t orientation = 0; orientation < 2 && !found; orientation++) {
      V first = hull[orientation].p, last = hull[1 - orientation].p;
      double x = angle(sub(first, center)), span = angle(sub(last, center)) - x;
      while (span < 0)
        span += TAU;
      double sn, cs;
      trig(x + span * .5, sn, cs);
      V mid = add(center, mul({cs, sn}, radius));
      if (gapScore(mid, center, n[0], distances[0]).lo > 0 &&
          gapScore(mid, center, n[1], distances[1]).lo > 0) {
        origin = mul(add(add(hull[0].p, hull[1].p), mid), 1.0 / 3);
        found = true;
      }
    }
    if (!found)
      return false;
  }
  r.fan_origin = origin;
  command(r, SA_INK_MOVE, hull[0].p);
  for (uint32_t i = 0; i < size; i++) {
    auto first = hull[i], last = hull[(i + 1) % size];
    auto side = gapSide(first.p, last.p, origin);
    if ((first.mask & last.mask) && side.lo > 0) {
      command(r, SA_INK_LINE, last.p);
    } else if (first.circle && last.circle) {
      arc(r, center, radius, first.p, last.p, false);
    } else
      return false;
    if (r.status != SA_INK_OK)
      return false;
  }
  command(r, SA_INK_CLOSE);
  ++r.result.contours;
  return r.status == SA_INK_OK;
}
static void positiveGap(Run &r, const Curve &a, const Curve &b) {
  // A full endpoint disk is always canonical coverage. Use it if clipping,
  // finite precision or a convex boundary fan cannot be certified; never
  // emit a negative join correction or trust a sampled winding test.
  Run probe = r;
  probe.output = nullptr;
  if (!buildGap(probe, a, b)) {
    disk(r, b.p[0], b.r0);
    return;
  }
  if (!r.output) {
    r.result = probe.result;
    r.fan_origin = probe.fan_origin;
    return;
  }
  if (!buildGap(r, a, b))
    r.status = SA_INK_RANGE;
}

static void emitHull(Run &r, const Curve &c) {
  uint32_t contours = r.result.contours;
  if (c.r0 == 0 && c.r1 == 0)
    return;
  V a = c.p[0], b = c.p[c.degree], d = sub(b, a);
  r.fan_origin = mix(a, b, .5);
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
  if (!positiveLine(r.fan_origin, ab, bb) ||
      !positiveLine(r.fan_origin, bt, at)) {
    r.status = SA_INK_RANGE;
    return;
  }
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

static void positiveFit(Run &r, const Curve &c, uint32_t depth,
                        uint32_t mode = 0) {
  bool sideOnly = mode == 1 || mode == 2;
  if (r.status != SA_INK_OK)
    return;
  if (c.r0 == 0 && c.r1 == 0)
    return;
  Envelope a = envelope(c, 0, 1), b = envelope(c, 1, 1), x = envelope(c, 0, -1),
           y = envelope(c, 1, -1);
  V L[4] = {a.p, add(a.p, mul(a.d, 1.0 / 3)), sub(b.p, mul(b.d, 1.0 / 3)), b.p};
  V R[4] = {x.p, add(x.p, mul(x.d, 1.0 / 3)), sub(y.p, mul(y.d, 1.0 / 3)), y.p};
  double error = 0;
  for (uint32_t i = 1; i < 4; i++) {
    double t = i * .25;
    error =
        max(error,
            norm(sub(cubic(L[0], L[1], L[2], L[3], t), envelope(c, t, 1).p)));
    error =
        max(error,
            norm(sub(cubic(R[0], R[1], R[2], R[3], t), envelope(c, t, -1).p)));
    if (!sideOnly)
      r.result.sampled_checks += 2;
  }
  if (!finite(error)) {
    r.status = SA_INK_RANGE;
    return;
  }
  if (error <= r.o.tolerance * .5 && positiveRibbonSide(L, R, false) &&
      positiveRibbonSide(L, R, true)) {
    if (sideOnly) {
      command(r, SA_INK_CUBIC, mode == 1 ? L[1] : R[2], mode == 1 ? L[2] : R[1],
              mode == 1 ? L[3] : R[0]);
      return;
    }
    if (!leaf(r, depth) || !leaf(r, depth))
      return;
    if (!r.fit_seen) {
      r.fit_first_l = L[0];
      r.fit_first_r = R[0];
      r.fit_seen = true;
    } else if (r.fit_last_l.x != L[0].x || r.fit_last_l.y != L[0].y ||
               r.fit_last_r.x != R[0].x || r.fit_last_r.y != R[0].y) {
      r.fit_continuous = false;
      if (mode == 0)
        disk(r, c.p[0], c.r0);
    }
    r.fit_last_l = L[3];
    r.fit_last_r = R[3];
    r.result.sampled_envelope_error =
        max(r.result.sampled_envelope_error, error);
    r.result.envelope_curves += 2;
    if (mode == 3)
      return;
    command(r, SA_INK_MOVE, L[0]);
    command(r, SA_INK_CUBIC, L[1], L[2], L[3]);
    command(r, SA_INK_LINE, R[3]);
    command(r, SA_INK_CUBIC, R[2], R[1], R[0]);
    command(r, SA_INK_CLOSE);
    ++r.result.contours;
    return;
  }
  if (chordBound(c) <= r.o.tolerance * .5) {
    if (sideOnly) {
      r.status = SA_INK_RANGE;
      return;
    }
    r.fit_continuous = false;
    if (mode == 3) {
      if (leaf(r, depth))
        ++r.result.fallback_leaves;
      return;
    }
    hull(r, c, depth);
    return;
  }
  if (depth >= r.o.max_depth) {
    r.status = SA_INK_CAPACITY;
    return;
  }
  Curve first, last;
  split(c, first, last);
  if (mode == 2) {
    positiveFit(r, last, depth + 1, mode);
    positiveFit(r, first, depth + 1, mode);
  } else {
    positiveFit(r, first, depth + 1, mode);
    positiveFit(r, last, depth + 1, mode);
  }
}
static void positiveBand(Run &r, const Curve &c, uint32_t depth) {
  // Exact cross-section matches let adjacent strip boundaries cancel without
  // changing their nonnegative degree. Otherwise retain independent pieces
  // and seal discontinuities with a canonical endpoint disk. Planning emits
  // no commands: max_commands applies to the final, not scratch, geometry.
  if (c.r0 == 0 && c.r1 == 0)
    return;
  Run probe = r;
  probe.output = nullptr;
  probe.fit_seen = false;
  probe.fit_continuous = true;
  positiveFit(probe, c, depth, 3);
  if (probe.status != SA_INK_OK) {
    r.status = probe.status;
    return;
  }
  if (probe.fit_seen && probe.fit_continuous &&
      probe.result.fallback_leaves == r.result.fallback_leaves) {
    uint32_t commands = r.result.commands, contours = r.result.contours;
    r.result = probe.result;
    r.result.commands = commands;
    r.result.contours = contours;
    command(r, SA_INK_MOVE, probe.fit_first_l);
    positiveFit(r, c, depth, 1);
    command(r, SA_INK_LINE, probe.fit_last_r);
    positiveFit(r, c, depth, 2);
    command(r, SA_INK_CLOSE);
    ++r.result.contours;
  } else {
    r.fit_seen = false;
    r.fit_continuous = true;
    positiveFit(r, c, depth);
  }
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
static void sweep(Run &r, const Curve &c, uint32_t depth) {
  if (r.status != SA_INK_OK)
    return;
  if (c.degree == 0) {
    hull(r, c, depth);
    return;
  }
  if (regular(c)) {
    flushFallback(r);
    positiveBand(r, c, depth);
    flushFallback(r);
    disk(r, c.p[0], c.r0);
    disk(r, c.p[c.degree], c.r1);
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
static bool gradualBinary64() {
  // A host may change its thread-local FP mode. FTZ/DAZ would invalidate a
  // one-ULP interval enclosure; reject that actual execution mode atomically.
  // Volatile operands require real operations, not constant-folded answers.
  volatile double normal = 0x1p-1022, half = .5,
                  smallest = 0x0.0000000000001p-1022, one = 1;
  double first = normal * half, second = smallest * one;
  uint64_t a, b;
  __builtin_memcpy(&a, &first, 8);
  __builtin_memcpy(&b, &second, 8);
  return a == uint64_t(0x0008000000000000) && b == uint64_t(1);
}
static SAInkStatus prepare(const SAInkStrokeSegment *segments, uint32_t count,
                           const SAInkStrokeOptions *o,
                           SAInkPathCommand *output,
                           SAInkStrokeResult &result, uint32_t output_capacity = 0xffffffffu) {
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
      if (!finite(s.controls[k]) || stroke_abs(s.controls[k]) > 1e6 ||
          (k > 2 * s.degree + 1 && s.controls[k] != 0))
        return SA_INK_INVALID;
    for (uint32_t k = 0; k < 2; k++)
      if (!finite(s.radius[k]) || s.radius[k] < 0 || s.radius[k] > 1e4)
        return SA_INK_INVALID;
    if (!s.degree && s.radius[0] != s.radius[1])
      return SA_INK_INVALID;
  }
  if (!gradualBinary64())
    return SA_INK_RANGE;
  Run run{*o, {}, output, SA_INK_OK};
  run.output_capacity = output_capacity;
#ifdef SHOWAI_STROKE_WALK_COUNTERS
  extern void observe_stroke_walk(bool);
  observe_stroke_walk(output != nullptr);
#endif
  bool pendingRegular = false;
  Curve previous{};
  for (uint32_t i = 0; i < count && run.status == SA_INK_OK; i++) {
    Curve c = curve(segments[i]);
    if (regular(c)) {
      flushFallback(run);
      if (pendingRegular && previous.p[previous.degree].x == c.p[0].x &&
          previous.p[previous.degree].y == c.p[0].y && previous.r1 == c.r0)
        positiveGap(run, previous, c);
      else {
        if (pendingRegular)
          disk(run, previous.p[previous.degree], previous.r1);
        disk(run, c.p[0], c.r0);
      }
      positiveBand(run, c, 0);
      flushFallback(run);
      previous = c;
      pendingRegular = true;
    } else {
      if (pendingRegular)
        disk(run, previous.p[previous.degree], previous.r1);
      pendingRegular = false;
      sweep(run, c, 0);
    }
  }
  if (pendingRegular)
    disk(run, previous.p[previous.degree], previous.r1);

  flushFallback(run);
  if (run.status == SA_INK_OK)
    result = run.result;
  return run.status;
}
} // namespace
namespace showai_stroke_internal {
#ifdef SHOWAI_STROKE_WALK_COUNTERS
static WalkWork observed{};
void reset_walk_work() { observed = {}; }
WalkWork walk_work() { return observed; }
#endif
EmissionPlan::EmissionPlan(const SAInkStrokeSegment *s, uint32_t n,
                           const SAInkStrokeOptions *o)
    : source_(s), count_(n), original_options_(o),
      status_(sa_stroke_path_counts(s, n, o, &required_)) {
  if (status_ == SA_INK_OK)
    options_ = *o;
}
bool EmissionPlan::overlaps_input(const void *p, uint64_t n) const {
  return overlap(p, n, source_, uint64_t(count_) * sizeof(*source_)) ||
         overlap(p, n, original_options_, sizeof(options_)) ||
         overlap(p, n, this, sizeof(*this));
}
SAInkStatus EmissionPlan::counts(SAInkStrokeResult *out) const {
  if (status_ != SA_INK_OK)
    return status_;
  if (!span(out, sizeof(*out)) || !aligned(out) ||
      overlaps_input(out, sizeof(*out)))
    return SA_INK_INVALID;
  *out = required_;
  return SA_INK_OK;
}
SAInkStatus EmissionPlan::emit(SAInkPathCommand *commands, uint32_t capacity,
                               SAInkStrokeResult *out) const {
  if (!span(out, sizeof(*out)) || !aligned(out))
    return SA_INK_INVALID;
  if (status_ != SA_INK_OK)
    return status_;
  if (capacity < required_.commands)
    return SA_INK_CAPACITY;
  if (required_.commands && (!commands || !aligned(commands)))
    return SA_INK_INVALID;
  const uint64_t bytes = uint64_t(required_.commands) * sizeof(*commands);
  if (!span(commands, bytes) || overlaps_input(commands, bytes) ||
      overlaps_input(out, sizeof(*out)) ||
      overlap(out, sizeof(*out), commands, bytes))
    return SA_INK_INVALID;
  SAInkStrokeResult actual{};
  auto status = prepare(source_, count_, &options_, commands, actual, capacity);
  if (status != SA_INK_OK)
    return status;
  if (actual.commands != required_.commands ||
      actual.contours != required_.contours ||
      actual.leaves != required_.leaves ||
      actual.envelope_curves != required_.envelope_curves ||
      actual.fallback_leaves != required_.fallback_leaves ||
      actual.fallback_contours != required_.fallback_contours ||
      actual.sampled_checks != required_.sampled_checks ||
      actual.maximum_depth != required_.maximum_depth ||
      actual.sampled_envelope_error != required_.sampled_envelope_error ||
      actual.fallback_center_bound != required_.fallback_center_bound ||
      actual.arc_error_bound != required_.arc_error_bound)
    return SA_INK_INVALID;
  *out = actual;
  return SA_INK_OK;
}
} // namespace showai_stroke_internal
#ifdef SHOWAI_STROKE_WALK_COUNTERS
namespace {
void observe_stroke_walk(bool emission) {
  if (emission)
    ++showai_stroke_internal::observed.emissions;
  else
    ++showai_stroke_internal::observed.counts;
}
} // namespace
#endif
#if !defined(__wasm__)
namespace {
struct alignas(16) NativeStrokePlan {
  uint64_t magic = 0x5354524f4b455031ull;
  const NativeStrokePlan *owner = this;
  showai_stroke_internal::EmissionPlan plan;
  NativeStrokePlan(const SAInkStrokeSegment *s, uint32_t n,
                   const SAInkStrokeOptions *o)
      : plan(s, n, o) {}
};
bool valid_stroke_plan(const void *p) {
  return span(p, sizeof(NativeStrokePlan)) &&
         (uintptr_t(p) % alignof(NativeStrokePlan) == 0) &&
         static_cast<const NativeStrokePlan *>(p)->magic ==
             0x5354524f4b455031ull &&
         static_cast<const NativeStrokePlan *>(p)->owner == p;
}
} // namespace
extern "C" {
uint32_t showai_private_stroke_plan_bytes() { return sizeof(NativeStrokePlan); }
SAInkStatus showai_private_stroke_plan_initialize(void *p, uint32_t bytes,
                                                  const SAInkStrokeSegment *s,
                                                  uint32_t n,
                                                  const SAInkStrokeOptions *o) {
  if (bytes < sizeof(NativeStrokePlan) || !span(p, bytes) ||
      uintptr_t(p) % alignof(NativeStrokePlan) ||
      overlap(p, bytes, s, uint64_t(n) * sizeof(*s)) ||
      overlap(p, bytes, o, sizeof(*o)))
    return SA_INK_INVALID;
  // Native owner zero-initializes fresh storage. Never overwrite a live plan.
  if (valid_stroke_plan(p))
    return SA_INK_INVALID;
  auto *state = new (p) NativeStrokePlan(s, n, o);
  auto status = state->plan.status();
  if (status != SA_INK_OK) {
    state->magic = 0;
    state->owner = nullptr;
    state->~NativeStrokePlan();
  }
  return status;
}
SAInkStatus showai_private_stroke_plan_counts(const void *p,
                                              SAInkStrokeResult *out) {
  if (!valid_stroke_plan(p) ||
      overlap(out, sizeof(*out), p, sizeof(NativeStrokePlan)))
    return SA_INK_INVALID;
  return static_cast<const NativeStrokePlan *>(p)->plan.counts(out);
}
SAInkStatus showai_private_stroke_plan_build(const void *p,
                                             SAInkPathCommand *out,
                                             uint32_t capacity,
                                             SAInkStrokeResult *result) {
  if (!valid_stroke_plan(p) ||
      overlap(out, uint64_t(capacity) * sizeof(*out), p,
              sizeof(NativeStrokePlan)) ||
      overlap(result, sizeof(*result), p, sizeof(NativeStrokePlan)))
    return SA_INK_INVALID;
  return static_cast<const NativeStrokePlan *>(p)->plan.emit(out, capacity,
                                                             result);
}
SAInkStatus showai_private_stroke_plan_destroy(void *p) {
  if (!valid_stroke_plan(p))
    return SA_INK_INVALID;
  auto *state = static_cast<NativeStrokePlan *>(p);
  state->magic = 0;
  state->owner = nullptr;
  state->~NativeStrokePlan();
  return SA_INK_OK;
}
}
#endif
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
      if (!finite(s.controls[k]) || stroke_abs(s.controls[k]) > 1e6 ||
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
  const showai_stroke_internal::EmissionPlan plan(s,n,o);
  return plan.emit(commands,capacity,out);
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
