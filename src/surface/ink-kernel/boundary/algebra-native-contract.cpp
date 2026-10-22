#include "algebra.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static Q dyadic(PolynomialContext&c,int64_t n,uint32_t denominator=1){return Q(Integer::from_signed(c.numbers,n),Integer::from(c.numbers,denominator));}
static Point point(PolynomialContext&c,int64_t x,int64_t y,uint32_t d=1){return{dyadic(c,x,d),dyadic(c,y,d)};}
static void require(bool b,const char*label,PolynomialContext&c){if(!b||c.numbers.status){std::fprintf(stderr,"algebra failure %s status%d poly%llu limb%llu\n",label,int(c.numbers.status),(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work);std::abort();}}
int main(){std::vector<uint64_t>memory(32*1024*1024/8);PolynomialContext c;c.numbers.initialize(memory.data(),uint32_t(memory.size()*8),1000000000);uint32_t checks=0;{
 Point A[2]={point(c,0,0),point(c,1,1)},B[2]={point(c,0,1),point(c,1,0)};auto a=from_controls(c,A,2),b=from_controls(c,B,2);auto pair=curve_pair(a,b);require(pair.complete&&!pair.coincident&&pair.hits.size()==1,"crossing lines",c);require(pair.hits[0].a.lower==dyadic(c,1,2)&&pair.hits[0].b.upper==dyadic(c,1,2),"exact line parameters",c);checks+=2;
 Point C[3]={point(c,0,0),point(c,1,2),point(c,2,0)},D[2]={point(c,0,1,2),point(c,4,1,2)};auto q=from_controls(c,C,3),line=from_controls(c,D,2);auto cut=curve_pair(q,line);require(cut.complete&&cut.hits.size()==2,"quadratic intersections",c);for(const auto&hit:cut.hits){auto p=at(q,hit.a.midpoint());require(p.y>dyadic(c,499,1000)&&p.y<dyadic(c,501,1000),"original quadratic intersection",c);checks++;}
 auto half=restricted(q,dyadic(c,0),dyadic(c,1,2));auto overlap=curve_pair(q,half);require(overlap.complete&&overlap.coincident&&overlap.alpha==dyadic(c,1,2)&&overlap.beta.zero(),"affine coincidence",c);checks++;
 Point Loop[4]={{dyadic(c,9,16),dyadic(c,0)},{dyadic(c,-7,16),dyadic(c,3,16)},{dyadic(c,-7,16),dyadic(c,-5,8)},{dyadic(c,9,16),dyadic(c,9,16)}};Point Vertical[2]={point(c,0,-1),point(c,0,1)};auto loop=from_controls(c,Loop,4),vertical=from_controls(c,Vertical,2);auto forward=curve_pair(loop,vertical);require(forward.complete&&forward.hits.size()==2,"cubic double point forward",c);auto reverse=curve_pair(vertical,loop);require(reverse.complete&&reverse.hits.size()==2,"cubic double point inverse projection",c);for(const auto&hit:reverse.hits)require(hit.a.lower==dyadic(c,1,2),"double point line parameter",c);checks+=3;
 }
 require(c.numbers.live_bytes==0,"all algebra arena records released",c);std::printf("BOUNDARY_CURVE_PAIR_EXACT_OK checks=%u poly=%llu limbs=%llu peak=%llu\n",checks,(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work,(unsigned long long)c.numbers.peak_bytes);}
