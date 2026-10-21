#include "include/analytic-path.h"
#include <cassert>
#include <cstring>
#include <limits>
int main() {
  const double affine[6] = {1, 0, 0, 1, 0, 0};
  SAAnalyticBudget budget = {100000, 1000000, 16, 0};
  SAInkPathCommand commands[3] = {{SA_INK_MOVE, 0, {0, 0}},
                                  {SA_INK_CUBIC, 0, {0, 100, 100, 100, 100, 0}},
                                  {SA_INK_CLOSE, 0, {}}};
  SAAnalyticCounts counts = {91, 92, 93, 94};
  SAAnalyticPatch patches[32];
  SAAnalyticVertex vertices[192];
  std::memset(patches, 0x5a, sizeof(patches));
  std::memset(vertices, 0x61, sizeof(vertices));
  assert(sa_analytic_path_build(commands, 3, affine, &budget, patches, 0,
                                vertices, 0, &counts) == SA_INK_CAPACITY);
  assert(counts.patches == 91);
  for (auto b :
       reinterpret_cast<const unsigned char (&)[sizeof(patches)]>(patches))
    assert(b == 0x5a);
  commands[2].reserved = 1;
  assert(sa_analytic_path_build(commands, 3, affine, &budget, patches, 32,
                                vertices, 192, &counts) == SA_INK_INVALID);
  assert(counts.patches == 91);
  for (auto b :
       reinterpret_cast<const unsigned char (&)[sizeof(vertices)]>(vertices))
    assert(b == 0x61);
  commands[2].reserved = 0;
  assert(sa_analytic_path_build(commands, 3, affine, &budget, patches, 32,
                                reinterpret_cast<SAAnalyticVertex *>(patches),
                                32, &counts) == SA_INK_INVALID);
  budget.max_patches = 1;
  commands[2] = {SA_INK_CUBIC, 0, {100, -100, 0, -100, 0, 0}};
  assert(sa_analytic_path_counts(commands, 3, affine, &budget, &counts) ==
         SA_INK_RANGE);
  assert(counts.patches == 91);
  budget.max_patches = 1000000;
  commands[2] = {SA_INK_CLOSE, 0, {}};
  assert(sa_analytic_path_build(commands, 3, affine, &budget, patches, 32,
                                vertices, 192, &counts) == SA_INK_OK);
  SAAnalyticHit h = {99, 98, 97, 96};
  vertices[0].x = std::numeric_limits<float>::quiet_NaN();
  assert(sa_analytic_mesh_winding(patches, counts.patches, vertices,
                                  counts.vertices, 50, 30, 0,
                                  &h) == SA_INK_INVALID);
  assert(h.winding == 99);
  double k[3] = {.5, .2, .4}, dx[3] = {.3, -.2, .1}, dy[3] = {-.4, .2, .3};
  SAAnalyticEvaluation e = {};
  assert(sa_analytic_implicit_evaluate(SA_ANALYTIC_CUBIC, 1, k, dx, dy, &e) ==
         SA_INK_OK);
  assert(e.value == .5 * .5 * .5 - .2 * .4);
  assert(e.dx == 3 * .5 * .5 * .3 - .4 * (-.2) - .2 * .1);
  assert(e.dy == 3 * .5 * .5 * (-.4) - .4 * .2 - .2 * .3);
  const double collapsed[6] = {1, 2, 2, 4, 0, 0};
  assert(sa_analytic_path_counts(commands, 3, collapsed, &budget, &counts) ==
             SA_INK_OK &&
         counts.patches == 0);
  assert(sa_analytic_path_winding(commands, 3, collapsed, 50, 30, 0, &h) ==
             SA_INK_OK &&
         h.winding == 0);
  double c[8] = {0, 0, 0, 1, 1, 1, 1, 0};
  SAInkPoint p = {}, d = {};
  assert(sa_analytic_bezier_evaluate(c, 3, .5, &p, &d) == SA_INK_OK &&
         p.x == .5 && p.y == .75 && d.x == 1.5 && d.y == 0);
  return 0;
}
