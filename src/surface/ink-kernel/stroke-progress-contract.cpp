// Real internal arithmetic contract, compiled only by the kernel test target.
// Including the implementation avoids adding a production diagnostic ABI.
#include "ink-stroke-kernel.cpp"
#include <cstdio>
static void require(bool value, const char *message) {
  if (!value) {
    std::fprintf(stderr, "%s\n", message);
    __builtin_trap();
  }
}
int main() {
  const double tiny = 0x0.0000000000001p-1022, normal = 0x1p-1022,
               largest = 0x1.fffffffffffffp1023;
  require(progressStep(0, true) == tiny, "positive zero outward");
  require(progressStep(-0.0, false) == -tiny, "negative zero outward");
  require(progressStep(tiny, false) == 0, "minimum subnormal predecessor");
  require(progressStep(-tiny, true) == 0 &&
              __builtin_signbit(progressStep(-tiny, true)),
          "negative subnormal successor");
  require(progressStep(normal, false) == 0x0.fffffffffffffp-1022,
          "normal/subnormal boundary");
  require(!finite(progressStep(largest, true)) &&
              !finite(progressStep(-largest, false)),
          "overflow cannot certify positive finite bounds");
  auto underflow = progressMultiply(progressPoint(tiny), progressPoint(.5));
  require(underflow.lo <= 0 && underflow.hi >= tiny,
          "underflow encloses exact half-subnormal");
  auto cancellation = progressAdd(progressPoint(1), progressPoint(-1));
  require(cancellation.lo <= 0 && cancellation.hi >= 0,
          "exact cancellation enclosure");
  Curve straight{{{0, 0}, {.25, 0}, {1.5, 0}, {2, 0}}, 1.75, 1.75, 3};
  require(certifiedProgress(straight),
          "tangential acceleration is not curvature");
  Curve curved{{{0, 0}, {1, 1}, {2, 0}, {}}, .8, .8, 2};
  require(certifiedProgress(curved), "strictly unfolded quadratic");
  curved.r0 = curved.r1 = 1;
  require(!certifiedProgress(curved),
          "zero progress must not satisfy strict positivity");
  curved.r0 = curved.r1 = 1.2;
  require(!certifiedProgress(curved), "actual fold rejected");
  ProgressInterval zero = progressPoint(0), positive = progressPoint(1);
  uint32_t budget = 0;
  require(!progressPositive(&positive, 0, 0, budget),
          "proof budget exhausted fallback");
  budget = 64;
  require(!progressPositive(&zero, 0, 0, budget),
          "zero polynomial is not positive");
  require(gradualBinary64(), "normal host binary64 underflow mode");
#if defined(__aarch64__) || defined(__arm64__)
  uint64_t saved;
  __asm__ volatile("mrs %0, fpcr" : "=r"(saved));
  uint64_t flush = saved | (uint64_t(1) << 24);
  __asm__ volatile("msr fpcr, %0" ::"r"(flush) : "memory");
  SAInkStrokeSegment source{};
  source.radius[0] = source.radius[1] = 1;
  SAInkStrokeOptions options{.0025, 1, 20, 100000, 1000000};
  SAInkStrokeResult output{};
  output.commands = 0x5a5a5a5a;
  auto before = output;
  auto status = sa_stroke_path_counts(&source, 1, &options, &output);
  __asm__ volatile("msr fpcr, %0" ::"r"(saved) : "memory");
  require(status == SA_INK_RANGE &&
              !__builtin_memcmp(&before, &output, sizeof(output)),
          "FTZ rejects proofs atomically and preserves caller output");
  require(gradualBinary64(), "host FPCR restored");
#endif
  std::puts("STROKE_PROGRESS_INTERVAL_CONTRACT_OK");
}
