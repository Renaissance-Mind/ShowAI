#ifndef SHOWAI_ANALYTIC_PATH_CHECKED_HPP
#define SHOWAI_ANALYTIC_PATH_CHECKED_HPP
#ifndef SHOWAI_ANALYTIC_PATH_H
#include "include/analytic-path.h"
#endif

namespace showai_boundary { class RawAnalyticCapture; }
namespace showai_analytic_internal {
/* Internal synchronous borrow, never an exported C capability or caller count.
 * The source span stays immutable/alive for the whole containing factory call;
 * there are no callbacks, awaits, escapes or cross-call cache. Options and the
 * actual validated counts are captured together. Emit cannot rebind any input.
 * Core holds its immutable raw Array through withUnsafeBufferPointer until the
 * complete C prepare returns. Concurrent mutation violates that existing input
 * span contract; this object does not authorize a mutable external snapshot. */
class __attribute__((visibility("hidden"))) CheckedEmissionPlan final {
    const SAInkPathCommand *const commands_;
    const uint32_t count_;
    const double *const original_matrix_;
    const SAAnalyticBudget *const original_budget_;
    double matrix_[6]{};
    SAAnalyticBudget budget_{};
    SAAnalyticCounts required_{};
    SAInkStatus status_;
    CheckedEmissionPlan(const SAInkPathCommand *, uint32_t, const double *,
                        const SAAnalyticBudget *);
    SAInkStatus emit(SAAnalyticPatch *, uint32_t, SAAnalyticVertex *, uint32_t,
                     SAAnalyticCounts *) const;
    CheckedEmissionPlan(const CheckedEmissionPlan &) = delete;
    CheckedEmissionPlan &operator=(const CheckedEmissionPlan &) = delete;
    friend class showai_boundary::RawAnalyticCapture;
    friend SAInkStatus (::sa_analytic_path_build)(const SAInkPathCommand *, uint32_t,
        const double *, const SAAnalyticBudget *, SAAnalyticPatch *, uint32_t,
        SAAnalyticVertex *, uint32_t, SAAnalyticCounts *);
};
#ifdef SHOWAI_ANALYTIC_WALK_COUNTERS
struct WalkWork { uint64_t counts, emissions; };
__attribute__((visibility("hidden"))) void reset_walk_work();
__attribute__((visibility("hidden"))) WalkWork walk_work();
#endif
}
#endif
