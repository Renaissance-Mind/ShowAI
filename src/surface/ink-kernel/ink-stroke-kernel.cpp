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
  return q + max(c.r0, c.r1) * up < h * .9;
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
uint32_t sa_stroke_sizeof_result() { return sizeof(SAInkStrokeResult); }
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
