#ifndef SHOWAI_BOUNDARY_RECORD_HPP
#define SHOWAI_BOUNDARY_RECORD_HPP
#include "number.hpp"
namespace showai_boundary {
// Immutable arena-owned records. A retained handle never exposes mutable data.
// Copying a root/certificate increments only a bounded record reference count.
template<class T>class Record {
    Pointer<Context>ctx_;uint32_t offset_=no_block,reserved_=0;
    void release(){if(ctx_&&offset_!=no_block){if(ctx_->block(offset_).refs==1)((T*)ctx_->payload(offset_))->~T();ctx_->release(offset_);}offset_=no_block;}
public:
    Record()=default;
    static Record create(Context&c,const T&value){Record r;r.ctx_=&c;if(sizeof(T)>0x3ffffff0u){c.fail(SA_INK_CAPACITY);return r;}r.offset_=c.allocate((uint32_t)sizeof(T));if(r.offset_!=no_block)::new((void*)c.payload(r.offset_))T(value);return r;}
    Record(const Record&r):ctx_(r.ctx_),offset_(r.offset_){if(ctx_)ctx_->retain(offset_);}
    Record(Record&&r)noexcept:ctx_(r.ctx_),offset_(r.offset_){r.offset_=no_block;}
    Record&operator=(const Record&r){if(this!=&r){if(r.ctx_)r.ctx_->retain(r.offset_);release();ctx_=r.ctx_;offset_=r.offset_;}return*this;}
    Record&operator=(Record&&r)noexcept{if(this!=&r){release();ctx_=r.ctx_;offset_=r.offset_;r.offset_=no_block;}return*this;}
    ~Record(){release();}
    bool valid()const{return ctx_&&offset_!=no_block;}Context*context()const{return ctx_;}
    const T*get()const{return valid()?(const T*)ctx_->payload(offset_):nullptr;}
};
static_assert(sizeof(Record<uint32_t>)==16,"portable record layout");
}
#endif
