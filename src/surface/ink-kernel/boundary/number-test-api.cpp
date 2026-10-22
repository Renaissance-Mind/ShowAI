#include "number.hpp"
#include "polynomial.hpp"
#include "algebra.hpp"
// This translation unit is compiled only by the exact-kernel tests. It does
// not add a public document/API format or enter the production WASM module.
using namespace showai_boundary;
static bool overlap(const void*a,uint64_t an,const void*b,uint64_t bn){uint64_t x=(uintptr_t)a,y=(uintptr_t)b;if(!a||!b||an>UINTPTR_MAX-x||bn>UINTPTR_MAX-y)return true;return x<y+bn&&y<x+an;}
static Integer input(Context&c,const uint32_t*words,uint32_t count,int32_t sign){Integer v=Integer::from(c,0);for(uint32_t i=count;i;i--)v=v.shifted_left(32)+Integer::from(c,words[i-1]);return sign<0?-v:v;}
extern "C" {
uint32_t sabt_number_max_limbs(){return max_limbs;}
uint32_t sabt_number_operation(uint32_t operation,const uint32_t*a,uint32_t ac,int32_t as,const uint32_t*b,uint32_t bc,int32_t bs,void*memory,uint32_t bytes,uint64_t work_limit,uint32_t*output,uint32_t capacity,int32_t*metadata){
    if(((uintptr_t)a&3u)||((uintptr_t)b&3u)||((uintptr_t)output&3u)||((uintptr_t)metadata&3u)||operation>8||ac>512||bc>512||as< -1||as>1||bs< -1||bs>1||!a||!b||!output||!metadata||capacity<2048||!memory||((uintptr_t)memory&15u)||!bytes||!work_limit)return SA_INK_INVALID;
    uint64_t ab=uint64_t(ac)*4,bb=uint64_t(bc)*4,ob=uint64_t(capacity)*4;if(overlap(memory,bytes,a,ab)||overlap(memory,bytes,b,bb)||overlap(memory,bytes,output,ob)||overlap(memory,bytes,metadata,32)||overlap(output,ob,a,ab)||overlap(output,ob,b,bb)||overlap(output,ob,metadata,32)||overlap(metadata,32,a,ab)||overlap(metadata,32,b,bb))return SA_INK_INVALID;
    if(!as)for(uint32_t i=0;i<ac;i++)if(a[i])return SA_INK_INVALID;if(!bs)for(uint32_t i=0;i<bc;i++)if(b[i])return SA_INK_INVALID;
    Context c;if(!c.initialize(memory,bytes,work_limit))return c.status;uint32_t result_status=SA_INK_OK;Integer result;
    {Integer A=input(c,a,ac,as),B=input(c,b,bc,bs);switch(operation){case 0:result=A+B;break;case 1:result=A-B;break;case 2:result=A*B;break;case 3:result=A/B;break;case 4:result=A%B;break;case 5:result=Integer::gcd(A,B);break;case 6:result=A.shifted_left(bc?b[0]:0);break;case 7:result=A.shifted_right(bc?b[0]:0);break;default:{bool perfect=false;result=Integer::perfect_root(A,bc?b[0]:0,perfect);if(c.status==SA_INK_OK&&result.valid()){if(result.size()>capacity)c.fail(SA_INK_CAPACITY);else{for(uint32_t i=0;i<result.size();i++)output[i]=result.data()[i];metadata[0]=result.sign();metadata[1]=(int32_t)result.size();metadata[2]=perfect;metadata[3]=(int32_t)c.work;metadata[4]=(int32_t)(c.work>>32);metadata[5]=(int32_t)c.peak_bytes;metadata[6]=metadata[7]=0;}}return c.status;}}
    if(!result.valid()&&c.status==SA_INK_OK)c.fail(SA_INK_CAPACITY);result_status=c.status;if(result_status==SA_INK_OK){for(uint32_t i=0;i<result.size();i++)output[i]=result.data()[i];metadata[0]=result.sign();metadata[1]=(int32_t)result.size();metadata[2]=0;metadata[3]=(int32_t)c.work;metadata[4]=(int32_t)(c.work>>32);metadata[5]=(int32_t)c.peak_bytes;metadata[6]=metadata[7]=0;}}
    return result_status;
}
uint32_t sabt_rational_double(double value,void*memory,uint32_t bytes,uint64_t work_limit,double*output,uint32_t*words,uint32_t capacity,uint32_t*counts){
    if(!memory||!output||!words||!counts||((uintptr_t)output&7u)||((uintptr_t)words&3u)||((uintptr_t)counts&3u)||capacity<4096||overlap(memory,bytes,output,16)||overlap(memory,bytes,words,uint64_t(capacity)*4)||overlap(memory,bytes,counts,12)||overlap(output,16,words,uint64_t(capacity)*4)||overlap(words,uint64_t(capacity)*4,counts,12)||overlap(output,16,counts,12))return SA_INK_INVALID;
    Context c;if(!c.initialize(memory,bytes,work_limit))return c.status;Rational r=Rational::from_double(c,value);double low=0,high=0;if(c.status!=SA_INK_OK)return c.status;if(!r.bounds(low,high))return c.status==SA_INK_OK?SA_INK_RANGE:c.status;uint32_t n=r.numerator().size(),d=r.denominator().size();for(uint32_t i=0;i<n;i++)words[i]=r.numerator().data()[i];for(uint32_t i=0;i<d;i++)words[2048+i]=r.denominator().data()[i];counts[0]=n;counts[1]=d;counts[2]=(uint32_t)r.sign();output[0]=low;output[1]=high;return c.status;
}
}
// Freestanding compiler-generated aggregate copies have explicit local bodies.
#if defined(__wasm__)
extern "C" void*memcpy(void*d,const void*s,size_t n){auto*a=(uint8_t*)d;auto*b=(const uint8_t*)s;for(size_t i=0;i<n;i++)a[i]=b[i];return d;}
extern "C" void*memset(void*d,int v,size_t n){auto*a=(uint8_t*)d;for(size_t i=0;i<n;i++)a[i]=(uint8_t)v;return d;}
#endif
extern "C" uint32_t sabt_polynomial_roots(const double*values,uint32_t count,uint32_t mode,uint32_t refinements,void*memory,uint32_t bytes,uint64_t work_limit,uint32_t*output,uint32_t capacity,int32_t*metadata){
    if(!values||!count||count>65||mode>2||refinements>128||!output||!metadata||capacity<2048||((uintptr_t)values&7u)||((uintptr_t)output&3u)||((uintptr_t)metadata&3u)||overlap(memory,bytes,values,uint64_t(count)*8)||overlap(memory,bytes,output,uint64_t(capacity)*4)||overlap(memory,bytes,metadata,32)||overlap(output,uint64_t(capacity)*4,values,uint64_t(count)*8)||overlap(metadata,32,values,uint64_t(count)*8)||overlap(output,uint64_t(capacity)*4,metadata,32))return SA_INK_INVALID;
    PolynomialContext c;if(!c.numbers.initialize(memory,bytes,work_limit))return c.numbers.status;Polynomial p(c),t(c);t.coefficients.push_back(Q::from_signed(c.numbers,0));t.coefficients.push_back(Q::from_signed(c.numbers,1));
    if(!mode)for(uint32_t i=0;i<count;i++)p.coefficients.push_back(Q::from_double(c.numbers,values[i]));
    else if(mode==1){p=Polynomial::scalar(c,1);for(uint32_t i=0;i<count;i++)p=p*(t-Polynomial(c,Q::from_double(c.numbers,values[i])));}
    else{if(count>4)return SA_INK_RANGE;Polynomial u=Polynomial::scalar(c,1)-t;uint32_t n=count-1;for(uint32_t i=0;i<count;i++){uint32_t choose=1;for(uint32_t k=0;k<i;k++)choose=choose*(n-k)/(k+1);Polynomial term=Polynomial::scalar(c,choose);for(uint32_t k=0;k<i;k++)term=term*t;for(uint32_t k=i;k<n;k++)term=term*u;p=p+scale(term,Q::from_double(c.numbers,values[i]));}}
    p.trim();auto r=roots(p);for(uint32_t i=0;i<r.size()&&c.numbers.status==SA_INK_OK;i++)for(uint32_t j=0;j<refinements&&c.numbers.status==SA_INK_OK;j++)refine(r[i]);if(c.numbers.status!=SA_INK_OK)return c.numbers.status;
    Vector<uint32_t>staged(c.numbers);for(const Root&root:r){const Q*pair[2]={&root.lower,&root.upper};for(const Q*value:pair){staged.push_back((uint32_t)value->sign());staged.push_back(value->numerator().size());staged.push_back(value->denominator().size());for(uint32_t k=0;k<value->numerator().size();k++)staged.push_back(value->numerator().data()[k]);for(uint32_t k=0;k<value->denominator().size();k++)staged.push_back(value->denominator().data()[k]);}
    }if(c.numbers.status!=SA_INK_OK)return c.numbers.status;if(staged.size()>capacity)return SA_INK_CAPACITY;const auto&frozen=staged;for(uint32_t i=0;i<frozen.size();i++)output[i]=frozen[i];metadata[0]=(int32_t)r.size();metadata[1]=(int32_t)staged.size();metadata[2]=0;metadata[3]=(int32_t)c.numbers.work;metadata[4]=(int32_t)(c.numbers.work>>32);metadata[5]=(int32_t)c.numbers.peak_bytes;metadata[6]=(int32_t)c.polynomial.operations;metadata[7]=0;return SA_INK_OK;
}

