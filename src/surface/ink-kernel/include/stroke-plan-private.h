#ifndef SHOWAI_STROKE_PLAN_PRIVATE_H
#define SHOWAI_STROKE_PLAN_PRIVATE_H
#include "ink-stroke-kernel.h"
#ifdef __cplusplus
extern "C" {
#endif
// Native implementation submodule only, never a WASM export/public C skip API.
// Caller owns immutable packed source/options throughout this state lifetime.
// Fresh state storage must be zeroed, 16-byte aligned, and stay at the same
// address until destroy. A copied state is not a second initialized owner.
// initialize always validates/counts; no external count or normalized
// assertion.
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
