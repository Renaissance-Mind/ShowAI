#ifndef SHOWAI_BOUNDARY_MESH_PAGES_HPP
#define SHOWAI_BOUNDARY_MESH_PAGES_HPP
#include "vector.hpp"
namespace showai_boundary {
/* Append-only derived POD storage. Each page occupies one 4 KiB arena block,
 * including its header. Growing a mesh never retains an old whole-mesh array
 * beside a doubled replacement. Output order and all payload bytes are exact.
 * Ownership is unique; only the small page-offset table uses Vector's COW. */
template<class T> class MeshPages {
    static_assert(__is_trivially_copyable(T),"mesh pages contain only POD output");
    static constexpr uint32_t page_bytes=4096,slots=(page_bytes-16)/sizeof(T);
    Pointer<Context>ctx_;Vector<uint32_t>pages_;uint32_t count_=0;mutable T invalid_{};
    void release(){if(ctx_)for(uint32_t page:pages_)ctx_->release(page);pages_.clear();count_=0;}
    T*page(uint32_t index){return(T*)ctx_->payload(pages_[index]);}
    const T*page(uint32_t index)const{return(const T*)ctx_->payload(pages_[index]);}
public:
    explicit MeshPages(Context&c):ctx_(&c),pages_(c){}
    MeshPages(const MeshPages&)=delete;MeshPages&operator=(const MeshPages&)=delete;
    MeshPages(MeshPages&&v)noexcept:ctx_(v.ctx_),pages_(static_cast<Vector<uint32_t>&&>(v.pages_)),count_(v.count_){v.count_=0;}
    MeshPages&operator=(MeshPages&&v)noexcept{if(this!=&v){release();ctx_=v.ctx_;pages_=static_cast<Vector<uint32_t>&&>(v.pages_);count_=v.count_;v.count_=0;}return*this;}
    ~MeshPages(){release();}
    Context*context()const{return ctx_;}uint32_t size()const{return count_;}bool empty()const{return count_==0;}
    const T&operator[](uint32_t index)const{if(index<count_)return page(index/slots)[index%slots];ctx_->fail(SA_INK_RANGE);return invalid_;}
    T&operator[](uint32_t index){if(index<count_)return page(index/slots)[index%slots];ctx_->fail(SA_INK_RANGE);return invalid_;}
    bool push_back(const T&value){
        if(ctx_->status)return false;
        if(count_==0xffffffffu){ctx_->fail(SA_INK_CAPACITY);return false;}
        if(count_/slots==pages_.size()){
            uint32_t next=ctx_->allocate(slots*uint32_t(sizeof(T)));if(next==no_block)return false;
            if(!pages_.push_back(next)){ctx_->release(next);return false;}
        }
        ::new((void*)(page(count_/slots)+count_%slots))T(value);++count_;return true;
    }
    bool resize(uint32_t count){
        if(ctx_->status)return false;
        if(count>count_){while(count_ < count)if(!push_back(T{}))return false;return true;}
        uint32_t wanted=count/slots+(count%slots?1:0);
        while(pages_.size()>wanted){ctx_->release(pages_[pages_.size()-1]);pages_.pop_back();}
        count_=count;return !ctx_->status;
    }
    struct Iterator{const MeshPages*owner;uint32_t index;const T&operator*()const{return(*owner)[index];}Iterator&operator++(){++index;return*this;}bool operator!=(Iterator other)const{return owner!=other.owner||index!=other.index;}};
    Iterator begin()const{return{this,0};}Iterator end()const{return{this,count_};}
};
}
#endif
