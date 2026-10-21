#include "include/ink-stroke-kernel.h"
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

static int contract() {
  SAInkStrokeSegment s{};
  s.degree = 3;
  s.controls[2] = 30;
  s.controls[3] = 80;
  s.controls[4] = 70;
  s.controls[5] = -80;
  s.controls[6] = 100;
  s.radius[0] = s.radius[1] = 2;
  SAInkStrokeOptions o{.02, 1, 20, 100000, 1000000};
  SAInkStrokeResult result;
  std::memset(&result, 0x5a, sizeof(result));
  const auto before = result;
  SAInkPathCommand commands[256];
  std::memset(commands, 0x5b, sizeof(commands));
  unsigned char saved[sizeof(commands)];
  std::memcpy(saved, commands, sizeof(commands));
  auto unchanged = [&] {
    return !std::memcmp(&before, &result, sizeof(result)) &&
           !std::memcmp(saved, commands, sizeof(commands));
  };
  auto bad = s;
  bad.reserved = 1;
  if (sa_stroke_path_build(&bad, 1, &o, commands, 256, &result) !=
          SA_INK_INVALID ||
      !unchanged())
    return 1;
  if (sa_stroke_path_build(&s, 1, &o, commands, 0, &result) !=
          SA_INK_CAPACITY ||
      !unchanged())
    return 2;
  auto tiny = o;
  tiny.max_leaves = 1;
  if (sa_stroke_path_build(&s, 1, &tiny, commands, 256, &result) !=
          SA_INK_CAPACITY ||
      !unchanged())
    return 3;
  auto point = s;
  point.degree = 0;
  if (sa_stroke_path_counts(&point, 1, &o, &result) != SA_INK_INVALID ||
      !unchanged())
    return 4;
  if (sa_stroke_path_counts(
          reinterpret_cast<const SAInkStrokeSegment *>(UINTPTR_MAX - 16), 1, &o,
          &result) != SA_INK_INVALID ||
      !unchanged())
    return 5;
  alignas(8) unsigned char alias[4096]{};
  std::memcpy(alias, &s, sizeof(s));
  unsigned char original[4096];
  std::memcpy(original, alias, sizeof(alias));
  if (sa_stroke_path_build(reinterpret_cast<SAInkStrokeSegment *>(alias), 1, &o,
                           reinterpret_cast<SAInkPathCommand *>(alias), 64,
                           &result) != SA_INK_INVALID ||
      std::memcmp(alias, original, sizeof(alias)) || !unchanged())
    return 6;
  if (sa_stroke_path_build(&s, 1, &o, commands, 256,
                           reinterpret_cast<SAInkStrokeResult *>(commands)) !=
          SA_INK_INVALID ||
      !unchanged())
    return 7;
  auto invalid = o;
  invalid.geometry_version = 2;
  if (sa_stroke_path_counts(&s, 1, &invalid, &result) != SA_INK_INVALID ||
      !unchanged())
    return 8;
  if (sa_stroke_path_counts(reinterpret_cast<SAInkStrokeSegment *>(alias + 1),
                            1, &o, &result) != SA_INK_INVALID ||
      !unchanged())
    return 9;
  if (sa_stroke_path_build(&s, 1, &o,
                           reinterpret_cast<SAInkPathCommand *>(alias + 1), 64,
                           &result) != SA_INK_INVALID ||
      !unchanged())
    return 10;
  return 0;
}
int main(int argc, char **argv) {
  if (argc > 1 && std::strcmp(argv[1], "--style") == 0) {
    uint32_t n;
    if (std::fread(&n, 4, 1, stdin) != 1 || n > 100000)
      return 1;
    SAInkStrokeStyle style;
    if (std::fread(&style, sizeof(style), 1, stdin) != 1)
      return 2;
    std::vector<SAInkStrokeSegment> input(n), output(n);
    if (n &&
        std::fread(input.data(), sizeof(SAInkStrokeSegment), n, stdin) != n)
      return 3;
    uint32_t status =
        sa_stroke_resolve_segments(input.data(), n, &style, output.data(), n);
    std::fwrite(&status, 4, 1, stdout);
    if (status == SA_INK_OK && n)
      std::fwrite(output.data(), sizeof(SAInkStrokeSegment), n, stdout);
    return 0;
  }
  if (argc > 1)
    return contract();
  uint32_t count;
  if (std::fread(&count, sizeof(count), 1, stdin) != 1 || count > 100000)
    return 1;
  SAInkStrokeOptions options;
  if (std::fread(&options, sizeof(options), 1, stdin) != 1)
    return 2;
  std::vector<SAInkStrokeSegment> segments(count);
  if (count && std::fread(segments.data(), sizeof(SAInkStrokeSegment), count,
                          stdin) != count)
    return 3;
  SAInkStrokeResult result{};
  auto status =
      sa_stroke_path_counts(segments.data(), count, &options, &result);
  std::vector<SAInkPathCommand> commands(status == SA_INK_OK ? result.commands
                                                             : 0);
  if (status == SA_INK_OK)
    status =
        sa_stroke_path_build(segments.data(), count, &options, commands.data(),
                             uint32_t(commands.size()), &result);
  uint32_t value = status;
  std::fwrite(&value, sizeof(value), 1, stdout);
  std::fwrite(&result, sizeof(result), 1, stdout);
  if (status == SA_INK_OK && !commands.empty())
    std::fwrite(commands.data(), sizeof(SAInkPathCommand), commands.size(),
                stdout);
  return 0;
}
