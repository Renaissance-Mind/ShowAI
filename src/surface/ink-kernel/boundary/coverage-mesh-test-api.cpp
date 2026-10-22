// Test-only actual Graph -> quantizer -> mesh; no exported production ABI.
#include "coverage-mesh.hpp"
using namespace showai_boundary;
namespace {
inline uint64_t mesh_hash(const BoundaryCoverageMesh&m){uint64_t h=1469598103934665603ull;auto word=[&](uint32_t v){h=(h^v)*1099511628211ull;};auto bytes=[&](const void*p,uint32_t n){const auto*b=(const uint8_t*)p;for(uint32_t i=0;i<n;i++)word(b[i]);};bytes(m.common_origin,16);word(m.source_edges);word(m.conditioned_cells);for(const auto&v:m.vertices)bytes(&v,sizeof(v));for(const auto&d:m.draws){bytes(d.origin,16);word(d.first);word(d.count);word(d.source_edge);word(d.kind);bytes(&d.float_cast_error_pixels,8);}return h;}
}
extern "C" uint32_t sacm_fixture(uint32_t fixture,void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
 if(fixture>12||!memory||!output||capacity<4||((uintptr_t)memory&15)||((uintptr_t)output&3))return SA_INK_INVALID;
 PolynomialContext c;if(!c.numbers.initialize(memory,bytes,1000000000ull))return c.numbers.status;uint32_t final_status=0;
 {
  Vector<SAInkPathCommand>commands(c.numbers);auto cmd=[&](uint32_t op,double a=0,double b=0,double d=0,double e=0,double f=0,double g=0){commands.push_back({op,0,{a,b,d,e,f,g}});};
  auto rect=[&](double x,double y,double X,double Y,bool reverse){cmd(0,x,y);if(reverse){cmd(1,x,Y);cmd(1,X,Y);cmd(1,X,y);}else{cmd(1,X,y);cmd(1,X,Y);cmd(1,x,Y);}cmd(4);};
  uint32_t selected=fixture<7?fixture:0;
  if(selected==0)rect(-20,-12,20,12,false);
  if(selected==1){cmd(0,-16,-8);cmd(2,0,16,16,-8);cmd(4);}
  if(selected==2){cmd(0,-16,-8);cmd(3,-16,16,16,16,16,-8);cmd(4);}
  if(selected==3){rect(-20,-12,20,12,false);rect(-6,-4,6,4,true);}
  if(selected==4||selected==6){rect(-20,-12,4,12,false);rect(-4,-8,20,8,false);}
  if(selected==5){cmd(0,0,-12);cmd(2,16,-12,16,0);cmd(2,16,12,0,12);cmd(2,-16,12,-16,0);cmd(2,-16,-12,0,-12);cmd(4);}
  SABoundaryPath path{selected==4?1u:0u,0,{0,0}};SABoundarySourceBlock source{};source.key.words[0]=123;source.command_count=commands.size();source.affine[0]=source.affine[3]=1;
  SABoundaryBudget budget{};budget.max_commands=64;budget.max_curves=64;budget.max_pairs=1000;budget.max_cuts=512;budget.max_edges=256;budget.max_sources=1;budget.max_paths=1;
  Graph graph(c,budget);capture(graph,&path,1,&source,1,commands.begin(),commands.size());construct(graph);if(!graph.good())return c.numbers.status;
  BoundaryQuantizationOptions qo{};qo.maximum_error_l1=1e-9;qo.maximum_refinements=10000;qo.maximum_vertices=256;qo.maximum_edges=256;BoundaryQuantizedGraph q(c.numbers);auto status=quantize_boundary_graph(graph,qo,q);if(status)return status;
  BoundaryCoverageOptions options{};options.maximum_vertices=4096;options.maximum_draws=1024;options.maximum_edges=256;options.maximum_anchors=256;auto&co=options.conditioning;co.maximum_residual_over_gradient_pixels=0.01;co.maximum_patches=512;co.maximum_vertices=4096;co.maximum_depth=16;co.maximum_conditioning_cells=20000;co.maximum_conditioning_depth=16;
  BoundaryCoverageMesh result(c.numbers);BoundaryKLMReason reason=boundary_klm_none;
  if(fixture>=7){status=build_boundary_coverage_mesh(c,q,options,result,reason);if(status)return status;}
  uint64_t before=mesh_hash(result);
  if(fixture==7)q.edges[0].controls[0]+=0.25;
  if(fixture==8)q.edges.pop_back();
  if(fixture==9)q.vertices[1].vertex=static_cast<const BoundaryQuantizedGraph&>(q).vertices[0].vertex;
  if(fixture==10)options.maximum_vertices=3;
  if(fixture==11)options.maximum_draws=1;
  if(fixture==12)q.edges[0].error_l1=1;
  status=build_boundary_coverage_mesh(c,q,options,result,reason);if(status&&before!=mesh_hash(result))return SA_INK_INVALID;
  uint32_t expected=fixture<7?0:fixture<10?1:fixture<12?2:3;if(status!=expected)return SA_INK_INVALID;
  Vector<uint32_t>encoded(c.numbers);auto u=[&](uint32_t x){encoded.push_back(x);};auto d=[&](double x){uint64_t bits;copy_bytes(&bits,&x,8);u(uint32_t(bits));u(uint32_t(bits>>32));};auto f=[&](float x){uint32_t bits;copy_bytes(&bits,&x,4);u(bits);};
  u(status);u(reason);
  if(!status){u(result.vertices.size());u(result.draws.size());u(result.source_edges);u(result.conditioned_cells);d(result.common_origin[0]);d(result.common_origin[1]);
   for(const auto&v:result.vertices){f(v.x);f(v.y);f(v.pad0);f(v.pad1);f(v.k);f(v.l);f(v.m);f(v.pad2);}
   for(const auto&draw:result.draws){d(draw.origin[0]);d(draw.origin[1]);u(draw.first);u(draw.count);u(draw.source_edge);u(draw.kind);d(draw.float_cast_error_pixels);}
  }
  if(c.numbers.status)return c.numbers.status;if(encoded.size()+1>capacity)return SA_INK_CAPACITY;output[0]=encoded.size();for(uint32_t i=0;i<encoded.size();i++)output[i+1]=static_cast<const Vector<uint32_t>&>(encoded)[i];
 }
 return c.numbers.live_bytes?SA_INK_INVALID:final_status;
}
#include "wasm-runtime.cpp"
