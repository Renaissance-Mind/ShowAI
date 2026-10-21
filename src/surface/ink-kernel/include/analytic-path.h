#ifndef SHOWAI_ANALYTIC_PATH_H
#define SHOWAI_ANALYTIC_PATH_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif

#define SA_ANALYTIC_ABI_VERSION 1u
typedef enum {
  SA_ANALYTIC_NONZERO = 0,
  SA_ANALYTIC_EVENODD = 1
} SAAnalyticFill;
typedef enum {
  SA_ANALYTIC_SOLID = 0,
  SA_ANALYTIC_QUADRATIC = 1,
  SA_ANALYTIC_CUBIC = 2,
  SA_ANALYTIC_RAY = 3
} SAAnalyticMode;
/* Positions are relative to EACH patch's binary64 origin, never world floats.
 * QUADRATIC accepts sign*(k*k-l)>=0; CUBIC sign*(k*k*k-l*m)>=0.
 * SOLID accepts every covered sample. RAY evaluates the actual cubic closed by
 * its endpoint chord (see sa_analytic_patch_winding); it is an analytic numeric
 * degeneracy fallback, NOT a flattened polygon or an approximate replacement.
 * Accumulate signed winding BEFORE opacity: no per-triangle alpha blending.
 * Fan and lens patches may overlap, including between contours. For RAY use
 * its integer winding, for other modes use patch.winding. Apply fill rule once.
 * Shared triangle edges use the normal top-left raster convention. Reflection
 * is already reflected in winding; do not flip winding a second time.
 */
/* Five contiguous Float32 scalars. Metal consumers must use packed_float2/3
 * (or scalar fields), not the padded float3 host/shader layout. */
typedef struct {
  float x, y, k, l, m;
} SAAnalyticVertex;
typedef struct {
  double origin[2];
  double controls[8]; /* world-space cubic Bernstein controls; exact binary64 */
  double parameter_start, parameter_end; /* original command's t interval */
  uint32_t first_vertex, vertex_count, command_index, mode;
  int32_t winding;
  float sign;
} SAAnalyticPatch;
typedef struct {
  uint32_t patches, vertices, ray_patches, reserved;
} SAAnalyticCounts;
typedef struct {
  int32_t winding;
  uint32_t inside, boundary, reserved;
} SAAnalyticHit;
typedef struct {
  double value, dx, dy, coverage;
} SAAnalyticEvaluation;
/* Limits cap actual work, including the sizing pass. Zero is invalid. Bounds
 * on commands, subdivision and output cannot silently truncate a path. */
typedef struct {
  uint32_t max_commands, max_patches, max_depth, reserved;
} SAAnalyticBudget;

uint32_t sa_analytic_abi_version(void);
uint32_t sa_analytic_sizeof_patch(void);
uint32_t sa_analytic_sizeof_vertex(void);
/* Null output arrays are accepted only for counts(). counts/build run the same
 * complete validation. On failure counts and ALL output memory remain intact.
 * Open subpaths close implicitly; a following MOVE also closes its predecessor.
 * Nonfinite inputs, unsupported operations, missing MOVE, nonzero reserved,
 * nonfinite transforms, capacity/alias violations are errors. Singular affine
 * maps are valid: their filled area is empty, not a fabricated nonzero shape.
 */
SAInkStatus sa_analytic_path_counts(const SAInkPathCommand *, uint32_t,
                                    const double affine[6],
                                    const SAAnalyticBudget *,
                                    SAAnalyticCounts *);
SAInkStatus sa_analytic_path_build(const SAInkPathCommand *, uint32_t,
                                   const double affine[6],
                                   const SAAnalyticBudget *, SAAnalyticPatch *,
                                   uint32_t patch_capacity, SAAnalyticVertex *,
                                   uint32_t vertex_capacity,
                                   SAAnalyticCounts *);
/* Public mathematical evaluator and independent curve-ray winding oracle.
 * No fixed-step curve flattening is used by any of these entry points. */
SAInkStatus sa_analytic_bezier_evaluate(const double *controls, uint32_t degree,
                                        double t, SAInkPoint *position,
                                        SAInkPoint *derivative);
SAInkStatus sa_analytic_curve_evaluate(const double controls[8], double t,
                                       SAInkPoint *position,
                                       SAInkPoint *derivative);
/* Derivatives of interpolated k/l/m in screen pixels. Returns the exact chain
 * rule gradient of Q=k^2-l or C=k^3-l*m and a one-pixel linear coverage ramp.
 * sign chooses the accepted side. This is a boundary evaluator, not a license
 * to alpha-blend overlapping path patches individually. */
SAInkStatus sa_analytic_implicit_evaluate(uint32_t mode, float sign,
                                          const double klm[3],
                                          const double dx[3],
                                          const double dy[3],
                                          SAAnalyticEvaluation *output);
SAInkStatus sa_analytic_path_winding(const SAInkPathCommand *, uint32_t,
                                     const double affine[6], double x, double y,
                                     uint32_t fill, SAAnalyticHit *);
/* Query-only extended command budget (1..4,000,000). Does not enlarge the
 * existing build/mesh or 100,000-command winding contracts. Exact same parser,
 * analytic roots, winding and boundary semantics; caller-owned atomic output,
 * non-overlapping valid aligned buffers. No hidden allocation. */
SAInkStatus sa_analytic_path_winding_extended(const SAInkPathCommand *,
                                              uint32_t, const double affine[6],
                                              double x, double y, uint32_t fill,
                                              uint32_t max_commands,
                                              SAAnalyticHit *);
SAInkStatus sa_analytic_patch_winding(const SAAnalyticPatch *,
                                      const SAAnalyticVertex *,
                                      uint32_t vertex_count, double x, double y,
                                      SAAnalyticHit *);
SAInkStatus sa_analytic_mesh_winding(const SAAnalyticPatch *,
                                     uint32_t patch_count,
                                     const SAAnalyticVertex *,
                                     uint32_t vertex_count, double x, double y,
                                     uint32_t fill, SAAnalyticHit *);
#ifdef __cplusplus
}
#endif
#endif
