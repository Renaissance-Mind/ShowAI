#ifndef SHOWAI_BOUNDARY_NUMBER_HPP
#define SHOWAI_BOUNDARY_NUMBER_HPP
#include "../include/showai_ink.h"
#include <stddef.h>
#include <stdint.h>
#include <float.h>
#include <limits.h>
#if __has_include(<new>)
#include <new>
#else
inline void*operator new(size_t,void*p)noexcept{return p;}
inline void operator delete(void*,void*)noexcept{}
#endif

// Independent bounded exact arithmetic. No allocator, exceptions, platform
// APIs, GMP or compiler-specific wide integer is required by this header.
namespace showai_boundary {
static_assert(CHAR_BIT==8&&sizeof(double)==8&&DBL_MANT_DIG==53&&DBL_MAX_EXP==1024,"binary64 target required");
template<bool B,class T=void>struct Enable{};template<class T>struct Enable<true,T>{using type=T;};
template<class T>struct Integral{static constexpr bool value=false;};
#define SA_BOUNDARY_INTEGER_TYPE(T) template<>struct Integral<T>{static constexpr bool value=true;};
SA_BOUNDARY_INTEGER_TYPE(bool) SA_BOUNDARY_INTEGER_TYPE(char) SA_BOUNDARY_INTEGER_TYPE(signed char) SA_BOUNDARY_INTEGER_TYPE(unsigned char)
SA_BOUNDARY_INTEGER_TYPE(short) SA_BOUNDARY_INTEGER_TYPE(unsigned short) SA_BOUNDARY_INTEGER_TYPE(int) SA_BOUNDARY_INTEGER_TYPE(unsigned int)
SA_BOUNDARY_INTEGER_TYPE(long) SA_BOUNDARY_INTEGER_TYPE(unsigned long) SA_BOUNDARY_INTEGER_TYPE(long long) SA_BOUNDARY_INTEGER_TYPE(unsigned long long)
#undef SA_BOUNDARY_INTEGER_TYPE
template<class T>struct Floating{static constexpr bool value=false;};template<>struct Floating<float>{static constexpr bool value=true;};template<>struct Floating<double>{static constexpr bool value=true;};template<>struct Floating<long double>{static constexpr bool value=true;};
constexpr uint32_t no_block=0xffffffffu;
constexpr uint32_t stored_bits=16384,temporary_bits=65536,max_limbs=temporary_bits/32;
// Arena records use one fixed-width internal pointer representation on both
// native64 and wasm32. This keeps byte-budget/status decisions independent of
// host pointer width; records are private process-local state, never wire data.
template<class T>struct alignas(8) Pointer {
    uint64_t address=0;Pointer()=default;Pointer(T*p):address((uint64_t)(uintptr_t)p){}
    operator T*()const{return(T*)(uintptr_t)address;}T*operator->()const{return(T*)(uintptr_t)address;}
};
static_assert(sizeof(uintptr_t)<=8,"unsupported pointer width");

inline uint32_t leading_zeroes(uint32_t x){uint32_t n=0;if(!x)return 32;while(!(x&0x80000000u)){x<<=1;++n;}return n;}
inline uint32_t trailing_zeroes(uint32_t x){uint32_t n=0;if(!x)return 32;while(!(x&1u)){x>>=1;++n;}return n;}
inline void copy_bytes(void*d,const void*s,uint32_t n){auto*a=(uint8_t*)d;auto*b=(const uint8_t*)s;for(uint32_t i=0;i<n;i++)a[i]=b[i];}
struct Context {
    Context()=default;Context(const Context&)=delete;Context&operator=(const Context&)=delete;
    struct Block{uint32_t order,refs,next,previous;};
    uint8_t*memory=nullptr;uint32_t bytes=0,root_order=0,heads[32]{};
    SAInkStatus status=SA_INK_OK;
    uint64_t work=0,max_work=0,live_bytes=0,peak_bytes=0,allocations=0;
    void fail(SAInkStatus e){if(status==SA_INK_OK)status=e;}
    bool step(uint64_t n=1){if(status!=SA_INK_OK)return false;if(n>max_work-work){fail(SA_INK_CAPACITY);return false;}work+=n;return true;}
    Block&block(uint32_t p){return*(Block*)(memory+p);}
    const Block&block(uint32_t p)const{return*(const Block*)(memory+p);}
    void unlink(uint32_t p){auto&b=block(p);if(b.previous==no_block)heads[b.order]=b.next;else block(b.previous).next=b.next;if(b.next!=no_block)block(b.next).previous=b.previous;}
    void link(uint32_t p,uint32_t order){auto&b=*::new((void*)(memory+p))Block{order,0,heads[order],no_block};if(b.next!=no_block)block(b.next).previous=p;heads[order]=p;}
    bool initialize(void*p,uint32_t n,uint64_t limit){
        if(live_bytes||!p||((uintptr_t)p&15u)||n<64||n>0x40000000u||!limit){status=SA_INK_INVALID;return false;}
        memory=(uint8_t*)p;root_order=31-leading_zeroes(n);bytes=uint32_t(1)<<root_order;status=SA_INK_OK;work=0;max_work=limit;live_bytes=peak_bytes=allocations=0;
        for(uint32_t i=0;i<32;i++)heads[i]=no_block;link(0,root_order);return true;
    }
    bool begin_work(uint64_t limit){if(!memory||!limit){fail(SA_INK_INVALID);return false;}status=SA_INK_OK;work=0;max_work=limit;return true;}
    uint32_t allocate(uint32_t payload){
        if(status!=SA_INK_OK)return no_block;if(payload>0x3ffffff0u){fail(SA_INK_CAPACITY);return no_block;}
        uint32_t order=6;while((uint32_t(1)<<order)<payload+16u)++order;
        uint32_t available=order;while(available<=root_order&&heads[available]==no_block)++available;
        if(available>root_order){fail(SA_INK_CAPACITY);return no_block;}uint32_t p=heads[available];unlink(p);
        while(available>order){--available;link(p+(uint32_t(1)<<available),available);}
        block(p)={order,1,no_block,no_block};live_bytes+=uint32_t(1)<<order;if(live_bytes>peak_bytes)peak_bytes=live_bytes;++allocations;return p;
    }
    void retain(uint32_t p){if(p==no_block)return;auto&b=block(p);if(b.refs==0xffffffffu){fail(SA_INK_CAPACITY);return;}++b.refs;}
    void release(uint32_t p){if(p==no_block)return;auto&b=block(p);if(--b.refs)return;uint32_t order=b.order;live_bytes-=uint32_t(1)<<order;
        while(order<root_order){uint32_t buddy=p^(uint32_t(1)<<order);auto&other=block(buddy);if(other.refs||other.order!=order)break;unlink(buddy);if(buddy<p)p=buddy;++order;}link(p,order);
    }
    uint32_t*payload(uint32_t p){return(uint32_t*)(memory+p+16);}
    const uint32_t*payload(uint32_t p)const{return(const uint32_t*)(memory+p+16);}
};
struct Buffer {
    Context*ctx=nullptr;uint32_t offset=no_block;
    Buffer(Context&c,uint32_t count):ctx(&c){if(count<=max_limbs+2){offset=c.allocate(count*4);if(offset!=no_block)for(uint32_t i=0;i<count;i++)::new((void*)(c.payload(offset)+i))uint32_t(0);}else c.fail(SA_INK_CAPACITY);}
    ~Buffer(){if(ctx)ctx->release(offset);}
    Buffer(const Buffer&)=delete;Buffer&operator=(const Buffer&)=delete;
    uint32_t*data(){return offset==no_block?nullptr:ctx->payload(offset);}
};
class Integer {
    Pointer<Context>ctx_;uint32_t offset_=no_block;uint32_t small_[2]{};uint16_t count_=0;int8_t sign_=0;uint8_t invalid_=0;
    static Integer bad(Context*c,SAInkStatus e=SA_INK_CAPACITY){Integer x;x.ctx_=c;x.invalid_=1;if(c)c->fail(e);return x;}
    static Context*owner(const Integer&a,const Integer&b){if(a.ctx_&&b.ctx_&&a.ctx_!=b.ctx_){a.ctx_->fail(SA_INK_INVALID);return a.ctx_;}return a.ctx_?a.ctx_:b.ctx_;}
    static Integer blank(Context*c,uint32_t n){Integer x;x.ctx_=c;if(n>max_limbs+1)return bad(c);if(c&&c->status!=SA_INK_OK)return bad(c,c->status);if(n>2){if(!c)return bad(c);x.offset_=c->allocate(n*4);if(x.offset_==no_block)return bad(c);auto*p=c->payload(x.offset_);for(uint32_t i=0;i<n;i++)::new((void*)(p+i))uint32_t(0);}x.count_=(uint16_t)n;return x;}
    uint32_t*mutable_data(){return offset_==no_block?small_:ctx_->payload(offset_);}
    void trim(){auto*p=data();while(count_&&!p[count_-1])--count_;if(!count_)sign_=0;if(count_>max_limbs){invalid_=1;if(ctx_)ctx_->fail(SA_INK_CAPACITY);}if(count_<=2&&offset_!=no_block){uint32_t a=count_?p[0]:0,b=count_>1?p[1]:0;ctx_->release(offset_);offset_=no_block;small_[0]=a;small_[1]=b;}}
    static int magnitude_compare(const Integer&a,const Integer&b){if(a.count_!=b.count_)return a.count_<b.count_?-1:1;for(uint32_t i=a.count_;i;--i)if(a.data()[i-1]!=b.data()[i-1])return a.data()[i-1]<b.data()[i-1]?-1:1;return 0;}
    static Integer magnitude_add(const Integer&a,const Integer&b,Context*c){uint32_t n=a.count_>b.count_?a.count_:b.count_;Integer r=blank(c,n+1);if(!r.valid())return r;uint64_t carry=0;for(uint32_t i=0;i<n;i++){if(c&&!c->step())return bad(c);uint64_t z=uint64_t(i<a.count_?a.data()[i]:0)+(i<b.count_?b.data()[i]:0)+carry;r.mutable_data()[i]=(uint32_t)z;carry=z>>32;}r.mutable_data()[n]=(uint32_t)carry;r.sign_=1;r.trim();return r;}
    static Integer magnitude_subtract(const Integer&a,const Integer&b,Context*c){Integer r=blank(c,a.count_);if(!r.valid())return r;uint64_t borrow=0;for(uint32_t i=0;i<a.count_;i++){if(c&&!c->step())return bad(c);uint64_t sub=uint64_t(i<b.count_?b.data()[i]:0)+borrow,old=a.data()[i];r.mutable_data()[i]=(uint32_t)(old-sub);borrow=old<sub;}r.sign_=1;r.trim();return r;}
public:
    Integer()=default;
    template<class T,typename Enable<Floating<T>::value,int>::type=0>Integer(T)=delete;
    template<class T,typename Enable<Integral<T>::value,int>::type=0>Integer(T x){uint64_t m=uint64_t(x);bool negative=false;if constexpr(T(-1)<T(0)){negative=x<0;if(negative)m=uint64_t(0)-m;}small_[0]=(uint32_t)m;small_[1]=(uint32_t)(m>>32);count_=small_[1]?2:small_[0]?1:0;sign_=m?(negative?-1:1):0;}
    Integer(int64_t x){uint64_t m=x<0?uint64_t(0)-uint64_t(x):uint64_t(x);small_[0]=(uint32_t)m;small_[1]=(uint32_t)(m>>32);count_=small_[1]?2:small_[0]?1:0;sign_=x<0?-1:x>0?1:0;}
    static Integer from(Context&c,uint64_t x){Integer r;r.ctx_=&c;r.small_[0]=(uint32_t)x;r.small_[1]=(uint32_t)(x>>32);r.count_=r.small_[1]?2:r.small_[0]?1:0;r.sign_=x?1:0;return r;}
    static Integer from_signed(Context&c,int64_t x){Integer r(x);r.ctx_=&c;return r;}
    Integer(const Integer&x):ctx_(x.ctx_),offset_(x.offset_),small_{x.small_[0],x.small_[1]},count_(x.count_),sign_(x.sign_),invalid_(x.invalid_){if(ctx_)ctx_->retain(offset_);}
    Integer(Integer&&x)noexcept:ctx_(x.ctx_),offset_(x.offset_),small_{x.small_[0],x.small_[1]},count_(x.count_),sign_(x.sign_),invalid_(x.invalid_){x.offset_=no_block;x.count_=0;x.sign_=0;}
    ~Integer(){if(ctx_)ctx_->release(offset_);}
    Integer&operator=(const Integer&x){if(this!=&x){if(x.ctx_)x.ctx_->retain(x.offset_);if(ctx_)ctx_->release(offset_);ctx_=x.ctx_;offset_=x.offset_;small_[0]=x.small_[0];small_[1]=x.small_[1];count_=x.count_;sign_=x.sign_;invalid_=x.invalid_;}return*this;}
    Integer&operator=(Integer&&x)noexcept{if(this!=&x){if(ctx_)ctx_->release(offset_);ctx_=x.ctx_;offset_=x.offset_;small_[0]=x.small_[0];small_[1]=x.small_[1];count_=x.count_;sign_=x.sign_;invalid_=x.invalid_;x.offset_=no_block;x.count_=0;x.sign_=0;}return*this;}
    Integer owned(Context&c)const{Integer r(*this);if(r.ctx_&&r.ctx_!=&c){c.fail(SA_INK_INVALID);r.invalid_=1;}else r.ctx_=&c;return r;}
    Context*context()const{return ctx_;}bool valid()const{return !invalid_;}int sign()const{return sign_;}bool zero()const{return sign_==0;}uint32_t size()const{return count_;}
    const uint32_t*data()const{return offset_==no_block?small_:ctx_->payload(offset_);}
    uint32_t bits()const{return count_?32u*(count_-1)+32u-leading_zeroes(data()[count_-1]):0;}
    uint32_t zero_bits()const{for(uint32_t i=0;i<count_;i++)if(data()[i])return 32*i+trailing_zeroes(data()[i]);return 0;}
    Integer absolute()const{Integer r(*this);if(r.sign_<0)r.sign_=1;return r;}
    Integer operator-()const{Integer r(*this);r.sign_=-r.sign_;return r;}
    int compare(const Integer&b)const{if(sign_!=b.sign_)return sign_<b.sign_?-1:1;return sign_*magnitude_compare(*this,b);}
    Integer operator+(const Integer&b)const{Context*c=owner(*this,b);if(!valid()||!b.valid()||(c&&c->status!=SA_INK_OK))return bad(c);if(!sign_){Integer r=b;if(!r.ctx_)r.ctx_=c;return r;}if(!b.sign_){Integer r=*this;if(!r.ctx_)r.ctx_=c;return r;}Integer r;if(sign_==b.sign_)r=magnitude_add(*this,b,c);else{int cmp=magnitude_compare(*this,b);if(!cmp)return c?from(*c,0):Integer();r=cmp>0?magnitude_subtract(*this,b,c):magnitude_subtract(b,*this,c);r.sign_=cmp>0?sign_:b.sign_;return r;}if(r.sign_)r.sign_=sign_;return r;}
    Integer operator-(const Integer&b)const{return*this+(-b);}
    Integer operator*(const Integer&b)const{Context*c=owner(*this,b);if(!valid()||!b.valid()||(c&&c->status!=SA_INK_OK))return bad(c);if(!sign_||!b.sign_)return c?from(*c,0):Integer();if(b.count_==1&&b.data()[0]==1){Integer r=*this;if(!r.ctx_)r.ctx_=c;r.sign_*=b.sign_;return r;}if(count_==1&&data()[0]==1){Integer r=b;if(!r.ctx_)r.ctx_=c;r.sign_*=sign_;return r;}uint32_t n=count_+b.count_;if(n>max_limbs+1)return bad(c);if(n>max_limbs&&bits()+b.bits()>temporary_bits+1)return bad(c); // exact leading-product boundary handled below
        Integer r=blank(c,n);if(!r.valid())return r;auto*p=r.mutable_data();for(uint32_t i=0;i<count_;i++){uint64_t carry=0;for(uint32_t j=0;j<b.count_;j++){if(c&&!c->step())return bad(c);uint64_t z=uint64_t(data()[i])*b.data()[j]+p[i+j]+carry;p[i+j]=(uint32_t)z;carry=z>>32;}p[i+b.count_]=(uint32_t)carry;}r.sign_=sign_*b.sign_;r.trim();return r;}
    Integer shifted_left(uint32_t amount)const{if(!valid())return bad(ctx_);if(!sign_||!amount)return*this;if(amount>temporary_bits||bits()>temporary_bits-amount)return bad(ctx_);uint32_t whole=amount/32,part=amount%32,n=(bits()+amount+31)/32;Integer r=blank(ctx_,n);if(!r.valid())return r;auto*p=r.mutable_data();uint64_t carry=0;for(uint32_t i=0;i<count_;i++){if(ctx_&&!ctx_->step())return bad(ctx_);uint64_t z=(uint64_t(data()[i])<<part)|carry;p[i+whole]=(uint32_t)z;carry=z>>32;}if(carry)p[count_+whole]=(uint32_t)carry;r.sign_=sign_;return r;}
    Integer shifted_right(uint32_t amount)const{if(!valid())return bad(ctx_);if(amount>=bits())return ctx_?from(*ctx_,0):Integer();if(!amount)return*this;uint32_t whole=amount/32,part=amount%32,n=count_-whole;Integer r=blank(ctx_,n);if(!r.valid())return r;auto*p=r.mutable_data();for(uint32_t i=0;i<n;i++){if(ctx_&&!ctx_->step())return bad(ctx_);uint64_t z=data()[i+whole];if(part&&i+whole+1<count_)z|=uint64_t(data()[i+whole+1])<<32;p[i]=(uint32_t)(z>>part);}r.sign_=sign_;r.trim();return r;}
    static bool divmod(const Integer&a,const Integer&b,Integer&quotient,Integer&remainder){
        Context*c=owner(a,b);if(&quotient==&remainder){if(c)c->fail(SA_INK_INVALID);return false;}if(!a.valid()||!b.valid()||!b.sign_||(c&&c->status!=SA_INK_OK)){if(c)c->fail(b.zero()?SA_INK_RANGE:SA_INK_CAPACITY);return false;}int cmp=magnitude_compare(a,b);if(cmp<0){Integer captured=a,q=c?from(*c,0):Integer();quotient=static_cast<Integer&&>(q);remainder=static_cast<Integer&&>(captured);return true;}if(!cmp){quotient=c?from_signed(*c,a.sign_*b.sign_):Integer(a.sign_*b.sign_);remainder=c?from(*c,0):Integer();return true;}
        if(b.count_==1){Integer q=blank(c,a.count_);if(!q.valid())return false;uint64_t rem=0;for(uint32_t k=a.count_;k;k--){if(c&&!c->step())return false;uint64_t z=(rem<<32)|a.data()[k-1];q.mutable_data()[k-1]=(uint32_t)(z/b.data()[0]);rem=z%b.data()[0];}q.sign_=a.sign_*b.sign_;q.trim();Integer r=c?from(*c,rem):Integer((int64_t)rem);if(r.sign_)r.sign_=a.sign_;quotient=static_cast<Integer&&>(q);remainder=static_cast<Integer&&>(r);return true;}
        if(!c)return false;uint32_t shift=leading_zeroes(b.data()[b.count_-1]),n=b.count_,m=a.count_-n;Buffer ub(*c,a.count_+1),vb(*c,n);if(!ub.data()||!vb.data())return false;auto*u=ub.data();auto*v=vb.data();uint64_t carry=0;for(uint32_t i=0;i<a.count_;i++){uint64_t z=(uint64_t(a.data()[i])<<shift)|carry;u[i]=(uint32_t)z;carry=z>>32;}u[a.count_]=(uint32_t)carry;carry=0;for(uint32_t i=0;i<n;i++){uint64_t z=(uint64_t(b.data()[i])<<shift)|carry;v[i]=(uint32_t)z;carry=z>>32;}
        Integer q=blank(c,m+1);if(!q.valid())return false;for(uint32_t jj=m+1;jj;jj--){uint32_t j=jj-1;if(u[j+n]>v[n-1]){c->fail(SA_INK_RANGE);return false;}uint64_t top=(uint64_t(u[j+n])<<32)|u[j+n-1],qh,rh;if(u[j+n]==v[n-1]){qh=0xffffffffu;rh=uint64_t(u[j+n-1])+v[n-1];}else{qh=top/v[n-1];rh=top%v[n-1];}while(rh<0x100000000ull&&qh*v[n-2]>(rh<<32)+u[j+n-2]){if(!c->step())return false;--qh;rh+=v[n-1];}
            uint64_t high=0,borrow=0;for(uint32_t i=0;i<n;i++){if(!c->step())return false;uint64_t product=qh*v[i]+high;high=product>>32;uint64_t sub=uint64_t((uint32_t)product)+borrow,old=u[j+i];u[j+i]=(uint32_t)(old-sub);borrow=old<sub;}uint64_t sub=high+borrow,old=u[j+n];u[j+n]=(uint32_t)(old-sub);if(old<sub){--qh;uint64_t sum=0;for(uint32_t i=0;i<n;i++){if(!c->step())return false;sum=uint64_t(u[j+i])+v[i]+(sum>>32);u[j+i]=(uint32_t)sum;}u[j+n]+=(uint32_t)(sum>>32);}q.mutable_data()[j]=(uint32_t)qh;
        }Integer r=blank(c,n);if(!r.valid())return false;for(uint32_t i=0;i<n;i++){uint64_t z=u[i];if(shift&&i+1<n)z|=uint64_t(u[i+1])<<32;r.mutable_data()[i]=(uint32_t)(z>>shift);}q.sign_=a.sign_*b.sign_;q.trim();r.sign_=a.sign_;r.trim();quotient=static_cast<Integer&&>(q);remainder=static_cast<Integer&&>(r);return true;
    }
    Integer operator/(const Integer&b)const{Integer q,r;if(!divmod(*this,b,q,r))return bad(owner(*this,b),b.zero()?SA_INK_RANGE:SA_INK_CAPACITY);return q;}
    Integer operator%(const Integer&b)const{Integer q,r;if(!divmod(*this,b,q,r))return bad(owner(*this,b),b.zero()?SA_INK_RANGE:SA_INK_CAPACITY);return r;}
    static Integer gcd(Integer a,Integer b){Context*c=owner(a,b);a=a.absolute();b=b.absolute();if(!a.sign_)return b;if(!b.sign_)return a;uint32_t za=a.zero_bits(),zb=b.zero_bits(),z=za<zb?za:zb;a=a.shifted_right(za);b=b.shifted_right(zb);while(b.sign_&&a.valid()&&b.valid()&&(!c||c->status==SA_INK_OK)){Integer r=a%b;a=static_cast<Integer&&>(b);b=static_cast<Integer&&>(r);}return a.shifted_left(z);}
    uint32_t mod_small(uint32_t divisor)const{if(!divisor){if(ctx_)ctx_->fail(SA_INK_RANGE);return 0;}uint64_t r=0;for(uint32_t k=count_;k;k--){if(ctx_&&!ctx_->step())return 0;r=((r<<32)|data()[k-1])%divisor;}if(sign_<0&&r)r=divisor-r;return(uint32_t)r;}
    uint64_t unsigned_value()const{if(sign_<0||count_>2){if(ctx_)ctx_->fail(SA_INK_RANGE);return 0;}return count_>1?(uint64_t(data()[1])<<32)|data()[0]:count_?data()[0]:0;}
    static Integer perfect_root(const Integer&value,uint32_t degree,bool&perfect){perfect=false;Context*c=value.ctx_;if((degree!=2&&degree!=3)||value.sign_<0){if(c)c->fail(SA_INK_RANGE);return bad(c,SA_INK_RANGE);}if(value.zero()){perfect=true;return value;}Integer one=c?from(*c,1):Integer(1),x=one.shifted_left((value.bits()+degree-1)/degree);while(x.valid()&&(!c||c->status==SA_INK_OK)){Integer power=degree==2?x:x*x;Integer next=(x*Integer(degree-1)+value/power)/Integer(degree);if(!next.valid())return bad(c);if(next.compare(x)>=0)break;x=static_cast<Integer&&>(next);}Integer power=degree==2?x*x:x*x*x;if(!power.valid())return bad(c);perfect=power.compare(value)==0;return x;}
};
inline bool operator==(const Integer&a,const Integer&b){return a.compare(b)==0;}inline bool operator!=(const Integer&a,const Integer&b){return a.compare(b)!=0;}inline bool operator<(const Integer&a,const Integer&b){return a.compare(b)<0;}inline bool operator>(const Integer&a,const Integer&b){return a.compare(b)>0;}inline bool operator<=(const Integer&a,const Integer&b){return a.compare(b)<=0;}inline bool operator>=(const Integer&a,const Integer&b){return a.compare(b)>=0;}

class Rational {
    Integer n_,d_=Integer(1);
    static Rational raw(Integer n,Integer d){Rational r;r.n_=static_cast<Integer&&>(n);r.d_=static_cast<Integer&&>(d);return r;}
public:
    Rational()=default;Rational(int64_t n):n_(n){}
    template<class T,typename Enable<Integral<T>::value,int>::type=0>Rational(T n):n_(n){}
    template<class T,typename Enable<Floating<T>::value,int>::type=0>Rational(T)=delete;
    Rational(Integer n,Integer d):n_(static_cast<Integer&&>(n)),d_(static_cast<Integer&&>(d)){normalize();}
    static Rational from_signed(Context&c,int64_t n){return raw(Integer::from_signed(c,n),Integer::from(c,1));}
    static Rational from_double(Context&c,double value){uint64_t bits=0;copy_bytes(&bits,&value,8);uint32_t exponent=(uint32_t)((bits>>52)&2047);uint64_t mantissa=bits&0xfffffffffffffull;if(exponent==2047){c.fail(SA_INK_INVALID);return from_signed(c,0);}int power=exponent?(int)exponent-1075:-1074;if(exponent)mantissa|=0x10000000000000ull;Integer n=Integer::from(c,mantissa),d=Integer::from(c,1);if(power>=0)n=n.shifted_left((uint32_t)power);else d=d.shifted_left((uint32_t)-power);if(bits>>63)n=-n;return Rational(static_cast<Integer&&>(n),static_cast<Integer&&>(d));}
    Rational owned(Context&c)const{return raw(n_.owned(c),d_.owned(c));}
    Context*context()const{return n_.context()?n_.context():d_.context();}const Integer&numerator()const{return n_;}const Integer&denominator()const{return d_;}bool valid()const{return n_.valid()&&d_.valid()&&!d_.zero();}bool zero()const{return n_.zero();}int sign()const{return n_.sign();}
    void normalize(){Context*c=context();if(!n_.valid()||!d_.valid()||d_.zero()){if(c)c->fail(d_.zero()?SA_INK_RANGE:SA_INK_CAPACITY);return;}if(d_.sign()<0){n_=-n_;d_=-d_;}if(n_.zero()){d_=c?Integer::from(*c,1):Integer(1);return;}Integer g=Integer::gcd(n_,d_);if(!g.valid())return;n_=n_/g;d_=d_/g;}
    Rational operator-()const{return raw(-n_,d_);}Rational absolute()const{return raw(n_.absolute(),d_);}
    Rational operator+(const Rational&b)const{Integer g=Integer::gcd(d_,b.d_),ad=d_/g,bd=b.d_/g,n=n_*bd+b.n_*ad,cancel=Integer::gcd(n,g);return raw(n/cancel,ad*(b.d_/cancel));}
    Rational operator-(const Rational&b)const{return*this+(-b);}
    Rational operator*(const Rational&b)const{Integer g=Integer::gcd(n_,b.d_),h=Integer::gcd(b.n_,d_);return raw((n_/g)*(b.n_/h),(d_/h)*(b.d_/g));}
    Rational operator/(const Rational&b)const{if(b.zero()){Context*c=context()?context():b.context();if(c)c->fail(SA_INK_RANGE);return raw(Integer(),Integer());}Integer g=Integer::gcd(n_,b.n_),h=Integer::gcd(b.d_,d_);Integer n=(n_/g)*(b.d_/h),d=(d_/h)*(b.n_/g);if(d.sign()<0){n=-n;d=-d;}return raw(static_cast<Integer&&>(n),static_cast<Integer&&>(d));}
    Rational&operator+=(const Rational&b){*this=*this+b;return*this;}Rational&operator-=(const Rational&b){*this=*this-b;return*this;}Rational&operator*=(const Rational&b){*this=*this*b;return*this;}Rational&operator/=(const Rational&b){*this=*this/b;return*this;}
    int compare(const Rational&b)const{if(n_.sign()!=b.n_.sign())return n_.sign()<b.n_.sign()?-1:1;if(!n_.sign())return 0;if(d_==b.d_)return n_.compare(b.n_);Integer g=Integer::gcd(d_,b.d_);return(n_*(b.d_/g)).compare(b.n_*(d_/g));}
    bool stored()const{return valid()&&n_.bits()<=stored_bits&&d_.bits()<=stored_bits;}
    // Adjacent binary64 endpoints enclosing the exact rational, independent of
    // the active hardware rounding mode. Conversion uses integer division only.
    bool bounds(double&lower,double&upper)const{
        if(!valid())return false;Context*c=context();if(!c||c->status!=SA_INK_OK)return false;Integer n=n_.absolute(),d=d_;if(n.zero()){lower=upper=0;return true;}int e=(int)n.bits()-(int)d.bits();if(e>=0){if(n<d.shifted_left((uint32_t)e))--e;}else if(n.shifted_left((uint32_t)-e)<d)--e;
        uint64_t lo=0,hi=0;if(e>1023){lo=0x7fefffffffffffffull;hi=0x7ff0000000000000ull;}else if(e< -1074){lo=0;hi=1;}else{int power=e< -1022?1074:52-e;Integer a=n,b=d;if(power>=0)a=a.shifted_left((uint32_t)power);else b=b.shifted_left((uint32_t)-power);Integer q,r;if(!Integer::divmod(a,b,q,r)||c->status!=SA_INK_OK)return false;uint64_t mantissa=q.unsigned_value();lo=e< -1022?mantissa:(uint64_t(e+1023)<<52)|(mantissa-0x10000000000000ull);hi=lo+(r.zero()?0:1);}
        if(c->status!=SA_INK_OK)return false;double a,b;if(n_.sign()<0){uint64_t x=hi|0x8000000000000000ull,y=lo|0x8000000000000000ull;copy_bytes(&a,&x,8);copy_bytes(&b,&y,8);}else{copy_bytes(&a,&lo,8);copy_bytes(&b,&hi,8);}lower=a;upper=b;return true;
    }
};
inline bool operator==(const Rational&a,const Rational&b){return a.compare(b)==0;}inline bool operator!=(const Rational&a,const Rational&b){return a.compare(b)!=0;}inline bool operator<(const Rational&a,const Rational&b){return a.compare(b)<0;}inline bool operator>(const Rational&a,const Rational&b){return a.compare(b)>0;}inline bool operator<=(const Rational&a,const Rational&b){return a.compare(b)<=0;}inline bool operator>=(const Rational&a,const Rational&b){return a.compare(b)>=0;}
}
#endif
