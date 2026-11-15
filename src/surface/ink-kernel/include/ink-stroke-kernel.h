#ifndef SHOWAI_INK_STROKE_KERNEL_H
#define SHOWAI_INK_STROKE_KERNEL_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif

#define SA_INK_STROKE_GEOMETRY_VERSION 1u
typedef struct {
  double controls[8], radius[2];
  uint32_t degree, reserved;
} SAInkStrokeSegment;
typedef struct {
  double tolerance;
  uint32_t geometry_version, max_depth, max_leaves, max_commands;
} SAInkStrokeOptions;
typedef struct {
  double source_width, width;
  uint32_t pressure, reserved;
} SAInkStrokeStyle;
typedef struct {
  uint32_t commands, contours, envelope_curves, fallback_leaves;
  uint32_t sampled_checks, leaves, maximum_depth, fallback_contours;
  double sampled_envelope_error, fallback_center_bound, arc_error_bound;
} SAInkStrokeResult;

uint32_t sa_stroke_geometry_version(void);
uint32_t sa_stroke_sizeof_segment(void);
uint32_t sa_stroke_sizeof_options(void);
uint32_t sa_stroke_sizeof_style(void);
uint32_t sa_stroke_sizeof_result(void);
SAInkStatus sa_stroke_path_counts(const SAInkStrokeSegment *, uint32_t,
                                  const SAInkStrokeOptions *,
                                  SAInkStrokeResult *);
SAInkStatus sa_stroke_path_build(const SAInkStrokeSegment *, uint32_t,
                                 const SAInkStrokeOptions *, SAInkPathCommand *,
                                 uint32_t capacity, SAInkStrokeResult *);
SAInkStatus sa_stroke_resolve_segments(const SAInkStrokeSegment *, uint32_t,
                                       const SAInkStrokeStyle *,
                                       SAInkStrokeSegment *, uint32_t capacity);
typedef struct {
  uint32_t points, contours;
  SAInkBounds bounds;
} SAInkStrokePathMeasure;
uint32_t sa_stroke_sizeof_path_measure(void);
SAInkStatus sa_stroke_path_bounds(const SAInkPathCommand *, uint32_t,
                                  const double affine[6], SAInkBounds *);
SAInkStatus sa_stroke_path_measure(const SAInkPathCommand *, uint32_t,
                                   const double affine[6], double tolerance,
                                   uint32_t max_points,
                                   SAInkStrokePathMeasure *);
SAInkStatus sa_stroke_path_flatten(const SAInkPathCommand *, uint32_t,
                                   const double affine[6], double tolerance,
                                   uint32_t max_points, SAInkPoint *,
                                   uint32_t point_capacity, SAInkContour *,
                                   uint32_t contour_capacity,
                                   SAInkStrokePathMeasure *);
SAInkStatus sa_stroke_path_query(const SAInkPathCommand *, uint32_t,
                                 const double affine[6], double x, double y,
                                 double tolerance, uint32_t max_points,
                                 SAInkHit *);
#ifdef __cplusplus
}
#endif
#endif
