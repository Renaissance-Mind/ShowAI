#include "raw-coverage.hpp"
#include <cstdio>
#include <cmath>
#include <cfenv>
#include <initializer_list>
using namespace showai_boundary;
alignas(16) unsigned char arena[8*1024*1024];
int main(){
 PolynomialContext c;if(!c.numbers.initialize(arena,sizeof arena,100000000))return 1;
 uint32_t checked=0,filtered=0;uint64_t seed=1729;
 auto random=[&](){seed=seed*6364136223846793005ull+1442695040888963407ull;return double(int((seed>>32)%2049)-1024)/128;};
 for(int mode:{FE_TONEAREST,FE_UPWARD,FE_DOWNWARD,FE_TOWARDZERO}){
  if(std::fesetround(mode))return 2;
  for(uint32_t i=0;i<600;i++){
   c.numbers.begin_work(100000000);
   double scale=std::ldexp(1.,int(i%7)*150-450);
   SAInkPathCommand command{3,0,{}};raw_coverage::Command meta{};meta.start[0]=random()*scale;meta.start[1]=random()*scale;
   for(auto&v:command.values)v=random()*scale;
   if(i%5==0){meta.start[0]=meta.start[1]=0;for(uint32_t j=0;j<3;j++){command.values[j*2]=(j+1)*scale;command.values[j*2+1]=0;}}
   if(i%11==0)for(auto&v:command.values)v=0;
   SAAnalyticPatch p{};p.parameter_start=double(i%8)/16;p.parameter_end=p.parameter_start+double(1+i%7)/16;
   raw_coverage::Enclosure bounds[4][2];Point exact[4];
   if(!raw_coverage::restricted_cubic(c,command,meta,p,exact))return 3;
   bool enclosed=raw_coverage::restricted_enclosure(command,meta,p,bounds);
   if(!enclosed)continue;
   for(uint32_t j=0;j<4;j++)for(uint32_t axis=0;axis<2;axis++){
    const Q&v=axis?exact[j].y:exact[j].x;
    if(Q::from_double(c.numbers,bounds[j][axis].lo)>v||Q::from_double(c.numbers,bounds[j][axis].hi)<v)return 4;
   }
   double a[2],b[2];
   if(!boundary_quantization::nearest_lower_tie(exact[0].x,a[0])||!boundary_quantization::nearest_lower_tie(exact[0].y,a[1])||!boundary_quantization::nearest_lower_tie(exact[3].x,b[0])||!boundary_quantization::nearest_lower_tie(exact[3].y,b[1]))return 5;
   double error=0;
   if(raw_coverage::chord_enclosure(bounds,a,b,error)){
    ++filtered;double projection=0;if(!raw_coverage::chord_error(c,exact,a,b,projection))return 6;
    Q mx(0),my(0),ax=Q::from_double(c.numbers,a[0]),ay=Q::from_double(c.numbers,a[1]),dx=Q::from_double(c.numbers,b[0])-ax,dy=Q::from_double(c.numbers,b[1])-ay;
    for(uint32_t j=0;j<4;j++){Q t=Q::from_signed(c.numbers,j)/Q(3),x=(exact[j].x-ax-dx*t).absolute(),y=(exact[j].y-ay-dy*t).absolute();if(x>mx)mx=x;if(y>my)my=y;}
    if(Q::from_double(c.numbers,error)<mx+my&&error<projection)return 7;
   }
   if(c.numbers.status)return 8;++checked;
  }
 }
 std::fesetround(FE_TONEAREST);
 // Cancellation, signed zero, subnormal products and overflow must be enclosed
 // or rejected by the filter, never treated as a finite zero-error proof.
 for(double v:{0.,-0.,0x1p-1074,-0x1p-1074,0x1p-1022,-0x1p-1022,0x1.fffffffffffffp1023}){
  auto r=raw_coverage::multiply(raw_coverage::enclose(v),raw_coverage::enclose(.5));
  if(raw_coverage::valid(r)){
   Q q=Q::from_double(c.numbers,v)/Q(2);
   if(Q::from_double(c.numbers,r.lo)>q||Q::from_double(c.numbers,r.hi)<q)return 9;
  }
 }
 {
  // A tiny interval of a visibly curved command can be certified without any
  // limb arithmetic; the whole command must still use/refuse the exact proof.
  SAInkPathCommand command{3,0,{1,1,2,1,3,0}};raw_coverage::Command meta{};SAAnalyticPatch p{};p.parameter_end=0x1p-12;
  Point exact[4];if(!raw_coverage::restricted_cubic(c,command,meta,p,exact))return 12;
  if(!boundary_quantization::nearest_lower_tie(exact[3].x,p.controls[6])||!boundary_quantization::nearest_lower_tie(exact[3].y,p.controls[7]))return 13;
  c.numbers.begin_work(100000000);double error=0;
  if(!raw_coverage::chord(c,command,meta,p,error,.02/256)||error*256>.02||c.numbers.work)return 14;
  p.parameter_end=1;p.controls[6]=3;p.controls[7]=0;
  if(!raw_coverage::chord(c,command,meta,p,error,.02/256)||error<.5||!c.numbers.work)return 15;
 }
 if(c.numbers.live_bytes)return 10;
 printf("INTERVAL_PROOF cases=%u chordBounds=%u roundingModes=4 exactEnclosure=true\n",checked,filtered);return checked==2400?0:11;
}
