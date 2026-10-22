#ifndef SHOWAI_BOUNDARY_PAGED_VECTOR_HPP
#define SHOWAI_BOUNDARY_PAGED_VECTOR_HPP
#include "record.hpp"
namespace showai_boundary {
/* A fixed-radix immutable/COW sequence. Forking retains one root. A point edit
 * clones at most one page and one node per level, never the full source/cut map.
 * All pages, branch copies and inflight roots share the same bounded arena. */
template<class T,uint32_t Bits=4>class PagedVector{
    static_assert(Bits>=2&&Bits<=6,"bounded radix");static constexpr uint32_t width=uint32_t(1)<<Bits;
    struct Page{T values[width]{};};
    struct Node{Record<Node>children[width];Record<Page>page;};
    Pointer<Context>ctx_;Record<Node>root_;uint32_t count_=0,level_=0;T zero_{};mutable T invalid_{};
    T*editable(uint32_t index){
        if(!ctx_||ctx_->status)return nullptr;
        uint32_t required=0;uint64_t capacity=width;while(index>=capacity){capacity*=width;++required;if(required>7){ctx_->fail(SA_INK_CAPACITY);return nullptr;}}
        while(level_<required){Node n;n.children[0]=root_;auto next=Record<Node>::create(*ctx_,n);if(!next.valid()||ctx_->status)return nullptr;root_=static_cast<Record<Node>&&>(next);++level_;}
        if(!root_.valid())root_=Record<Node>::create(*ctx_,Node());Record<Node>*handle=&root_;
        for(uint32_t level=level_;;--level){Node*node=handle->edit();if(!node)return nullptr;if(!level){if(!node->page.valid())node->page=Record<Page>::create(*ctx_,Page());Page*page=node->page.edit();return page?&page->values[index&(width-1)]:nullptr;}
            uint32_t shift=level*Bits;if(shift>=32){ctx_->fail(SA_INK_CAPACITY);return nullptr;}handle=&node->children[(index>>shift)&(width-1)];if(!handle->valid())*handle=Record<Node>::create(*ctx_,Node());
        }
    }
public:
    PagedVector()=default;explicit PagedVector(Context&c):ctx_(&c){}
    Context*context()const{return ctx_;}uint32_t size()const{return count_;}bool empty()const{return !count_;}
    const T&operator[](uint32_t index)const{if(index>=count_){if(ctx_)ctx_->fail(SA_INK_RANGE);return invalid_;}const Node*node=root_.get();for(uint32_t level=level_;level&&node;--level){uint32_t shift=level*Bits;node=node->children[(index>>shift)&(width-1)].get();}if(!node||!node->page.valid())return zero_;return node->page.get()->values[index&(width-1)];}
    T&operator[](uint32_t index){if(index>=count_){if(ctx_)ctx_->fail(SA_INK_RANGE);return invalid_;}T*value=editable(index);return value?*value:invalid_;}
    const T&back()const{return(*this)[count_?count_-1:0];}T&back(){return(*this)[count_?count_-1:0];}
    bool push_back(const T&value){if(count_==0xffffffffu){if(ctx_)ctx_->fail(SA_INK_CAPACITY);return false;}T*destination=editable(count_);if(!destination)return false;*destination=value;if(ctx_->status)return false;++count_;return true;}
    bool resize(uint32_t count){if(!ctx_||ctx_->status)return false;if(count>=count_){count_=count;return true;}if(!count){clear();return true;}while(count_>count&&!ctx_->status)pop_back();return count_==count;}
    void pop_back(){if(!count_)return;T*value=editable(count_-1);if(!value)return;*value=T();if(!ctx_->status)--count_;}
    void clear(){root_={};count_=level_=0;}
    struct Iterator{const PagedVector*vector;uint32_t index;const T&operator*()const{return(*vector)[index];}Iterator&operator++(){++index;return*this;}bool operator!=(Iterator other)const{return vector!=other.vector||index!=other.index;}};
    Iterator begin()const{return{this,0};}Iterator end()const{return{this,count_};}
};
}
#endif
