#ifndef SHOWAI_STROKE_PLAN_PRIVATE_H
#define SHOWAI_STROKE_PLAN_PRIVATE_H
#include "ink-stroke-kernel.h"
#ifdef __cplusplus
extern "C" {
#endif
__attribute__((visibility("default"))) SAInkStatus
showai_private_stroke_prepare_scratch(const SAInkStrokeSegment *, uint32_t,
                                     const SAInkStrokeOptions *,
                                     SAInkPathCommand *, uint32_t,
                                     SAInkStrokeResult *);
__attribute__((visibility("default"))) uint32_t
showai_private_stroke_plan_bytes(void);
__attribute__((visibility("default"))) SAInkStatus
showai_private_stroke_plan_initialize(void *, uint32_t,
                                      const SAInkStrokeSegment *, uint32_t,
                                      const SAInkStrokeOptions *);
__attribute__((visibility("default"))) SAInkStatus
showai_private_stroke_plan_counts(const void *, SAInkStrokeResult *);
__attribute__((visibility("default"))) SAInkStatus
showai_private_stroke_plan_build(const void *, SAInkPathCommand *, uint32_t,
                                 SAInkStrokeResult *);
__attribute__((visibility("default"))) SAInkStatus
showai_private_stroke_plan_destroy(void *);
#ifdef __cplusplus
}
#endif
#endif
