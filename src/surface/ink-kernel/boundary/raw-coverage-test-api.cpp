// Actual original-path factory. No Graph, fake source proof or binary RAY.
#include "raw-coverage.hpp"
using namespace showai_boundary;
namespace {
uint64_t hash(const RawCoverageMesh&m){uint64_t h=1469598103934665603ull;auto bytes=[&](const void*p,uint32_t n){const auto*b=(const uint8_t*)p;for(uint32_t i=0;i<n;i++)h=(h^b[i])*1099511628211ull;};for(const auto&v:m.mesh.vertices)bytes(&v,sizeof v);for(const auto&d:m.mesh.draws)bytes(&d,sizeof d);bytes(&m.certificate,sizeof m.certificate);bytes(&m.source_generation,8);bytes(&m.regularized_curves,4);bytes(m.source_control_bounds,32);return h;}
uint32_t encode(Context&c,const RawCoverageMesh&m,uint32_t status,BoundaryKLMReason reason,uint32_t*output,uint32_t capacity){
 Vector<uint32_t>words(c);auto u=[&](uint32_t x){words.push_back(x);};auto d=[&](double x){uint64_t b;copy_bytes(&b,&x,8);u(b);u(b>>32);};auto f=[&](float x){uint32_t b;copy_bytes(&b,&x,4);u(b);};
 u(status);u(reason);if(!status){u(m.mesh.vertices.size());u(m.mesh.draws.size());u(m.source_generation);u(m.source_generation>>32);for(double x:m.source_control_bounds)d(x);const auto&z=m.certificate;d(z.maximum_forward_norm);d(z.maximum_inverse_norm);d(z.maximum_geometry_error_pixels);d(z.actual_position_error_source);d(z.actual_regularization_error_source);d(z.maximum_field_value);d(z.maximum_field_derivative_source);u(z.absolute_contribution_bound);u(z.absolute_contribution_bound>>32);u(z.regularized_rays);u(z.degenerate_triangles);u(m.regularized_curves);
 for(const auto&v:m.mesh.vertices){f(v.x);f(v.y);f(v.pad0);f(v.pad1);f(v.k);f(v.l);f(v.m);f(v.pad2);}for(const auto&z:m.mesh.draws){d(z.origin[0]);d(z.origin[1]);u(z.first);u(z.count);u(z.source_edge);u(z.kind);d(z.float_cast_error_pixels);}}
 if(c.status)return c.status;if(words.size()+1>capacity)return SA_INK_CAPACITY;output[0]=words.size();for(uint32_t i=0;i<words.size();i++)output[i+1]=static_cast<const Vector<uint32_t>&>(words)[i];return SA_INK_OK;
}
RawCoverageOptions options(){return {256,256,.02,100000,100000,1000000,333333,16,0};}
}
extern "C" uint32_t sarc_build(const SAInkPathCommand*commands,uint32_t count,void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
 if(!memory||!output||capacity<4||((uintptr_t)memory&15)||((uintptr_t)output&3))return SA_INK_INVALID;PolynomialContext c;if(!c.numbers.initialize(memory,bytes,1000000000ull))return c.numbers.status;
 {RawCoverageMesh m(c.numbers);BoundaryKLMReason reason;auto s=build_raw_coverage_mesh(c,commands,count,0x123456780000002aull,options(),m,reason);auto e=encode(c.numbers,m,s,reason,output,capacity);if(e)return e;}return c.numbers.live_bytes?SA_INK_INVALID:SA_INK_OK;
}
extern "C" uint32_t sarc_fixture(uint32_t fixture,void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
 if(fixture>23||!memory||!output||capacity<4||((uintptr_t)memory&15)||((uintptr_t)output&3))return SA_INK_INVALID;PolynomialContext c;if(!c.numbers.initialize(memory,bytes,1000000000ull))return c.numbers.status;
 {Vector<SAInkPathCommand>cmd(c.numbers);auto emit=[&](uint32_t op,double a=0,double b=0,double d=0,double e=0,double f=0,double g=0){cmd.push_back({op,0,{a,b,d,e,f,g}});};auto rect=[&](double x,double y,double X,double Y,bool reverse){emit(0,x,y);if(reverse){emit(1,x,Y);emit(1,X,Y);emit(1,X,y);}else{emit(1,X,y);emit(1,X,Y);emit(1,x,Y);}emit(4);};
 // These exact five-command closed subpaths were captured from actual
 // 6000-contact fixed20/fixed40/pressure40 worker block45. They retain the
 // original binary64 source coordinates; no handwritten near-line fit.
 if(fixture==20){emit(0,1801.8207240395905,39.999999999999979);emit(3,1801.9240520761305,39.999999999999979,1802.0273802627469,39.999999999999993,1802.1307085975125,39.999999999999993);emit(1,1802.1307085975125,59.999999999999993);emit(3,1802.0273802627451,59.999999999999993,1801.9240520761287,59.999999999999979,1801.8207240395905,59.999999999999979);emit(4);}
 else if(fixture==21){emit(0,1823.8311760584311,29.999999999999993);emit(3,1823.9345156963655,29.999999999999993,1824.0378553476248,29.999999999999979,1824.1411950102831,29.999999999999979);emit(1,1824.1411950102831,69.999999999999972);emit(3,1824.0378553476285,69.999999999999972,1823.934515696369,70,1823.8311760584311,70);emit(4);}
 else if(fixture==22){emit(0,1822.5911011659814,25.979999999999976);emit(3,1822.6944406665164,25.979999999999976,1822.7977801880775,25.979999999999993,1822.901119728737,25.979999999999993);emit(1,1822.901119728737,74.019999999999996);emit(3,1822.797780188073,74.019999999999996,1822.6944406665118,74.019999999999982,1822.5911011659814,74.019999999999982);emit(4);}
 else if(fixture==23){emit(0,-16,-8);emit(3,-16,16,16,16,16,-8);emit(4);}
 else if(fixture==19){emit(0,0,0);emit(2,0,1e-17,1e-17,0);emit(4);}
 else if(fixture==18){emit(0,0,0);emit(3,0,1e-17,1e-17,1e-17,1e-17,0);emit(4);}
 else if(fixture==1)rect(-16,-8,16,8,true);
 else if(fixture==2){emit(0,-16,-8);emit(2,0,16,16,-8);emit(4);}
 else if(fixture==3){emit(0,-16,-8);emit(3,-16,16,16,16,16,-8);emit(4);}
 else if(fixture==4){rect(-16,-12,16,12,false);rect(-6,-4,6,4,true);}
 else if(fixture==5){rect(-16,-12,4,12,false);rect(-4,-8,16,8,false);}
 else if(fixture==6){emit(0,1e12,1e12);emit(2,1e12+4,1e12+10,1e12+8,1e12);emit(4);}
 else rect(-16,-8,16,8,false);
 auto o=options();RawCoverageMesh result(c.numbers);BoundaryKLMReason reason=boundary_klm_none;auto s=build_raw_coverage_mesh(c,cmd.begin(),cmd.size(),42,o,result,reason);if(s)return s;if(fixture>=20&&fixture<=22&&(!result.regularized_curves||result.certificate.maximum_forward_norm*(result.certificate.actual_position_error_source+result.certificate.actual_regularization_error_source)>o.maximum_geometry_error_pixels))return SA_INK_INVALID;
 uint64_t before=hash(result);
 if(fixture==23)o.maximum_inverse_norm=1e100; // actual nonflat curve must not inherit a tiny-interval chord proof
 if(fixture==7)o.maximum_draws=1;
 if(fixture==8)o.maximum_vertices=3;
 if(fixture==9)o.maximum_geometry_error_pixels=0x1p-100;
 if(fixture==10)o.maximum_forward_norm=0;
 if(fixture==11)o.maximum_inverse_norm=0;
 if(fixture==12)cmd[0].reserved=1;
 if(fixture==13)cmd[1].operation=99;
 if(fixture==14){uint64_t nan=0x7ff8000000000000ull;copy_bytes(&cmd[1].values[0],&nan,8);}
 if(fixture==15)o.maximum_patches=1;
 if(fixture==16){double matrices[][4]={{1,0,0,1},{.01,0,0,.01},{32,0,0,32},{0,-32,32,0},{-2,1,.5,3}};for(auto&m:matrices)if(!raw_coverage_supports(result.certificate,m))return SA_INK_INVALID;double no[][4]={{0,0,0,0},{1,1,1,1},{257,0,0,1},{.001,0,0,.001}};for(auto&m:no)if(raw_coverage_supports(result.certificate,m))return SA_INK_INVALID;}
 // A true, visibly curved WHOLE command may not inherit the tiny chord proof
 // of just one analytic fallback interval (actual command329 regression).
 if(fixture==17){double raised=raw_coverage::up(-0.0);uint64_t bits;copy_bytes(&bits,&raised,8);if(bits!=1)return SA_INK_INVALID;
  RawCoverageMesh collapsed(c.numbers);BoundaryCoverageVertex v[3]{};double positions[6]={0,-0.0,0,1,0,1};for(auto&x:v){x.l=x.m=1;}
  if(!raw_coverage::emit(c,collapsed,positions,v,1,0,0,0,boundary_coverage_cubic,o,reason)||collapsed.mesh.vertices.size()||collapsed.certificate.degenerate_triangles!=1)return SA_INK_INVALID;
  SAInkPathCommand curve{3,0,{1,1,2,1,3,0}};raw_coverage::Command meta{};SAAnalyticPatch p{};p.parameter_start=0;p.parameter_end=1;p.controls[6]=3;double error=0;if(!raw_coverage::chord(c,curve,meta,p,error)||error<.5)return SA_INK_INVALID;curve.values[0]=-1;curve.values[2]=4;if(!raw_coverage::chord(c,curve,meta,p,error)||error*256<=.02)return SA_INK_INVALID;RawCoverageMesh empty(c.numbers);if(build_raw_coverage_mesh(c,nullptr,0,43,o,empty,reason)||empty.mesh.vertices.size()||empty.source_generation!=43)return SA_INK_INVALID;}
 s=build_raw_coverage_mesh(c,cmd.begin(),cmd.size(),42,o,result,reason);if(s&&before!=hash(result))return SA_INK_INVALID;
 uint32_t expected=fixture==23?3:fixture<7||fixture>=16?0:fixture<9?2:fixture==9||fixture==15?3:1;if(s!=expected)return SA_INK_INVALID;auto encoded=encode(c.numbers,result,s,reason,output,capacity);if(encoded)return encoded;
 }return c.numbers.live_bytes?SA_INK_INVALID:SA_INK_OK;
}
#include "wasm-runtime.cpp"
