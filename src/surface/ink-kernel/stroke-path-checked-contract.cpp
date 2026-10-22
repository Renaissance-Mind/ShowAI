// Actual private factory contract. Product modules never export this test.
#include "stroke-path-checked.hpp"
#if !defined(__wasm__)
#include "include/stroke-plan-private.h"
#endif
#ifdef SHOWAI_STROKE_NATIVE_MAIN
#include <cstdio>
#include <type_traits>
static_assert(
    !std::is_copy_constructible<showai_stroke_internal::EmissionPlan>::value);
#endif
using namespace showai_stroke_internal;
namespace {
SAInkPathCommand commands[16384], expected[16384];
bool same(const void *a, const void *b, uint32_t n) {
  auto *x = (const unsigned char *)a, *y = (const unsigned char *)b;
  for (uint32_t i = 0; i < n; i++)
    if (x[i] != y[i])
      return false;
  return true;
}
void copy(void *a, const void *b, uint32_t n) {
  auto *x = (unsigned char *)a;
  auto *y = (const unsigned char *)b;
  for (uint32_t i = 0; i < n; i++)
    x[i] = y[i];
}
} // namespace
extern "C" uint32_t checked_stroke_contract() {
  SAInkStrokeSegment source{};
  source.degree = 3;
  source.controls[2] = 30;
  source.controls[3] = 80;
  source.controls[4] = 70;
  source.controls[5] = -80;
  source.controls[6] = 100;
  source.radius[0] = source.radius[1] = 2;
  SAInkStrokeOptions options{.02, 1, 20, 100000, 1000000};
  reset_walk_work();
  const EmissionPlan plan(&source, 1, &options);
  SAInkStrokeResult actual{}, counts{};
  if (plan.status() || plan.counts(&counts) || !counts.commands ||
      counts.commands > 16384 || walk_work().counts != 1 ||
      walk_work().emissions)
    return 1;
  actual.commands = 42;
  const auto sentinel = actual;
  const auto before = commands[0];
  if (plan.emit(commands, counts.commands - 1, &actual) != SA_INK_CAPACITY ||
      !same(&actual, &sentinel, sizeof actual) ||
      !same(commands, &before, sizeof before) || walk_work().emissions)
    return 2;
  if (plan.emit((SAInkPathCommand *)&source, 16384, &actual) !=
          SA_INK_INVALID ||
      walk_work().emissions)
    return 3;
  if (plan.emit((SAInkPathCommand *)&options, 16384, &actual) !=
          SA_INK_INVALID ||
      walk_work().emissions)
    return 4;
  if (plan.emit(commands, 16384, (SAInkStrokeResult *)&source) !=
          SA_INK_INVALID ||
      walk_work().emissions)
    return 5;
  if (plan.emit(commands, 16384, (SAInkStrokeResult *)&options) !=
          SA_INK_INVALID ||
      walk_work().emissions)
    return 6;
  if (plan.emit(commands, 16384, (SAInkStrokeResult *)commands) !=
          SA_INK_INVALID ||
      walk_work().emissions)
    return 7;
  if (plan.emit(commands, 16384, &actual) ||
      !same(&actual, &counts, sizeof actual) || walk_work().counts != 1 ||
      walk_work().emissions != 1)
    return 8;
  copy(expected, commands, counts.commands * sizeof(*commands));
  if (plan.emit(commands, 16384, &actual) || walk_work().counts != 1 ||
      walk_work().emissions != 2 ||
      !same(expected, commands, counts.commands * sizeof(*commands)))
    return 9;
  reset_walk_work();
  if (sa_stroke_path_build(&source, 1, &options, commands, 16384, &actual) ||
      !same(&actual, &counts, sizeof counts) ||
      !same(expected, commands, counts.commands * sizeof(*commands)) ||
      walk_work().counts != 1 || walk_work().emissions != 1)
    return 10;
  reset_walk_work();
  if (sa_stroke_path_counts(&source, 1, &options, &actual) ||
      sa_stroke_path_build(&source, 1, &options, commands, 16384, &actual) ||
      walk_work().counts != 2 || walk_work().emissions != 1)
    return 11;
  auto bad = source;
  bad.reserved = 1;
  reset_walk_work();
  actual = sentinel;
  if (sa_stroke_path_build(&bad, 1, &options, commands, 16384, &actual) !=
          SA_INK_INVALID ||
      !same(&actual, &sentinel, sizeof actual) || walk_work().emissions)
    return 12;
  auto tiny = options;
  tiny.max_leaves = 1;
  actual = sentinel;
  if (sa_stroke_path_build(&source, 1, &tiny, commands, 16384, &actual) !=
          SA_INK_CAPACITY ||
      !same(&actual, &sentinel, sizeof actual) || walk_work().emissions)
    return 13;
#if !defined(__wasm__)
  alignas(16) unsigned char state[1024]{}, cloned[1024]{};
  const auto bytes = showai_private_stroke_plan_bytes();
  if (bytes > sizeof state)
    return 14;
  reset_walk_work();
  if (showai_private_stroke_plan_initialize(state, bytes, &source, 1,
                                            &options) ||
      showai_private_stroke_plan_counts(state, &actual) ||
      walk_work().counts != 1 || walk_work().emissions)
    return 15;
  copy(cloned, state, bytes);
  if (showai_private_stroke_plan_counts(cloned, &actual) != SA_INK_INVALID)
    return 16;
  if (showai_private_stroke_plan_initialize(state, bytes, &bad, 1, &options) !=
      SA_INK_INVALID)
    return 17;
  if (showai_private_stroke_plan_counts(state, (SAInkStrokeResult *)state) !=
      SA_INK_INVALID)
    return 18;
  if (showai_private_stroke_plan_build(state, (SAInkPathCommand *)state, 1,
                                       &actual) != SA_INK_INVALID)
    return 19;
  actual = {};
  actual.commands = 1; // A caller's modified summary cannot authorize emit.
  if (showai_private_stroke_plan_build(state, commands, actual.commands,
                                       &actual) != SA_INK_CAPACITY ||
      walk_work().emissions)
    return 20;
  if (showai_private_stroke_plan_build(state, commands, 16384, &actual) ||
      !same(&actual, &counts, sizeof counts) ||
      !same(expected, commands, counts.commands * sizeof(*commands)) ||
      walk_work().counts != 1 || walk_work().emissions != 1)
    return 21;
  if (showai_private_stroke_plan_destroy(state) ||
      showai_private_stroke_plan_counts(state, &actual) != SA_INK_INVALID ||
      showai_private_stroke_plan_destroy(state) != SA_INK_INVALID)
    return 22;
#endif
  return 0;
}
#ifdef SHOWAI_STROKE_NATIVE_MAIN
int main() {
  auto status = checked_stroke_contract();
  printf("CHECKED_STROKE status=%u new=count1+emit1 old=count2+emit1 "
         "public=count1+emit1\n",
         status);
  return status;
}
#endif
