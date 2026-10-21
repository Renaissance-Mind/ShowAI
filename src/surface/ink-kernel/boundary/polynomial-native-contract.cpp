#include "polynomial.hpp"
#include <gmpxx.h>
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static mpz_class z(const Integer&v){mpz_class r=0;for(uint32_t i=v.size();i;i--){r<<=32;r+=v.data()[i-1];}return v.sign()<0?-r:r;}
static mpq_class q(const Q&v){return mpq_class(z(v.numerator()),z(v.denominator()));}
static Polynomial linear(PolynomialContext&c,int64_t numerator,int64_t denominator){Polynomial p(c);p.coefficients.push_back(Q(Integer::from_signed(c.numbers,-numerator),Integer::from_signed(c.numbers,denominator)));p.coefficients.push_back(Q::from_signed(c.numbers,1));return p;}
int main(){std::vector<uint64_t>arena(16*1024*1024/8);PolynomialContext c;c.numbers.initialize(arena.data(),uint32_t(arena.size()*8),1000000000);{
 auto a=linear(c,1,4),b=linear(c,3,4),p=a*b;auto rs=roots(p*p);if(c.numbers.status||rs.size()!=2||!root_of(rs[0],a)||!root_of(rs[1],b))return 1;if(q(rs[0].lower)!=mpq_class(1,4)||q(rs[1].upper)!=mpq_class(3,4))return 2;
 Polynomial t(c);t.coefficients.push_back(Q::from_signed(c.numbers,0));t.coefficients.push_back(Q::from_signed(c.numbers,1));auto irrational=t*t-Polynomial(c,Q(Integer::from_signed(c.numbers,1),Integer::from_signed(c.numbers,2)));auto positive=roots(irrational);if(positive.size()!=1)return 3;for(uint32_t i=0;i<120;i++)refine(positive[0]);if(c.numbers.status||q(positive[0].lower)*q(positive[0].lower)>=mpq_class(1,2)||q(positive[0].upper)*q(positive[0].upper)<=mpq_class(1,2))return 4;
 auto common=gcd(p*(t*t+Polynomial::scalar(c,1)),p*(t+Polynomial::scalar(c,3)));if(common.degree()!=2)return 5;for(int i=0;i<=2;i++)if(q(common[i])!=q(monic(p)[i]))return 6;
 Vector<Polynomial>A(c.numbers),B(c.numbers);A.push_back(t);A.push_back(Polynomial::scalar(c,1));B.push_back(Polynomial::scalar(c,-1));B.push_back(Polynomial::scalar(c,1));auto r=resultant(A,B)+(t+Polynomial::scalar(c,1));if(!r.zero()||c.numbers.status)return 7;
 auto sequence=sturm(p);if(count_open(sequence,Q(0),Q(1))!=2)return 8;
 // Arena COW: mutable scratch copies cannot overwrite retained coefficients.
 auto retained=p,scratch=p;const Q before=retained[0];scratch.coefficients[0]+=Q(1);if(retained[0]!=before||scratch[0]==before)return 9;
 }
 if(c.numbers.live_bytes)return 10;std::printf("BOUNDARY_POLYNOMIAL_ROOT_RESULTANT_OK poly=%llu limbs=%llu peak=%llu\n",(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work,(unsigned long long)c.numbers.peak_bytes);}
