#include "number.hpp"
#include <gmpxx.h> // Test oracle only; never part of the freestanding kernel.
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <random>
#include <cmath>
#include <cfenv>
#include <type_traits>
static_assert(!std::is_constructible<showai_boundary::Rational,double>::value,"floating inputs require exact binary64 decoding");
static_assert(!std::is_constructible<showai_boundary::Integer,double>::value,"floating inputs cannot truncate into integers");
using namespace showai_boundary;
static mpz_class word64(uint64_t n){mpz_class r;mpz_import(r.get_mpz_t(),1,1,sizeof(n),0,0,&n);return r;}
static mpz_class oracle(const Integer&v){mpz_class r=0;for(uint32_t i=v.size();i;i--){r<<=32;r+=v.data()[i-1];}return v.sign()<0?-r:r;}
static Integer subject(Context&c,const mpz_class&v){Integer r=Integer::from(c,0);mpz_class a=v<0?-v:v;size_t limbs=(mpz_sizeinbase(a.get_mpz_t(),2)+31)/32;for(size_t i=limbs;i;i--){r=r.shifted_left(32);mpz_class part=a>>((i-1)*32);r=r+Integer::from(c,mpz_get_ui(part.get_mpz_t())&0xffffffffu);}return v<0?-r:r;}
static void equal(Context&c,const Integer&value,const mpz_class&expected,const char*op){if(c.status||!value.valid()||oracle(value)!=expected){std::fprintf(stderr,"number mismatch %s status%d bits%u\n",op,int(c.status),value.bits());std::abort();}}
int main(){std::vector<uint64_t>storage(8*1024*1024/8);Context c;if(!c.initialize(storage.data(),uint32_t(storage.size()*8),2000000000))return 1;std::mt19937_64 rng(0x5341424f554e4431ull);uint32_t checks=0;for(uint32_t i=0;i<1024;i++){uint32_t na=1+rng()%96,nb=1+rng()%96;mpz_class a=0,b=0;for(uint32_t k=0;k<na;k++){a<<=32;a+=uint32_t(rng());}for(uint32_t k=0;k<nb;k++){b<<=32;b+=uint32_t(rng());}if(i&1)a=-a;if(i&2)b=-b;Integer A=subject(c,a),B=subject(c,b);equal(c,A+B,mpz_class(a+b),"add");equal(c,A-B,mpz_class(a-b),"sub");equal(c,A*B,mpz_class(a*b),"mul");Integer q,r;if(!Integer::divmod(A,B,q,r))return 2;mpz_class oq,orr;mpz_tdiv_qr(oq.get_mpz_t(),orr.get_mpz_t(),a.get_mpz_t(),b.get_mpz_t());equal(c,q,oq,"div");equal(c,r,orr,"rem");mpz_class g;mpz_gcd(g.get_mpz_t(),a.get_mpz_t(),b.get_mpz_t());equal(c,Integer::gcd(A,B),g,"gcd");uint32_t shift=rng()%257;equal(c,A.shifted_left(shift),mpz_class(a<<shift),"shl");mpz_class magnitude=a<0?-a:a;mpz_class shifted=magnitude>>shift;if(a<0)shifted=-shifted;equal(c,A.shifted_right(shift),shifted,"shr");checks+=8;}
 for(uint32_t i=0;i<4096;i++){uint64_t bits=rng();if(((bits>>52)&2047)==2047)bits^=uint64_t(1)<<52;double value;std::memcpy(&value,&bits,8);Rational r=Rational::from_double(c,value);mpq_class q(value);if(oracle(r.numerator())!=q.get_num()||oracle(r.denominator())!=q.get_den())return 3;double lo=0,hi=0;if(!r.bounds(lo,hi)||lo!=value||hi!=value)return 4;checks+=2;}
 for(uint32_t degree:{2u,3u})for(uint32_t i=1;i<64;i++){mpz_class a=0;for(uint32_t j=0;j<i;j++){a<<=32;a+=uint32_t(rng());}mpz_class p;mpz_pow_ui(p.get_mpz_t(),a.get_mpz_t(),degree);Integer v=subject(c,p);bool perfect=false;Integer r=Integer::perfect_root(v,degree,perfect);equal(c,r,a,"perfect_root");if(!perfect)return 5;checks++;}
 for(uint32_t i=0;i<256;i++){mpz_class an=word64(rng()),ad=word64(rng()|1),bn=word64(rng()),bd=word64(rng()|1);if(i&1)an=-an;if(i&2)bn=-bn;mpq_class a(an,ad),b(bn,bd);a.canonicalize();b.canonicalize();Rational A(subject(c,a.get_num()),subject(c,a.get_den())),B(subject(c,b.get_num()),subject(c,b.get_den()));for(uint32_t op=0;op<4;op++){Rational r=op==0?A+B:op==1?A-B:op==2?A*B:A/B;mpq_class q=op==0?mpq_class(a+b):op==1?mpq_class(a-b):op==2?mpq_class(a*b):mpq_class(a/b);if(c.status||!r.valid()||oracle(r.numerator())!=q.get_num()||oracle(r.denominator())!=q.get_den())return 7;double lo=0,hi=0;if(!r.bounds(lo,hi)||mpq_class(lo)>q||mpq_class(hi)<q)return 8;if(lo!=hi&&std::nextafter(lo,INFINITY)!=hi)return 9;checks+=2;}}
 {int original=std::fegetround();for(int mode:{FE_TONEAREST,FE_DOWNWARD,FE_UPWARD,FE_TOWARDZERO}){if(std::fesetround(mode))return 10;for(double v:{0.0,-0.0,1e-310,-1e-310,1e300,-1e300,0x1p53,0x1.fffffffffffffp+1023}){Rational r=Rational::from_double(c,v);double lo=0,hi=0;if(!r.bounds(lo,hi)||lo!=v||hi!=v)return 11;++checks;}}std::fesetround(original);}
 if(c.live_bytes)return 6;std::printf("BOUNDARY_NUMBER_ORACLE_OK checks=%u work=%llu peak=%llu\n",checks,(unsigned long long)c.work,(unsigned long long)c.peak_bytes);return 0;}
