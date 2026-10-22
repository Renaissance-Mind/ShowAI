#ifndef SHOWAI_BOUNDARY_VERTEX_HPP
#define SHOWAI_BOUNDARY_VERTEX_HPP
#include "algebra.hpp"
#include "chunk-tree.hpp"
#include "../include/boundary-kernel.h"
namespace showai_boundary {
// Lifetime-safe witnesses: no reference back into a recyclable curve slot.
struct PointFunction{Polynomial x,y;PointFunction()=default;explicit PointFunction(const Curve&c):x(c.x),y(c.y){}Context*context()const{return x.context();}};
struct AlgebraicPoint{Record<PointFunction>function;Root parameter;AlgebraicPoint()=default;AlgebraicPoint(const Record<PointFunction>&f,const Root&t):function(f),parameter(t){}Context*context()const{return parameter.context();}};
struct PointAuthority{
 uint64_t identity=0;Point rational;Record<AlgebraicPoint>algebraic;
 bool exact()const{return !algebraic.valid();}Context*context()const{return exact()?rational.context():algebraic.context();}
};
struct VertexCertificate{Record<PointAuthority>point;Interval x,y;uint64_t revision=0;Context*context()const{return point.context();}};
struct PointAlias{Record<PointAuthority>a,b,point;Record<VertexCertificate>before_a,before_b,after;uint32_t vertex_a=0,vertex_b=0,target=0,reserved=0;Context*context()const{return point.context();}};
struct VertexCertificateChange{uint32_t vertex=0,reserved=0;Record<VertexCertificate>before,after;};
struct VertexCertificateLookup{uint32_t canonical=0xffffffffu,steps=0;Record<VertexCertificate>certificate;};
// Incidence holds the actual immutable output record, not just a caller key.
// Endpoint multiplicity is independent of orientation and may exceed two for
// a self-intersecting curve block. Each root is persistent / source-owned.
template<class T>struct IncidentNode{
 using Chunk=typename ChunkTree<T>::Chunk;
 Record<Chunk>block;uint64_t epoch=0;uint32_t slot=0,references=0,height=1,blocks=1;uint64_t endpoints=0;Record<IncidentNode>left,right;
};
template<class T>inline uint32_t incident_height(const Record<IncidentNode<T>>&r){return r.valid()?r.get()->height:0;}
template<class T>inline uint32_t incident_blocks(const Record<IncidentNode<T>>&r){return r.valid()?r.get()->blocks:0;}
template<class T>inline uint64_t incident_endpoints(const Record<IncidentNode<T>>&r){return r.valid()?r.get()->endpoints:0;}
template<class T>inline Record<IncidentNode<T>> incident_node(Context&c,const Record<typename ChunkTree<T>::Chunk>&block,uint64_t epoch,uint32_t slot,uint32_t references,const Record<IncidentNode<T>>&left,const Record<IncidentNode<T>>&right){
 if(c.status)return{};if(!block.valid()||block.context()!=&c||!references){c.fail(SA_INK_INVALID);return{};}IncidentNode<T>n;n.block=block;n.epoch=epoch;n.slot=slot;n.references=references;n.left=left;n.right=right;n.height=1+(incident_height(left)>incident_height(right)?incident_height(left):incident_height(right));n.blocks=1+incident_blocks(left)+incident_blocks(right);n.endpoints=references+incident_endpoints(left)+incident_endpoints(right);return Record<IncidentNode<T>>::create(c,n);
}
template<class T>inline Record<IncidentNode<T>> incident_balance(Context&c,const Record<typename ChunkTree<T>::Chunk>&block,uint64_t epoch,uint32_t slot,uint32_t references,const Record<IncidentNode<T>>&left,const Record<IncidentNode<T>>&right){
 if(c.status)return{};int b=int(incident_height(left))-int(incident_height(right));
 if(b>1){const auto&l=*left.get();if(incident_height(l.left)>=incident_height(l.right)){auto r=incident_node(c,block,epoch,slot,references,l.right,right);return incident_node(c,l.block,l.epoch,l.slot,l.references,l.left,r);}const auto&m=*l.right.get();auto a=incident_node(c,l.block,l.epoch,l.slot,l.references,l.left,m.left),z=incident_node(c,block,epoch,slot,references,m.right,right);return incident_node(c,m.block,m.epoch,m.slot,m.references,a,z);}
 if(b< -1){const auto&r=*right.get();if(incident_height(r.right)>=incident_height(r.left)){auto l=incident_node(c,block,epoch,slot,references,left,r.left);return incident_node(c,r.block,r.epoch,r.slot,r.references,l,r.right);}const auto&m=*r.left.get();auto a=incident_node(c,block,epoch,slot,references,left,m.left),z=incident_node(c,r.block,r.epoch,r.slot,r.references,m.right,r.right);return incident_node(c,m.block,m.epoch,m.slot,m.references,a,z);}
 return incident_node(c,block,epoch,slot,references,left,right);
}
template<class T>inline const IncidentNode<T>*incident_lookup(const Record<IncidentNode<T>>&root,uint32_t slot){const auto*n=root.get();while(n){if(!root.context()->step())return nullptr;if(slot==n->slot)return n;n=(slot<n->slot?n->left:n->right).get();}return nullptr;}
template<class T>inline Record<IncidentNode<T>> incident_replace(Context&c,const Record<IncidentNode<T>>&root,const Record<typename ChunkTree<T>::Chunk>&block,uint64_t epoch,uint32_t slot,uint32_t references){
 if(c.status||!c.step())return{};if(!root.valid()){if(!references)return{};return incident_node<T>(c,block,epoch,slot,references,{},{});}const auto&n=*root.get();if(slot<n.slot){auto next=incident_replace(c,n.left,block,epoch,slot,references);return incident_balance(c,n.block,n.epoch,n.slot,n.references,next,n.right);}if(slot>n.slot){auto next=incident_replace(c,n.right,block,epoch,slot,references);return incident_balance(c,n.block,n.epoch,n.slot,n.references,n.left,next);}
 if(references)return incident_node(c,block,epoch,slot,references,n.left,n.right);if(!n.left.valid())return n.right;if(!n.right.valid())return n.left;const auto*next=n.right.get();while(next->left.valid()){if(!c.step())return{};next=next->left.get();}auto right=incident_replace(c,n.right,next->block,next->epoch,next->slot,0);return incident_balance(c,next->block,next->epoch,next->slot,next->references,n.left,right);
}
template<class T>inline bool incident_adjust(Context&c,Record<IncidentNode<T>>&root,const Record<typename ChunkTree<T>::Chunk>&block,uint64_t epoch,uint32_t slot,int64_t delta){
 if(c.status||!block.valid()||block.context()!=&c||!delta){if(!c.status)c.fail(SA_INK_INVALID);return false;}const auto*old=incident_lookup(root,slot);uint64_t before=old?old->references:0;if(old&&(old->epoch!=epoch||old->block.get()!=block.get())){c.fail(SA_INK_RANGE);return false;}uint64_t magnitude=delta<0?uint64_t(-(delta+1))+1:uint64_t(delta);if((delta<0&&magnitude>before)||(delta>0&&uint64_t(delta)>UINT32_MAX-before)){c.fail(SA_INK_RANGE);return false;}uint32_t references=uint32_t(int64_t(before)+delta);auto next=incident_replace(c,root,block,epoch,slot,references);if(c.status)return false;root=static_cast<Record<IncidentNode<T>>&&>(next);return true;
}
template<class T,class Visit>inline bool incident_each(const Record<IncidentNode<T>>&root,Visit visit){
 const IncidentNode<T>*stack[64]{};uint32_t depth=0;const auto*n=root.get();while(n||depth){while(n){if(depth==64){root.context()->fail(SA_INK_RANGE);return false;}if(!root.context()->step())return false;stack[depth++]=n;n=n->left.get();}n=stack[--depth];if(!visit(*n))return false;n=n->right.get();}return !root.valid()||!root.context()->status;
}
template<class T>inline bool incident_merge(Context&c,Record<IncidentNode<T>>&target,const Record<IncidentNode<T>>&other){
 if(c.status)return false;auto staged=target;bool ok=incident_each(other,[&](const IncidentNode<T>&n){return incident_adjust(c,staged,n.block,n.epoch,n.slot,n.references);});if(!ok||c.status)return false;target=static_cast<Record<IncidentNode<T>>&&>(staged);return true;
}
}
#endif
