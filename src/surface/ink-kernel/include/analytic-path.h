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
typedef struct {
  float x, y, k, l, m;
} SAAnalyticVertex;
typedef struct {
  double origin[2];
  double controls[8];
  double parameter_start, parameter_end;
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
typedef struct {
  uint32_t max_commands, max_patches, max_depth, reserved;
} SAAnalyticBudget;

uint32_t sa_analytic_abi_version(void);
uint32_t sa_analytic_sizeof_patch(void);
uint32_t sa_analytic_sizeof_vertex(void);
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
SAInkStatus sa_analytic_bezier_evaluate(const double *controls, uint32_t degree,
                                        double t, SAInkPoint *position,
                                        SAInkPoint *derivative);
SAInkStatus sa_analytic_curve_evaluate(const double controls[8], double t,
                                       SAInkPoint *position,
                                       SAInkPoint *derivative);
SAInkStatus sa_analytic_implicit_evaluate(uint32_t mode, float sign,
                                          const double klm[3],
                                          const double dx[3],
                                          const double dy[3],
                                          SAAnalyticEvaluation *output);
SAInkStatus sa_analytic_path_winding(const SAInkPathCommand *, uint32_t,
                                     const double affine[6], double x, double y,
                                     uint32_t fill, SAAnalyticHit *);
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
