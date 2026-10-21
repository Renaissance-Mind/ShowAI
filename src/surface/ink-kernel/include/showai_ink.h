#ifndef SHOWAI_INK_H
#define SHOWAI_INK_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define SA_INK_ABI_VERSION 1u
#define SA_INK_MAX_SAMPLES 20000u
#define SA_INK_MAX_MASK_COMMANDS 100000u

typedef enum { SA_INK_OK = 0, SA_INK_INVALID = 1, SA_INK_CAPACITY = 2, SA_INK_RANGE = 3 } SAInkStatus;
typedef enum { SA_INK_PEN = 0, SA_INK_MARKER = 1, SA_INK_PENCIL = 2, SA_INK_MONOLINE = 3 } SAInkBrush;
typedef enum { SA_INK_MOVE = 0, SA_INK_LINE = 1, SA_INK_QUAD = 2, SA_INK_CUBIC = 3, SA_INK_CLOSE = 4 } SAInkPathOperation;

typedef struct { double x, y; } SAInkPoint;
typedef struct { float x, y; } SAInkVertex;
typedef struct { double values[9]; } SAInkSample;
typedef struct { double source_width, width; uint32_t brush, pressure; double affine[6]; } SAInkStyle;
typedef struct { uint32_t offset, count; } SAInkContour;
typedef struct { uint32_t points, contours, vertices; } SAInkCounts;
typedef struct { double x, y, width, height; } SAInkBounds;
typedef struct { uint32_t operation, reserved; double values[6]; } SAInkPathCommand;
typedef struct { uint32_t inside, reserved; double distance; } SAInkHit;

uint32_t sa_ink_abi_version(void);
/* Offsets expose POD layout to WebAssembly hosts without compiler assumptions. */
uint32_t sa_ink_sizeof_sample(void);
uint32_t sa_ink_sizeof_style(void);
uint32_t sa_ink_sizeof_command(void);
uint32_t sa_ink_sizeof_hit(void);

/* All buffers belong to the caller. Errors never return partial geometry.
 * A range emits each sample ellipse followed by its preceding segment quad,
 * including the segment crossing start-1 -> start when start is nonzero. */
SAInkStatus sa_ink_geometry_counts(const SAInkSample *samples, uint32_t sample_count,
                                 uint32_t start, uint32_t length, SAInkCounts *counts);
SAInkStatus sa_ink_resolve_samples(const SAInkSample *samples, uint32_t sample_count,
                                 const SAInkStyle *style, SAInkSample *output, uint32_t capacity);
SAInkStatus sa_ink_build(const SAInkSample *samples, uint32_t sample_count,
                        uint32_t start, uint32_t length, const SAInkStyle *style,
                        SAInkPoint *points, uint32_t point_capacity,
                        SAInkContour *contours, uint32_t contour_capacity,
                        SAInkVertex *vertices, uint32_t vertex_capacity,
                        SAInkBounds *bounds);
/* Bounds match portableInkBounds: sample ellipses, minimum dimension 1.
 * Bridge quads and masks do not change this persisted-layout definition. */
SAInkStatus sa_ink_bounds(const SAInkSample *samples, uint32_t sample_count,
                         const SAInkStyle *style, SAInkBounds *bounds);

/* Mask commands remain authoritative and separately stencil-renderable. This
 * flattening matches v1 browser hit testing (32 steps per quadratic/cubic). */
SAInkStatus sa_ink_mask_counts(const SAInkPathCommand *commands, uint32_t command_count, SAInkCounts *counts);
SAInkStatus sa_ink_flatten_mask(const SAInkPathCommand *commands, uint32_t command_count,
                               const double *affine, SAInkPoint *points, uint32_t point_capacity,
                               SAInkContour *contours, uint32_t contour_capacity);
/* A null mask_contours pointer means no mask. A non-null empty mask clips all. */
SAInkStatus sa_ink_hit(const SAInkPoint *points, uint32_t point_count,
                     const SAInkContour *contours, uint32_t contour_count,
                     const SAInkPoint *mask_points, uint32_t mask_point_count,
                     const SAInkContour *mask_contours, uint32_t mask_contour_count,
                     double x, double y, SAInkHit *hit);
/* Exact capsule hit against retained polygons intersected with a nonzero mask.
 * scratch holds mask/paint edge crossing parameters (mask_points+points+2);
 * required capacity is reported; no fixed subdivision of fast eraser motion. */
SAInkStatus sa_ink_segment_hit(const SAInkPoint *points, uint32_t point_count,
                             const SAInkContour *contours, uint32_t contour_count,
                             const SAInkPoint *mask_points, uint32_t mask_point_count,
                             const SAInkContour *mask_contours, uint32_t mask_contour_count,
                             double x0, double y0, double x1, double y1, double radius,
                             double *scratch, uint32_t scratch_capacity, uint32_t *required_scratch, uint32_t *hit);
#ifdef __cplusplus
}
#endif
#endif
