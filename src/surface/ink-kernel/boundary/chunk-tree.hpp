#ifndef SHOWAI_BOUNDARY_CHUNK_TREE_HPP
#define SHOWAI_BOUNDARY_CHUNK_TREE_HPP
#include "record.hpp"
#include "vector.hpp"
namespace showai_boundary {
// Stable immutable chunks, ordered by their actual captured curve slot. A tree
// draft replaces a logarithmic path; retained chunk records are never edited.
// Indexing/iteration are explicit full-export helpers, not an update scan.
template<class T>class SharedChunkValues{
    Vector<Record<T>,1>records_;
public:
    SharedChunkValues()=default;explicit SharedChunkValues(Context&c):records_(c){}
    Context*context()const{return records_.context();}uint32_t size()const{return records_.size();}bool empty()const{return records_.empty();}
    const T&operator[](uint32_t i)const{return*records_[i].get();}
    bool push_back(const T&value){if(!context()||context()->status)return false;auto record=Record<T>::create(*context(),value);return record.valid()&&records_.push_back(record);}
    struct Iterator{const Record<T>*p=nullptr;const T&operator*()const{return*p->get();}Iterator&operator++(){++p;return*this;}bool operator!=(Iterator other)const{return p!=other.p;}};
    Iterator begin()const{return{records_.begin()};}Iterator end()const{return{records_.end()};}
};
template<class T>class ChunkTree{
public:
    struct Chunk{uint64_t identity=0,revision=0;SharedChunkValues<T>values;Chunk()=default;Chunk(uint64_t id,uint64_t rev,const SharedChunkValues<T>&v):identity(id),revision(rev),values(v){}};
private:
    struct Node{uint32_t key=0,height=1,count=0,chunks=1;Record<Chunk>chunk;Record<Node>left,right;};
    static_assert(sizeof(Node)==64,"portable chunk tree node layout");
    Pointer<Context>ctx_;Record<Node>root_;mutable T invalid_{};
    uint64_t visits_=0,created_=0;
    static uint32_t height(const Record<Node>&n){return n.valid()?n.get()->height:0;}
    static uint32_t count(const Record<Node>&n){return n.valid()?n.get()->count:0;}
    static uint32_t chunks(const Record<Node>&n){return n.valid()?n.get()->chunks:0;}
    Record<Node>node(uint32_t key,const Record<Chunk>&chunk,const Record<Node>&left,const Record<Node>&right){
        if(ctx_->status)return{};uint64_t total=uint64_t(count(left))+count(right)+chunk.get()->values.size();if(total>UINT32_MAX){ctx_->fail(SA_INK_CAPACITY);return{};}
        Node n;n.key=key;n.chunk=chunk;n.left=left;n.right=right;n.height=1+(height(left)>height(right)?height(left):height(right));n.count=uint32_t(total);n.chunks=1+chunks(left)+chunks(right);auto r=Record<Node>::create(*ctx_,n);if(r.valid())++created_;return r;
    }
    Record<Node>balance(uint32_t key,const Record<Chunk>&chunk,const Record<Node>&left,const Record<Node>&right){
        if(ctx_->status)return{};int b=int(height(left))-int(height(right));
        if(b>1){const auto&l=*left.get();if(height(l.left)>=height(l.right)){auto r=node(key,chunk,l.right,right);return node(l.key,l.chunk,l.left,r);}const auto&m=*l.right.get();auto a=node(l.key,l.chunk,l.left,m.left),z=node(key,chunk,m.right,right);return node(m.key,m.chunk,a,z);}
        if(b< -1){const auto&r=*right.get();if(height(r.right)>=height(r.left)){auto l=node(key,chunk,left,r.left);return node(r.key,r.chunk,l,r.right);}const auto&m=*r.left.get();auto a=node(key,chunk,left,m.left),z=node(r.key,r.chunk,m.right,r.right);return node(m.key,m.chunk,a,z);}
        return node(key,chunk,left,right);
    }
    Record<Node>put(const Record<Node>&root,uint32_t key,const Record<Chunk>&chunk){
        if(ctx_->status)return{};++visits_;if(!root.valid())return node(key,chunk,{},{});const auto&n=*root.get();if(key==n.key)return node(key,chunk,n.left,n.right);if(key<n.key){auto next=put(n.left,key,chunk);return balance(n.key,n.chunk,next,n.right);}auto next=put(n.right,key,chunk);return balance(n.key,n.chunk,n.left,next);
    }
    Record<Node>remove(const Record<Node>&root,uint32_t key){
        if(ctx_->status||!root.valid())return root;++visits_;const auto&n=*root.get();if(key<n.key){auto next=remove(n.left,key);return balance(n.key,n.chunk,next,n.right);}if(key>n.key){auto next=remove(n.right,key);return balance(n.key,n.chunk,n.left,next);}if(!n.left.valid())return n.right;if(!n.right.valid())return n.left;const Node*next=n.right.get();while(next->left.valid()){++visits_;next=next->left.get();}auto right=remove(n.right,next->key);return balance(next->key,next->chunk,n.left,right);
    }
public:
    ChunkTree()=default;explicit ChunkTree(Context&c):ctx_(&c){}
    Context*context()const{return ctx_;}uint32_t size()const{return count(root_);}uint32_t chunk_count()const{return chunks(root_);}bool empty()const{return !size();}
    uint64_t visits()const{return visits_;}uint64_t created_nodes()const{return created_;}void reset_metrics(){visits_=created_=0;}
    const Chunk*chunk(uint32_t key)const{const Node*n=root_.get();while(n){if(key==n->key)return n->chunk.get();n=(key<n->key?n->left:n->right).get();}return nullptr;}
    const Chunk*chunk_at(uint32_t index,uint32_t&key)const{const Node*n=root_.get();while(n){uint32_t left=chunks(n->left);if(index<left)n=n->left.get();else if(index==left){key=n->key;return n->chunk.get();}else{index-=left+1;n=n->right.get();}}if(ctx_)ctx_->fail(SA_INK_RANGE);return nullptr;}
    Record<Chunk>chunk_record(uint32_t key)const{const Node*n=root_.get();while(n){if(key==n->key)return n->chunk;n=(key<n->key?n->left:n->right).get();}return{};}
    bool same_chunk(uint32_t key,const ChunkTree&other)const{return context()==other.context()&&chunk(key)&&chunk(key)==other.chunk(key);}
    bool set_owned(uint32_t key,uint64_t identity,uint64_t revision,const SharedChunkValues<T>&values){
        if(!ctx_||ctx_->status)return false;if(values.context()!=ctx_){ctx_->fail(SA_INK_INVALID);return false;}if(values.empty())return erase(key);auto c=Record<Chunk>::create(*ctx_,Chunk(identity,revision,values));if(!c.valid())return false;auto next=put(root_,key,c);if(ctx_->status)return false;root_=static_cast<Record<Node>&&>(next);return true;
    }
    bool set(uint32_t key,uint64_t identity,uint64_t revision,const Vector<T,1>&values){if(!ctx_||ctx_->status)return false;if(values.context()!=ctx_){ctx_->fail(SA_INK_INVALID);return false;}SharedChunkValues<T>owned(*ctx_);for(const auto&value:values)if(!owned.push_back(value))return false;return set_owned(key,identity,revision,owned);}
    bool append(uint32_t key,uint64_t identity,uint64_t revision,const T&value){SharedChunkValues<T>values(*ctx_);if(const Chunk*old=chunk(key))values=old->values;values.push_back(value);return !ctx_->status&&set_owned(key,identity,revision,values);}
    bool erase(uint32_t key){if(!ctx_||ctx_->status)return false;if(!chunk(key))return true;auto next=remove(root_,key);if(ctx_->status)return false;root_=static_cast<Record<Node>&&>(next);return true;}
    void clear(){root_={};visits_=created_=0;}
    const T&operator[](uint32_t index)const{const Node*n=root_.get();while(n){uint32_t left=count(n->left),own=n->chunk.get()->values.size();if(index<left)n=n->left.get();else if(index<left+own)return n->chunk.get()->values[index-left];else{index-=left+own;n=n->right.get();}}if(ctx_)ctx_->fail(SA_INK_RANGE);return invalid_;}
    class Iterator{
        const Node*stack_[64]{};uint32_t depth_=0,index_=0;Pointer<Context>ctx_;
        void left(const Node*n){while(n){if(depth_==64){if(ctx_)ctx_->fail(SA_INK_RANGE);depth_=0;return;}stack_[depth_++]=n;n=n->left.get();}}
    public:
        Iterator()=default;Iterator(Context*c,const Node*n):ctx_(c){left(n);}
        const T&operator*()const{return stack_[depth_-1]->chunk.get()->values[index_];}
        Iterator&operator++(){const Node*n=stack_[depth_-1];if(++index_<n->chunk.get()->values.size())return*this;index_=0;--depth_;left(n->right.get());return*this;}
        bool operator!=(const Iterator&other)const{return depth_!=other.depth_||(depth_&&stack_[depth_-1]!=other.stack_[other.depth_-1])||index_!=other.index_;}
    };
    Iterator begin()const{return Iterator(ctx_,root_.get());}Iterator end()const{return{};}
    template<class Visit>void each_chunk(Visit visit)const{const Node*stack[64]{};uint32_t depth=0;const Node*n=root_.get();while(n||depth){while(n){if(depth==64){if(ctx_)ctx_->fail(SA_INK_RANGE);return;}stack[depth++]=n;n=n->left.get();}n=stack[--depth];visit(n->key,*n->chunk.get());n=n->right.get();}}
};
}
#endif
