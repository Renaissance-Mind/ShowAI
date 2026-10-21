// Actual production implementation in a test TU, with private work counters.
// No replacement geometry, fake state, host service or production ABI is used.
#define SHOWAI_INK_INPUT_EXPORT_WORK
#include "ink-input-kernel.cpp"
#include <cstdio>
#include <cstring>
#include <vector>
int main() {
  for (uint32_t n : {1u, 2u, 1200u, 12000u}) {
    SAInkInputConfig config{4, 1, .2, .1, 0, 0, 0, 0, 0, .25, 1, 1, .2, 1, 1};
    const uint32_t bytes = sa_input_state_bytes(n + 4);
    std::vector<uint64_t> memory((bytes + 7) / 8);
    auto *state = memory.data();
    if (sa_input_initialize(state, bytes, n + 4, &config) != SA_INK_OK)
      return 1;
    std::vector<SAInkInputPoint> points(n);
    for (uint32_t i = 0; i < n; i++)
      points[i] = {i * .8, i % 2 ? 8. : -8., i / 240., .7, 0, 1.5, i + 1, 0, 0,
                   0};
    if (sa_input_push(state, points.data(), n, nullptr, 0) != SA_INK_OK)
      return 2;
    uint32_t count = 0;
    if (sa_input_stroke_segment_count(state, &count) != SA_INK_OK)
      return 3;
    std::vector<SAInkInputStrokeSegment> complete(count);
    if (sa_input_copy_stroke_segments(state, 0, count, complete.data(),
                                      count) != SA_INK_OK)
      return 4;
    const auto *s = reinterpret_cast<const State *>(state);
    SAInkInputSnapshot snapshot{};
    if (sa_input_snapshot(state, &snapshot) != SA_INK_OK)
      return 5;
    uint32_t bound = 0, span = snapshot.curve_count;
    while (span) {
      ++bound;
      span >>= 1;
    }
    std::vector<uint32_t> starts{0, count, count > 8 ? count - 8 : 0};
    for (uint32_t i = 0; i < snapshot.curve_count;
         i += snapshot.curve_count / 9 + 1) {
      const auto &c = curves(s)[i];
      starts.push_back(c.first_raw);
      if (c.last_raw < count)
        starts.push_back(c.last_raw);
    }
    uint64_t worst = 0;
    for (uint32_t start : starts) {
      const uint32_t length = count - start > 8 ? 8 : count - start;
      std::vector<SAInkInputStrokeSegment> suffix(length);
      strokeExportWork = {};
      if (sa_input_copy_stroke_segments(state, start, length, suffix.data(),
                                        length) != SA_INK_OK)
        return 6;
      if (length && std::memcmp(suffix.data(), complete.data() + start,
                                length * sizeof(SAInkInputStrokeSegment)))
        return 7;
      if (strokeExportWork.lookup_comparisons > bound ||
          strokeExportWork.curve_advances > length ||
          strokeExportWork.segments != length)
        return 8;
      if (!length &&
          (strokeExportWork.lookup_comparisons ||
           strokeExportWork.curve_advances || strokeExportWork.segments))
        return 9;
      if (strokeExportWork.lookup_comparisons > worst)
        worst = strokeExportWork.lookup_comparisons;
    }
    strokeExportWork = {};
    const uint32_t start = count > 8 ? count - 8 : 0, length = count - start;
    std::vector<SAInkInputStrokeSegment> tail(length);
    if (sa_input_copy_stroke_segments(state, start, length, tail.data(),
                                      length) != SA_INK_OK)
      return 10;
    std::printf("%u %u %u %llu %llu %llu %llu\n", n, snapshot.curve_count,
                length, (unsigned long long)strokeExportWork.lookup_comparisons,
                (unsigned long long)strokeExportWork.curve_advances,
                (unsigned long long)strokeExportWork.segments,
                (unsigned long long)worst);
  }
  return 0;
}
