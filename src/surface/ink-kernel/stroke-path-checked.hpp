#ifndef SHOWAI_STROKE_PATH_CHECKED_HPP
#define SHOWAI_STROKE_PATH_CHECKED_HPP
#ifndef SHOWAI_INK_STROKE_KERNEL_H
#include "include/ink-stroke-kernel.h"
#endif
namespace showai_stroke_internal {
#if defined(__wasm__)
#define SHOWAI_STROKE_VISIBILITY "hidden"
#else
#define SHOWAI_STROKE_VISIBILITY "default"
#endif
// Internal factory binding; no caller counts or source/options on emit. The
// Native owner holds one immutable packed allocation/options until destruction.
// Public standalone build uses a synchronous borrow of its existing C inputs.
class __attribute__((visibility(SHOWAI_STROKE_VISIBILITY))) EmissionPlan final {
  const SAInkStrokeSegment *const source_;
  const uint32_t count_;
  const SAInkStrokeOptions *const original_options_;
  SAInkStrokeOptions options_{};
  SAInkStrokeResult required_{};
  SAInkStatus status_;

public:
  EmissionPlan(const SAInkStrokeSegment *, uint32_t,
               const SAInkStrokeOptions *);
  EmissionPlan(const EmissionPlan &) = delete;
  EmissionPlan &operator=(const EmissionPlan &) = delete;
  SAInkStatus status() const { return status_; }
  SAInkStatus counts(SAInkStrokeResult *) const;
  SAInkStatus emit(SAInkPathCommand *, uint32_t, SAInkStrokeResult *) const;
  bool overlaps_input(const void *, uint64_t) const;
};
#undef SHOWAI_STROKE_VISIBILITY
#ifdef SHOWAI_STROKE_WALK_COUNTERS
struct WalkWork {
  uint64_t counts, emissions;
};
void reset_walk_work();
WalkWork walk_work();
#endif
} // namespace showai_stroke_internal
#endif
