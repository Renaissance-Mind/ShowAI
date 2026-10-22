#ifndef SHOWAI_COVERAGE_KERNEL_H
#define SHOWAI_COVERAGE_KERNEL_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif

/* Derived-only, serial build workspace. Copy the actual result into admitted
 * immutable host storage before reusing/destroying this workspace. Editable
 * commands and worker/source authority remain in the host; generation is an
 * echo, not a substitute for that authority. Matrices use [a,b,c,d]. */
typedef struct {
  double maximum_forward_norm, maximum_inverse_norm, maximum_geometry_error_pixels;
  uint32_t maximum_commands, maximum_patches, maximum_vertices, maximum_draws;
  uint32_t maximum_analytic_depth, reserved;
} SACoverageOptions;
typedef struct {
  uint64_t maximum_polynomial_operations, maximum_limb_operations;
  uint32_t retained_bytes, workspace_bytes;
  SACoverageOptions geometry;
} SACoverageBudget;
typedef struct { uint64_t owner; uint32_t epoch, revision; } SACoverageReceipt;
typedef struct { float x,y,pad0,pad1,k,l,m,pad2; } SACoverageVertex;
typedef struct {
  double origin[2]; uint32_t first,count,source_edge,kind;
  double float_cast_error_pixels;
} SACoverageDraw;
typedef struct {
  /* Bounds source regularization + Float32 position casting, not KLM
   * residual/gradient, GPU interpolation or final pixel-alpha error. */
  double maximum_forward_norm,maximum_inverse_norm,maximum_geometry_error_pixels;
  double actual_position_error_source,actual_regularization_error_source;
  double maximum_field_value,maximum_field_derivative_source;
  uint64_t absolute_contribution_bound; /* emitted triangles, not actual winding */
  uint32_t regularized_rays,degenerate_triangles;
} SACoverageCertificate;
typedef struct {
  SACoverageReceipt receipt;
  uint64_t source_generation;
  uint32_t vertices,draws,has_bounds,reserved;
  double common_origin[2],bounds[4]; /* conservative source minX,minY,maxX,maxY */
  SACoverageCertificate certificate;
} SACoverageSummary;
typedef struct {
  uint32_t last_status,last_reason;
  uint64_t polynomial_operations,limb_operations,live_bytes,peak_bytes;
  uint64_t backing_bytes,usable_bytes;
} SACoverageDiagnostics;

uint32_t sa_coverage_state_bytes(void);
uint32_t sa_coverage_initialize(void*,uint32_t,uint32_t,void*,uint32_t,const SACoverageBudget*);
uint32_t sa_coverage_prepare(void*,const SAInkPathCommand*,uint32_t,uint64_t,SACoverageReceipt*);
uint32_t sa_coverage_summary(void*,SACoverageReceipt,SACoverageSummary*);
uint32_t sa_coverage_copy_vertices(void*,SACoverageReceipt,SACoverageVertex*,uint32_t);
uint32_t sa_coverage_copy_draws(void*,SACoverageReceipt,SACoverageDraw*,uint32_t);
uint32_t sa_coverage_diagnostics(void*,SACoverageDiagnostics*);
/* This is a numeric query. The host's actual immutable mesh owns its captured
 * certificate; a caller-supplied copy cannot grant source/geometry authority. */
uint32_t sa_coverage_supports(const SACoverageCertificate*,const double[4]);
uint32_t sa_coverage_destroy(void*);
#ifdef __cplusplus
}
#endif
#endif
