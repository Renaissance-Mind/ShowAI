#include "native-parity-stdio.hpp"
#include "include/analytic-path.h"
#include "include/ink-stroke-kernel.h"
#include <cstdio>
#include <cstring>
#include <vector>
static int contract() {
  SAInkPathCommand commands[4]{};
  commands[0].operation = 0;
  commands[1].operation = 1;
  commands[1].values[0] = 10;
  commands[2].operation = 1;
  commands[2].values[1] = 10;
  commands[3].operation = 4;
  double matrix[6]{1, 0, 0, 1, 0, 0};
  SAInkStrokePathMeasure measure;
  std::memset(&measure, 0x5a, sizeof(measure));
  const auto before = measure;
  SAInkPoint points[8];
  SAInkContour contours[2];
  std::memset(points, 0x5b, sizeof(points));
  std::memset(contours, 0x5c, sizeof(contours));
  unsigned char saved[sizeof(points)];
  std::memcpy(saved, points, sizeof(points));
  if (sa_stroke_path_flatten(commands, 4, matrix, .001, 100, points, 1,
                             contours, 2, &measure) != SA_INK_CAPACITY ||
      std::memcmp(&measure, &before, sizeof(measure)) ||
      std::memcmp(points, saved, sizeof(points)))
    return 1;
  if (sa_stroke_path_measure(commands, 4, matrix, .001, 1, &measure) !=
          SA_INK_CAPACITY ||
      std::memcmp(&measure, &before, sizeof(measure)))
    return 2;
  if (sa_stroke_path_measure(commands, 4, matrix, .001, 100,
                             reinterpret_cast<SAInkStrokePathMeasure *>(
                                 commands)) != SA_INK_INVALID)
    return 3;
  commands[2].reserved = 1;
  if (sa_stroke_path_measure(commands, 4, matrix, .001, 100, &measure) !=
          SA_INK_INVALID ||
      std::memcmp(&measure, &before, sizeof(measure)))
    return 4;
  SAInkStrokeSegment segment{};
  segment.degree = 1;
  segment.controls[2] = 10;
  segment.radius[0] = 1;
  segment.radius[1] = 2;
  SAInkStrokeStyle style{2, 4, 1, 0};
  if (sa_stroke_resolve_segments(&segment, 1, &style, &segment, 1) !=
          SA_INK_OK ||
      segment.radius[0] != 2 || segment.radius[1] != 4)
    return 5;
  std::vector<SAInkPathCommand> many(100004);
  commands[2].reserved = 0;
  for (uint32_t i = 0; i < many.size(); i++)
    many[i] = commands[i % 4];
  SAAnalyticHit exact;
  std::memset(&exact, 0x5a, sizeof(exact));
  auto prior = exact;
  if (sa_analytic_path_winding(many.data(), many.size(), matrix, 1, 1,
                               SA_ANALYTIC_NONZERO, &exact) != SA_INK_INVALID ||
      std::memcmp(&exact, &prior, sizeof(exact)))
    return 6;
  if (sa_analytic_path_winding_extended(many.data(), many.size(), matrix, 1, 1,
                                        SA_ANALYTIC_NONZERO, 100000,
                                        &exact) != SA_INK_INVALID ||
      std::memcmp(&exact, &prior, sizeof(exact)))
    return 7;
  if (sa_analytic_path_winding_extended(
          many.data(), many.size(), matrix, 1, 1, SA_ANALYTIC_NONZERO, 4000000,
          reinterpret_cast<SAAnalyticHit *>(many.data())) != SA_INK_INVALID)
    return 8;
  if (sa_analytic_path_winding_extended(
          reinterpret_cast<const SAInkPathCommand *>(UINTPTR_MAX - 8), 1,
          matrix, 1, 1, SA_ANALYTIC_NONZERO, 4000000,
          &exact) != SA_INK_INVALID ||
      std::memcmp(&exact, &prior, sizeof(exact)))
    return 9;
  if (sa_analytic_path_winding_extended(many.data(), many.size(), matrix, 1, 1,
                                        SA_ANALYTIC_NONZERO, 4000000,
                                        &exact) != SA_INK_OK ||
      !exact.inside)
    return 10;
  return 0;
}
int main(int argc, char **) {
  sa_test_binary_stdio();
  if (argc > 1)
    return contract();
  uint32_t n = 0;
  if (std::fread(&n, 4, 1, stdin) != 1 || n > 4000000)
    return 1;
  double matrix[6], tolerance, x, y;
  uint32_t budget;
  if (std::fread(matrix, 48, 1, stdin) != 1 ||
      std::fread(&tolerance, 8, 1, stdin) != 1 ||
      std::fread(&budget, 4, 1, stdin) != 1 ||
      std::fread(&x, 8, 1, stdin) != 1 || std::fread(&y, 8, 1, stdin) != 1)
    return 2;
  std::vector<SAInkPathCommand> commands(n);
  if (n && std::fread(commands.data(), 56, n, stdin) != n)
    return 3;
  SAInkStrokePathMeasure result{};
  SAInkBounds bounds{};
  SAInkHit hit{};
  auto status = sa_stroke_path_measure(commands.data(), n, matrix, tolerance,
                                       budget, &result);
  if (status != SA_INK_OK)
    return 4;
  std::vector<SAInkPoint> points(result.points);
  std::vector<SAInkContour> contours(result.contours);
  if (sa_stroke_path_flatten(commands.data(), n, matrix, tolerance, budget,
                             points.data(), result.points, contours.data(),
                             result.contours, &result) != SA_INK_OK ||
      sa_stroke_path_bounds(commands.data(), n, matrix, &bounds) != SA_INK_OK ||
      sa_stroke_path_query(commands.data(), n, matrix, x, y, tolerance, budget,
                           &hit) != SA_INK_OK)
    return 5;
  std::fwrite(&result, sizeof(result), 1, stdout);
  std::fwrite(&bounds, sizeof(bounds), 1, stdout);
  std::fwrite(&hit, sizeof(hit), 1, stdout);
  if (result.points)
    std::fwrite(points.data(), 16, result.points, stdout);
  if (result.contours)
    std::fwrite(contours.data(), 8, result.contours, stdout);
  return 0;
}