extern "C" uint32_t sabt_curve_pair(const double*a,uint32_t ac,const double*b,uint32_t bc,void*memory,uint32_t bytes,uint64_t work_limit,uint32_t*output,uint32_t capacity,int32_t*metadata){
    if(!a||!b||ac<2||ac>4||bc<2||bc>4||!output||!metadata||capacity<2048||((uintptr_t)a&7u)||((uintptr_t)b&7u)||((uintptr_t)output&3u)||((uintptr_t)metadata&3u)||overlap(memory,bytes,a,uint64_t(ac)*16)||overlap(memory,bytes,b,uint64_t(bc)*16)||overlap(memory,bytes,output,uint64_t(capacity)*4)||overlap(memory,bytes,metadata,32)||overlap(output,uint64_t(capacity)*4,a,uint64_t(ac)*16)||overlap(output,uint64_t(capacity)*4,b,uint64_t(bc)*16)||overlap(output,uint64_t(capacity)*4,metadata,32)||overlap(metadata,32,a,uint64_t(ac)*16)||overlap(metadata,32,b,uint64_t(bc)*16))return SA_INK_INVALID;
    PolynomialContext c;if(!c.numbers.initialize(memory,bytes,work_limit))return c.numbers.status;Point ap[4],bp[4];for(uint32_t i=0;i<ac;i++)ap[i]={Q::from_double(c.numbers,a[2*i]),Q::from_double(c.numbers,a[2*i+1])};for(uint32_t i=0;i<bc;i++)bp[i]={Q::from_double(c.numbers,b[2*i]),Q::from_double(c.numbers,b[2*i+1])};auto A=from_controls(c,ap,ac),B=from_controls(c,bp,bc);auto proof=curve_pair(A,B);if(c.numbers.status!=SA_INK_OK)return c.numbers.status;if(!proof.complete)return SA_INK_RANGE;Vector<uint32_t>staged(c.numbers);
    auto encode=[&](const Q&value){staged.push_back(uint32_t(value.sign()));staged.push_back(value.numerator().size());staged.push_back(value.denominator().size());for(uint32_t i=0;i<value.numerator().size();i++)staged.push_back(value.numerator().data()[i]);for(uint32_t i=0;i<value.denominator().size();i++)staged.push_back(value.denominator().data()[i]);};
    if(proof.coincident){encode(proof.alpha);encode(proof.beta);}else for(const auto&hit:proof.hits){encode(hit.a.lower);encode(hit.a.upper);encode(hit.b.lower);encode(hit.b.upper);}if(c.numbers.status!=SA_INK_OK)return c.numbers.status;if(staged.size()>capacity)return SA_INK_CAPACITY;const auto&frozen=staged;for(uint32_t i=0;i<frozen.size();i++)output[i]=frozen[i];metadata[0]=(int32_t)proof.hits.size();metadata[1]=(int32_t)staged.size();metadata[2]=proof.coincident?1:0;metadata[3]=(int32_t)c.numbers.work;metadata[4]=(int32_t)(c.numbers.work>>32);metadata[5]=(int32_t)c.numbers.peak_bytes;metadata[6]=(int32_t)c.polynomial.operations;metadata[7]=0;return SA_INK_OK;
}

#include "graph-test-api.hpp"

#include "../boundary-kernel.cpp"
