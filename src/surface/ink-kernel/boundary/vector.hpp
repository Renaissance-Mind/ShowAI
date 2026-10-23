#ifndef SHOWAI_BOUNDARY_VECTOR_HPP
#define SHOWAI_BOUNDARY_VECTOR_HPP
#include "number.hpp"
namespace showai_boundary {
template<class T>inline auto value_context(const T&v,int)->decltype(v.context()){return v.context();}
template<class T>inline Context*value_context(const T&,long){return nullptr;}
template<class T,uint32_t Inline=4>class Vector {
    Pointer<Context>ctx_;uint32_t offset_=no_block,count_=0,capacity_=Inline;T local_[Inline]{};mutable T invalid_{};
    T*pointer(){return offset_==no_block?local_:(T*)ctx_->payload(offset_);}const T*pointer()const{return offset_==no_block?local_:(const T*)ctx_->payload(offset_);}
    void release(){if(offset_!=no_block){if(ctx_->block(offset_).refs==1)for(uint32_t i=0;i<count_;i++)pointer()[i].~T();ctx_->release(offset_);offset_=no_block;}else for(uint32_t i=0;i<count_;i++)local_[i]=T();count_=0;capacity_=Inline;}
    bool unique(uint32_t wanted){
        if(ctx_&&ctx_->status!=SA_INK_OK)return false;if(wanted<=capacity_&&(offset_==no_block||ctx_->block(offset_).refs==1))return true;
        if(!ctx_)return false;
        // The arena already rounds (payload + its header) to buddy blocks.
        // Rounding the element count first can double the block again. Ask
        // for the actual minimum and use every complete slot in that block;
        // crossing its capacity still grows geometrically through the arena.
        if(uint64_t(wanted)*sizeof(T)>0x3ffffff0u){ctx_->fail(SA_INK_CAPACITY);return false;}
        uint32_t fresh=ctx_->allocate(wanted*uint32_t(sizeof(T)));if(fresh==no_block)return false;
        uint32_t next=((uint32_t(1)<<ctx_->block(fresh).order)-16u)/uint32_t(sizeof(T));
        T*p=(T*)ctx_->payload(fresh);const T*old=pointer();for(uint32_t i=0;i<count_;i++)::new((void*)(p+i))T(old[i]);
        if(offset_!=no_block){if(ctx_->block(offset_).refs==1)for(uint32_t i=0;i<count_;i++)pointer()[i].~T();ctx_->release(offset_);}else for(uint32_t i=0;i<count_;i++)local_[i]=T();offset_=fresh;capacity_=next;return true;
    }
    void absorb(const T&value){Context*other=value_context(value,0);if(!ctx_)ctx_=other;else if(other&&other!=ctx_)ctx_->fail(SA_INK_INVALID);}
public:
    Vector()=default;explicit Vector(Context&c):ctx_(&c){}
    Vector(const Vector&v):ctx_(v.ctx_),offset_(v.offset_),count_(v.count_),capacity_(v.capacity_){if(offset_!=no_block)ctx_->retain(offset_);else for(uint32_t i=0;i<count_;i++)local_[i]=v.local_[i];}
    Vector(Vector&&v)noexcept:ctx_(v.ctx_),offset_(v.offset_),count_(v.count_),capacity_(v.capacity_){if(offset_==no_block)for(uint32_t i=0;i<count_;i++)local_[i]=static_cast<T&&>(v.local_[i]);v.offset_=no_block;v.count_=0;v.capacity_=Inline;}
    Vector&operator=(const Vector&v){if(this==&v)return*this;release();ctx_=v.ctx_;offset_=v.offset_;count_=v.count_;capacity_=v.capacity_;if(offset_!=no_block)ctx_->retain(offset_);else for(uint32_t i=0;i<count_;i++)local_[i]=v.local_[i];return*this;}
    Vector&operator=(Vector&&v)noexcept{if(this==&v)return*this;release();ctx_=v.ctx_;offset_=v.offset_;count_=v.count_;capacity_=v.capacity_;if(offset_==no_block)for(uint32_t i=0;i<count_;i++)local_[i]=static_cast<T&&>(v.local_[i]);v.offset_=no_block;v.count_=0;v.capacity_=Inline;return*this;}
    ~Vector(){release();}
    Context*context()const{return ctx_;}uint32_t size()const{return count_;}bool empty()const{return count_==0;}
    const T&operator[](uint32_t i)const{if(i<count_)return pointer()[i];if(ctx_)ctx_->fail(SA_INK_RANGE);return invalid_;}
    T&operator[](uint32_t i){if(i<count_&&unique(count_))return pointer()[i];if(ctx_&&i>=count_)ctx_->fail(SA_INK_RANGE);return invalid_;}
    const T&back()const{return(*this)[count_?count_-1:0];}T&back(){return(*this)[count_?count_-1:0];}
    const T*begin()const{return pointer();}const T*end()const{return pointer()+count_;}
    bool push_back(const T&v){absorb(v);if(count_==0xffffffffu||!unique(count_+1)){if(ctx_)ctx_->fail(SA_INK_CAPACITY);return false;}if(offset_==no_block)local_[count_]=v;else::new((void*)(pointer()+count_))T(v);++count_;return true;}
    void pop_back(){if(!count_)return;if(!unique(count_))return;--count_;if(offset_==no_block)local_[count_]=T();else pointer()[count_].~T();}
    bool resize(uint32_t n){if(n<count_){while(count_>n&&(!ctx_||ctx_->status==SA_INK_OK))pop_back();return count_==n;}if(!unique(n)){if(ctx_)ctx_->fail(SA_INK_CAPACITY);return false;}while(count_<n){if(offset_==no_block)local_[count_]=T();else::new((void*)(pointer()+count_))T();++count_;}return true;}
    void clear(){release();}
};
}
#endif
