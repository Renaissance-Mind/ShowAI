#include "polynomial.hpp"
#include <vector>
#include <cstdio>
using namespace showai_boundary;
int main(){std::vector<uint64_t>memory(4*1024*1024/8);PolynomialContext c;c.numbers.initialize(memory.data(),uint32_t(memory.size()*8),1000000000);{
 Polynomial t(c);t.coefficients.push_back(Q::from_signed(c.numbers,0));t.coefficients.push_back(Q::from_signed(c.numbers,1));Q epsilon(Integer::from(c.numbers,1),Integer::from(c.numbers,1).shifted_left(60));auto p=t*(t-Polynomial(c,epsilon));auto r=roots(p);if(c.numbers.status||r.size()!=2)return 1;
 auto a=r[0],b=r[1];if(same_root(a,b)||root_of(r[1],t)||!(r[0].upper<r[1].lower)){std::fprintf(stderr,"ROOT_ENDPOINT_ALIAS first_and_second_collapsed=1 exact_binary64_separation=2^-60 status=%u\n",c.numbers.status);return 2;}
 // Irrational interior root near an exact endpoint must also exclude it.
 auto cubic=t*(t*t-scale(t,Q::from_signed(c.numbers,3)/Q(4))+Polynomial(c,epsilon*Q::from_signed(c.numbers,3)/Q(4)));auto s=roots(cubic);if(c.numbers.status||s.size()!=3||root_of(s[1],t)||!(s[0].upper<s[1].lower))return 3;
 Q microscopic(Integer::from(c.numbers,1),Integer::from(c.numbers,1).shifted_left(300));auto bounded=t*(t-Polynomial(c,microscopic));auto unresolved=roots(bounded);(void)unresolved;if(c.numbers.status!=SA_INK_RANGE)return 5;
 }
 if(c.numbers.live_bytes)return 4;c.numbers.begin_work(1000000000);std::printf("BOUNDARY_ROOT_ENDPOINT_SEPARATION_OK depth_budget_unchanged=256\n");}
