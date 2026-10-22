#include "native-parity-stdio.hpp"
// Test executable only: libc/vector are not dependencies of the kernel.
#include "include/analytic-path.h"
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>
static bool read(void *p, size_t n) { return std::fread(p, 1, n, stdin) == n; }
static void write(const void *p, size_t n) {
  if (std::fwrite(p, 1, n, stdout) != n)
    std::abort();
}
int main() {
  sa_test_binary_stdio();
  uint32_t header[3];
  double affine[6];
  SAAnalyticBudget budget;
  if (!read(header, sizeof(header)) || !read(affine, sizeof(affine)) ||
      !read(&budget, sizeof(budget)) || header[0] > 100000 ||
      header[1] > 100000)
    return 2;
  std::vector<SAInkPathCommand> commands(header[0]);
  std::vector<SAInkPoint> points(header[1]);
  if (!read(commands.data(), commands.size() * sizeof(commands[0])) ||
      !read(points.data(), points.size() * sizeof(points[0])))
    return 2;
  SAAnalyticCounts counts = {};
  SAInkStatus status = sa_analytic_path_counts(
      commands.data(), (uint32_t)commands.size(), affine, &budget, &counts);
  uint32_t prefix[4] = {(uint32_t)status, sizeof(SAAnalyticPatch),
                        sizeof(SAAnalyticVertex), 0};
  write(prefix, sizeof(prefix));
  if (status != SA_INK_OK)
    return 0;
  std::vector<SAAnalyticPatch> patches(counts.patches);
  std::vector<SAAnalyticVertex> vertices(counts.vertices);
  status =
      sa_analytic_path_build(commands.data(), (uint32_t)commands.size(), affine,
                             &budget, patches.data(), counts.patches,
                             vertices.data(), counts.vertices, &counts);
  if (status != SA_INK_OK)
    return 3;
  write(&counts, sizeof(counts));
  write(patches.data(), patches.size() * sizeof(patches[0]));
  write(vertices.data(), vertices.size() * sizeof(vertices[0]));
  for (auto p : points) {
    SAAnalyticHit a = {}, b = {};
    if (sa_analytic_path_winding(commands.data(), (uint32_t)commands.size(),
                                 affine, p.x, p.y, header[2],
                                 &a) != SA_INK_OK ||
        sa_analytic_mesh_winding(patches.data(), counts.patches,
                                 vertices.data(), counts.vertices, p.x, p.y,
                                 header[2], &b) != SA_INK_OK)
      return 4;
    write(&a, sizeof(a));
    write(&b, sizeof(b));
  }
  return 0;
}
