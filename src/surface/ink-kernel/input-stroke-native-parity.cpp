#include "include/ink-input-kernel.h"
#include <cstdio>
#include <cstring>
#include <vector>
static bool emit(const void *state) {
  uint32_t count = 0;
  if (sa_input_stroke_segment_count(state, &count) != SA_INK_OK)
    return false;
  std::vector<SAInkInputStrokeSegment> segments(count);
  if (sa_input_copy_stroke_segments(state, 0, count, segments.data(), count) !=
      SA_INK_OK)
    return false;
  std::fwrite(&count, 4, 1, stdout);
  if (count)
    std::fwrite(segments.data(), sizeof(SAInkInputStrokeSegment), count,
                stdout);
  return true;
}
int main() {
  uint32_t n, predicted, correction;
  if (std::fread(&n, 4, 1, stdin) != 1 ||
      std::fread(&predicted, 4, 1, stdin) != 1 ||
      std::fread(&correction, 4, 1, stdin) != 1 || !n || n > 100000 ||
      predicted > 128)
    return 1;
  SAInkInputConfig config;
  if (std::fread(&config, sizeof(config), 1, stdin) != 1)
    return 2;
  std::vector<SAInkInputPoint> points(n + predicted + (correction ? 1 : 0));
  if (std::fread(points.data(), sizeof(SAInkInputPoint), points.size(),
                 stdin) != points.size())
    return 3;
  uint32_t bytes = sa_input_state_bytes(n + predicted + 4);
  std::vector<uint64_t> memory((bytes + 7) / 8);
  void *state = memory.data();
  if (sa_input_initialize(state, bytes, n + predicted + 4, &config) !=
      SA_INK_OK)
    return 4;
  for (uint32_t i = 0; i < n; i += 4) {
    uint32_t take = n - i > 4 ? 4 : n - i;
    if (sa_input_push(state, points.data() + i, take,
                      i + take == n ? points.data() + n : nullptr,
                      i + take == n ? predicted : 0) != SA_INK_OK)
      return 5;
  }
  if (!emit(state) || sa_input_finish(state) != SA_INK_OK)
    return 6;
  if (correction && sa_input_correct(state, &points.back()) != SA_INK_OK)
    return 7;
  std::vector<unsigned char> before(bytes);
  std::memcpy(before.data(), state, bytes);
  if (sa_input_copy_filtered(state, 0, 1,
                             reinterpret_cast<SAInkSample *>(state),
                             1) != SA_INK_INVALID ||
      std::memcmp(before.data(), state, bytes))
    return 8;
  if (sa_input_copy_stroke_segments(
          state, 0, 1, reinterpret_cast<SAInkInputStrokeSegment *>(state), 1) !=
          SA_INK_INVALID ||
      std::memcmp(before.data(), state, bytes))
    return 9;
  std::vector<SAInkSample> filtered(n);
  if (sa_input_copy_filtered(state, 0, n, filtered.data(), n) != SA_INK_OK)
    return 10;
  std::fwrite(&n, 4, 1, stdout);
  std::fwrite(filtered.data(), sizeof(SAInkSample), n, stdout);
  if (!emit(state))
    return 11;
  return 0;
}
