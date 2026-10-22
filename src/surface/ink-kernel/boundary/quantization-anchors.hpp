#ifndef SHOWAI_BOUNDARY_QUANTIZATION_ANCHORS_HPP
#define SHOWAI_BOUNDARY_QUANTIZATION_ANCHORS_HPP
#include "quantization-block.hpp"
#include "vertex.hpp"
namespace showai_boundary {
// Private indices locate candidates only. Every use also compares the actual
// producer PointAuthority record; an integer never establishes point equality.
struct BoundaryAnchorBinding {
 Record<PointAuthority>point;Record<VertexCertificate>certificate;Record<BoundaryQuantizedVertex>anchor;
};
class BoundaryAnchorTable {
 struct Node{uint64_t key=0;uint32_t height=1,count=1;Record<BoundaryAnchorBinding>value;Record<Node>left,right;};
 static_assert(sizeof(Node)==64,"portable anchor tree layout");
 Pointer<Context>context_;Record<Node>root_;mutable uint64_t visits_=0;uint64_t created_=0;
 static uint32_t height(const Record<Node>&n){return n.valid()?n.get()->height:0;}
 static uint32_t count(const Record<Node>&n){return n.valid()?n.get()->count:0;}
 Record<Node>node(uint64_t key,const Record<BoundaryAnchorBinding>&value,const Record<Node>&left,const Record<Node>&right){
  if(context_->status)return{};uint64_t total=uint64_t(count(left))+count(right)+1;if(total>UINT32_MAX){context_->fail(SA_INK_CAPACITY);return{};}
  Node n;n.key=key;n.value=value;n.left=left;n.right=right;n.count=uint32_t(total);n.height=1+(height(left)>height(right)?height(left):height(right));auto result=Record<Node>::create(*context_,n);if(result.valid())++created_;return result;
 }
 Record<Node>balance(uint64_t key,const Record<BoundaryAnchorBinding>&value,const Record<Node>&left,const Record<Node>&right){
  if(context_->status)return{};int delta=int(height(left))-int(height(right));
  if(delta>1){const auto&l=*left.get();if(height(l.left)>=height(l.right)){auto r=node(key,value,l.right,right);return node(l.key,l.value,l.left,r);}const auto&m=*l.right.get();auto a=node(l.key,l.value,l.left,m.left),b=node(key,value,m.right,right);return node(m.key,m.value,a,b);}
  if(delta< -1){const auto&r=*right.get();if(height(r.right)>=height(r.left)){auto l=node(key,value,left,r.left);return node(r.key,r.value,l,r.right);}const auto&m=*r.left.get();auto a=node(key,value,left,m.left),b=node(r.key,r.value,m.right,r.right);return node(m.key,m.value,a,b);}
  return node(key,value,left,right);
 }
 Record<Node>put(const Record<Node>&root,uint64_t key,const Record<BoundaryAnchorBinding>&value){
  if(context_->status||!context_->step())return{};++visits_;if(!root.valid())return node(key,value,{},{});const auto&n=*root.get();if(key==n.key)return node(key,value,n.left,n.right);if(key<n.key){auto next=put(n.left,key,value);return balance(n.key,n.value,next,n.right);}auto next=put(n.right,key,value);return balance(n.key,n.value,n.left,next);
 }
 Record<Node>remove(const Record<Node>&root,uint64_t key){
  if(context_->status||!root.valid())return root;if(!context_->step())return{};++visits_;const auto&n=*root.get();if(key<n.key){auto next=remove(n.left,key);return balance(n.key,n.value,next,n.right);}if(key>n.key){auto next=remove(n.right,key);return balance(n.key,n.value,n.left,next);}if(!n.left.valid())return n.right;if(!n.right.valid())return n.left;const Node*next=n.right.get();while(next->left.valid()){if(!context_->step())return{};++visits_;next=next->left.get();}auto right=remove(n.right,next->key);return balance(next->key,next->value,n.left,right);
 }
public:
 BoundaryAnchorTable()=default;explicit BoundaryAnchorTable(Context&c):context_(&c){}
 Context*context()const{return context_;}uint32_t size()const{return count(root_);}
 uint64_t visits()const{return visits_;}uint64_t created_nodes()const{return created_;}void reset_metrics(){visits_=created_=0;}
 const BoundaryAnchorBinding*get(const Record<PointAuthority>&actual)const{
  if(!actual.valid()||actual.context()!=context_)return nullptr;const Node*n=root_.get();const uint64_t key=actual.get()->identity;
  while(n){if(!context_->step())return nullptr;++visits_;if(key==n->key)return n->value.get()->point.get()==actual.get()?n->value.get():nullptr;n=(key<n->key?n->left:n->right).get();}return nullptr;
 }
 bool set(const BoundaryAnchorBinding&binding){
  if(!binding.point.valid()||!binding.anchor.valid()||binding.point.context()!=context_||binding.anchor.context()!=context_||!binding.point.get()->identity){context_->fail(SA_INK_INVALID);return false;}
  const Node*existing=root_.get();while(existing){if(!context_->step())return false;++visits_;if(existing->key==binding.point.get()->identity){if(existing->value.get()->point.get()!=binding.point.get()){context_->fail(SA_INK_INVALID);return false;}break;}existing=(binding.point.get()->identity<existing->key?existing->left:existing->right).get();}
  auto value=Record<BoundaryAnchorBinding>::create(*context_,binding);if(!value.valid())return false;auto next=put(root_,binding.point.get()->identity,value);if(context_->status)return false;root_=static_cast<Record<Node>&&>(next);return true;
 }
 bool erase(const Record<PointAuthority>&actual){
  if(!get(actual))return !context_->status;auto next=remove(root_,actual.get()->identity);if(context_->status)return false;root_=static_cast<Record<Node>&&>(next);return true;
 }
};
}
#endif
