#ifndef SHOWAI_INK_STROKE_KERNEL_H
#define SHOWAI_INK_STROKE_KERNEL_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif

#define SA_INK_STROKE_GEOMETRY_VERSION 1u
/* Center Bezier controls in consecutive x/y pairs. degree=0 is one point,
 * degree=1/2/3 consumes 2/3/4 controls. Every unused control MUST be zero.
 * Radius is linear in this element's parameter, NOT arc length. A point must
 * have equal endpoint radii. Nonnegative zero radii are meaningful.
 * reserved MUST be zero. Raw pressure knots must be split by the input adapter;
 * replacing arbitrary pressure profiles by their two endpoints is not implied.
 */
typedef struct {
  double controls[8], radius[2];
  uint32_t degree, reserved;
} SAInkStrokeSegment;
typedef struct {
  double tolerance;
  uint32_t geometry_version, max_depth, max_leaves, max_commands;
} SAInkStrokeOptions;
typedef struct {
  uint32_t commands, contours, envelope_curves, fallback_leaves;
  uint32_t sampled_checks, leaves, maximum_depth, fallback_contours;
  double sampled_envelope_error, fallback_center_bound, arc_error_bound;
} SAInkStrokeResult;

uint32_t sa_stroke_geometry_version(void);
uint32_t sa_stroke_sizeof_segment(void);
uint32_t sa_stroke_sizeof_options(void);
uint32_t sa_stroke_sizeof_result(void);
/* Version1 defines round pen/marker circular sweep only; no other cap/join flag
 * is accepted. Each element contributes the union of its moving disks. All
 * contours have positive orientation and are ONE nonzero-fill opacity
 * composite; alpha-blending individual contours is incorrect. Elements may be
 * disconnected. Connected elements naturally have round union joins. A closed
 * source must explicitly supply its closing element; no implicit center-line
 * edge is added. Zero elements mean empty coverage. A point contributes a disk
 * (zero radius contributes empty area). Version1 does not change portable ink
 * v1 semantics.
 * Preparing an affected subrange is legal; combine its coverage with retained
 * subranges before applying opacity. This kernel has no camera-dependent work.
 *
 * Regular intervals use the actual circular envelope and analytic derivatives,
 * approximated by endpoint Hermite cubics. Adaptive quarter/mid/three-quarter
 * checks are SAMPLED errors, not certified global bounds. Unsafe speed/radius
 * or folded intervals use a linear sweep fallback; its center deviation has a
 * Bernstein convex-hull bound. Circular arcs use Hermite cubics with a separate
 * conservative angular interpolation bound. Statistics are diagnostic, never
 * another authoritative source geometry. Output is local-space M/L/C/Z.
 *
 * Freestanding/caller-owned: no allocation, runtime or host math imports.
 * counts and build do the same bounded validation/preparation. Any invalid,
 * capacity, alias or exhausted depth/work budget leaves ALL outputs untouched.
 * Input/output buffers must not overlap; arithmetic pointer overflow rejects.
 * Every nonempty POD buffer must be 8-byte aligned on both native and Wasm.
 */
SAInkStatus sa_stroke_path_counts(const SAInkStrokeSegment *, uint32_t,
                                  const SAInkStrokeOptions *,
                                  SAInkStrokeResult *);
SAInkStatus sa_stroke_path_build(const SAInkStrokeSegment *, uint32_t,
                                 const SAInkStrokeOptions *, SAInkPathCommand *,
                                 uint32_t capacity, SAInkStrokeResult *);
#ifdef __cplusplus
}
#endif
#endif
