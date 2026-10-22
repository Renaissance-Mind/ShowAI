#ifndef SHOWAI_BOUNDARY_CORRESPONDENCE_TEST_HPP
#define SHOWAI_BOUNDARY_CORRESPONDENCE_TEST_HPP
#include "owner.hpp"
// Test-only exact curve transport; no helper export enters the production ABI.
extern "C" uint32_t sabt_correspondence(uint32_t fixture,void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
 using namespace showai_boundary;if(fixture>8||!memory||((uintptr_t)memory&15u)||!output||((uintptr_t)output&3u)||!capacity||memory_overlap(memory,bytes,output,uint64_t(capacity)*4))return SA_INK_INVALID;
 PolynomialContext c;if(!c.numbers.initialize(memory,bytes,1000000000ull))return c.numbers.status;c.polynomial.max_operations=5000000;Vector<uint32_t>staged(c.numbers);
 {
  double sizes[9]={1e-40,1e-40,1e-80,1e-150,1,1,1e-40,-1e-40,1e-150};double levels[9]={1e-80,1e-80,1e-120,1e-300,0,-1,1e-40,-1e-80,1e-320};uint32_t expected=fixture==4?1:fixture==5?0:2;
  Q zero=Q::from_signed(c.numbers,0),one=Q::from_signed(c.numbers,1),half=one/Q(2),s=Q::from_double(c.numbers,sizes[fixture]),h=Q::from_double(c.numbers,levels[fixture]);Point q[3]={{zero,s},{half,-s},{one,s}},l[2]={{-one,h},{Q(2),h}};if(fixture==1){auto swap=l[0];l[0]=l[1];l[1]=swap;}
  Curve a=from_controls(c,q,3),b=from_controls(c,l,2);auto proof=curve_pair(a,b);if(!proof.complete||c.numbers.status!=SA_INK_OK)return c.numbers.status?uint32_t(c.numbers.status):uint32_t(SA_INK_RANGE);if(proof.hits.size()!=expected)return SA_INK_RANGE;
  staged.push_back(expected);for(auto hit:proof.hits){if(!root_of(hit.a,a.y-Polynomial(c,h)))return SA_INK_RANGE;Q slope=b.x[1],offset=b.x[0];Root transformed=affine_root(hit.b,slope,offset);if(!same_root(hit.a,transformed))return SA_INK_RANGE;int side=compare(hit.a,half);staged.push_back(uint32_t(side));auto encode=[&](const Root&r){staged.push_back(r.definition().coefficients.size());auto qword=[&](const Q&value){staged.push_back(uint32_t(value.sign()));staged.push_back(value.numerator().size());staged.push_back(value.denominator().size());for(uint32_t i=0;i<value.numerator().size();i++)staged.push_back(value.numerator().data()[i]);for(uint32_t i=0;i<value.denominator().size();i++)staged.push_back(value.denominator().data()[i]);};for(const auto&co:r.definition().coefficients)qword(co);qword(r.lower);qword(r.upper);};encode(hit.a);encode(hit.b);}
  staged.push_back(uint32_t(c.polynomial.operations));staged.push_back(uint32_t(c.numbers.work));staged.push_back(uint32_t(c.numbers.peak_bytes));
 }
 if(c.numbers.status)return c.numbers.status;if(staged.size()>capacity)return SA_INK_CAPACITY;for(uint32_t i=0;i<staged.size();i++)output[i]=static_cast<const Vector<uint32_t>&>(staged)[i];return SA_INK_OK;
}
#endif
