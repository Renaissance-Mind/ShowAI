#ifndef SHOWAI_BOUNDARY_GRAPH_HPP
#define SHOWAI_BOUNDARY_GRAPH_HPP
#include "algebra.hpp"
#include "paged-vector.hpp"
#include "../include/boundary-kernel.h"
namespace showai_boundary {
constexpr uint32_t no_index=0xffffffffu;
struct Bounds{double x0=0,y0=0,x1=0,y1=0;};
inline bool finite_double(double v){uint64_t b;copy_bytes(&b,&v,8);return((b>>52)&2047)!=2047;}
inline double lower(const Q&q){double a=0,b=0;if(!q.bounds(a,b)){if(q.context())q.context()->fail(SA_INK_RANGE);return 0;}return a;}
inline double upper(const Q&q){double a=0,b=0;if(!q.bounds(a,b)){if(q.context())q.context()->fail(SA_INK_RANGE);return 0;}return b;}
inline Bounds curve_bounds(const Curve&c){Bounds b;bool first=true;for(const auto&p:c.controls){double x0=lower(p.x),y0=lower(p.y),x1=upper(p.x),y1=upper(p.y);if(!finite_double(x0)||!finite_double(y0)||!finite_double(x1)||!finite_double(y1)){c.context()->fail(SA_INK_RANGE);return{};}if(first){b={x0,y0,x1,y1};first=false;}else{if(x0<b.x0)b.x0=x0;if(y0<b.y0)b.y0=y0;if(x1>b.x1)b.x1=x1;if(y1>b.y1)b.y1=y1;}}return b;}
inline Bounds unite(Bounds a,Bounds b){return{a.x0<b.x0?a.x0:b.x0,a.y0<b.y0?a.y0:b.y0,a.x1>b.x1?a.x1:b.x1,a.y1>b.y1?a.y1:b.y1};}
inline bool overlap(Bounds a,Bounds b){return a.x0<=b.x1&&b.x0<=a.x1&&a.y0<=b.y1&&b.y0<=a.y1;}
inline bool contains(Bounds b,double x,double y){return b.x0<=x&&x<=b.x1&&b.y0<=y&&y<=b.y1;}
// Missing entries are exact zero. Copies share arena storage until an actual
// write; the logical-path dimension is governed by the caller's whole budget,
// not a fixed Board clip-depth assumption.
struct Weight{
    Vector<int32_t,1>values;
    Weight()=default;explicit Weight(Context&c):values(c){}
    Context*context()const{return values.context();}
    int32_t&operator[](uint32_t i){if(i>=values.size())values.resize(i+1);return values[i];}
    int32_t operator[](uint32_t i)const{return i<values.size()?values[i]:0;}
    bool zero()const{for(auto x:values)if(x)return false;return true;}
};
struct Origin {uint32_t source=0,command=0,flags=0;};
struct CachedClass{uint32_t cut=0;int32_t direction=0;Weight left,right;};
struct CachedPair{uint32_t a=0,b=0;uint64_t a_identity=0,b_identity=0;PairProof proof;CachedPair()=default;CachedPair(uint32_t x,uint32_t y,uint64_t xi,uint64_t yi,const PairProof&p):a(x),b(y),a_identity(xi),b_identity(yi),proof(p){}};
struct PairSlot{Record<CachedPair>record;uint32_t occupied=0;};
struct SourceCurve {Curve geometry;Weight weight;Vector<Origin>origins;Vector<Record<CachedPair>>proofs;Vector<CachedClass>classes;uint64_t identity=0,cuts_generation=0,cache_generation=0;bool membership_valid=false,cuts_sorted=false,bounds_dirty=true;Bounds bounds;SourceCurve()=default;explicit SourceCurve(PolynomialContext&c):geometry(c),weight(c.numbers),origins(c.numbers),proofs(c.numbers),classes(c.numbers){}Context*context()const{return geometry.context();}};
struct BlockCurve {uint32_t curve=0;int32_t weight=0;};
struct CapturedBlock {SABoundarySourceBlock description{};Vector<SAInkPathCommand>commands;Vector<BlockCurve>curves;Bounds bounds;bool has_bounds=false,closed=false,active=false;CapturedBlock()=default;explicit CapturedBlock(Context&c):commands(c),curves(c){}Context*context()const{return commands.context();}};
struct SpatialKey {uint32_t words[4]{};};
inline SpatialKey spatial_key(Bounds b){uint64_t x,y;copy_bytes(&x,&b.x0,8);copy_bytes(&y,&b.y0,8);x=(x>>63)?~x:(x^0x8000000000000000ull);y=(y>>63)?~y:(y^0x8000000000000000ull);SpatialKey key;for(uint32_t bit=0;bit<64;bit++){uint32_t a=bit*2,c=a+1;key.words[a/32]|=uint32_t((x>>bit)&1u)<<(a%32);key.words[c/32]|=uint32_t((y>>bit)&1u)<<(c%32);}return key;}
inline int compare_spatial(SpatialKey a,SpatialKey b){for(uint32_t i=4;i;i--)if(a.words[i-1]!=b.words[i-1])return a.words[i-1]<b.words[i-1]?-1:1;return 0;}
struct BlockNode {SABoundarySourceKey key{};SpatialKey spatial;uint32_t block=0,height=1;Bounds own,all;Record<BlockNode>left,right;};
inline int compare_key(SABoundarySourceKey a,SABoundarySourceKey b){for(uint32_t i=0;i<4;i++)if(a.words[i]!=b.words[i])return a.words[i]<b.words[i]?-1:1;return 0;}
inline uint32_t height(const Record<BlockNode>&r){return r.valid()?r.get()->height:0;}
inline Record<BlockNode> block_node(Context&c,SABoundarySourceKey key,uint32_t index,Bounds own,const Record<BlockNode>&left,const Record<BlockNode>&right){BlockNode n;n.key=key;n.spatial=spatial_key(own);n.block=index;n.own=n.all=own;n.left=left;n.right=right;n.height=1+(height(left)>height(right)?height(left):height(right));if(left.valid())n.all=unite(n.all,left.get()->all);if(right.valid())n.all=unite(n.all,right.get()->all);return Record<BlockNode>::create(c,n);}
inline Record<BlockNode> balance_node(Context&c,SABoundarySourceKey key,uint32_t index,Bounds own,const Record<BlockNode>&left,const Record<BlockNode>&right){
    if(c.status)return{};int balance=int(height(left))-int(height(right));
    if(balance>1){const auto&l=*left.get();if(height(l.left)>=height(l.right)){auto r=block_node(c,key,index,own,l.right,right);return block_node(c,l.key,l.block,l.own,l.left,r);}const auto&m=*l.right.get();auto a=block_node(c,l.key,l.block,l.own,l.left,m.left),b=block_node(c,key,index,own,m.right,right);return block_node(c,m.key,m.block,m.own,a,b);}
    if(balance< -1){const auto&r=*right.get();if(height(r.right)>=height(r.left)){auto l=block_node(c,key,index,own,left,r.left);return block_node(c,r.key,r.block,r.own,l,r.right);}const auto&m=*r.left.get();auto a=block_node(c,key,index,own,left,m.left),b=block_node(c,r.key,r.block,r.own,m.right,r.right);return block_node(c,m.key,m.block,m.own,a,b);}
    return block_node(c,key,index,own,left,right);
}
inline Record<BlockNode> set_block(Context&c,const Record<BlockNode>&root,SABoundarySourceKey key,uint32_t index,Bounds own){if(c.status)return{};if(!root.valid())return block_node(c,key,index,own,{},{});const auto&n=*root.get();int order=compare_spatial(spatial_key(own),n.spatial);if(!order)order=compare_key(key,n.key);if(!order)return block_node(c,key,index,own,n.left,n.right);if(order<0){auto left=set_block(c,n.left,key,index,own);return balance_node(c,n.key,n.block,n.own,left,n.right);}auto right=set_block(c,n.right,key,index,own);return balance_node(c,n.key,n.block,n.own,n.left,right);}
inline Record<BlockNode> remove_block(Context&c,const Record<BlockNode>&root,SABoundarySourceKey key,Bounds own){if(c.status||!root.valid())return root;const auto&n=*root.get();int order=compare_spatial(spatial_key(own),n.spatial);if(!order)order=compare_key(key,n.key);if(order<0){auto left=remove_block(c,n.left,key,own);return balance_node(c,n.key,n.block,n.own,left,n.right);}if(order>0){auto right=remove_block(c,n.right,key,own);return balance_node(c,n.key,n.block,n.own,n.left,right);}if(!n.left.valid())return n.right;if(!n.right.valid())return n.left;const BlockNode*next=n.right.get();while(next->left.valid())next=next->left.get();auto right=remove_block(c,n.right,next->key,next->own);return balance_node(c,next->key,next->block,next->own,n.left,right);}
struct Cut{Root parameter;uint32_t vertex=0;Context*context()const{return parameter.context();}};
struct Edge{uint32_t source=0,va=0,vb=0;Root a,b;int32_t direction=0;Weight left,right;Context*context()const{return a.context();}};
struct Coincidence {uint32_t a=0,b=0;Q alpha,beta,lo,hi;Context*context()const{return alpha.context();}};
struct ExactVertexBounds{Interval x,y;bool initialized=false;};
struct GraphMetrics{uint64_t bvh_visits=0,pair_candidates=0,pair_proofs=0,pair_cache_hits=0,pair_hits=0,classifications=0,classification_cache_hits=0,winding_curves=0,classification_refinements=0;};
struct Graph {
    Pointer<PolynomialContext>math;SABoundaryBudget budget{};Vector<SABoundaryPath>paths;PagedVector<CapturedBlock>blocks;PagedVector<SourceCurve>curves;PagedVector<uint32_t,6>curve_table,source_table,free_curves,free_blocks;uint32_t active_commands=0,active_sources=0,pair_count=0;uint64_t next_curve_identity=1;PagedVector<PairSlot>pair_table;
    Record<BlockNode>block_tree,curve_tree;PagedVector<Vector<Cut>>cuts;PagedVector<uint32_t,6>parent;PagedVector<ExactVertexBounds>vertex_bounds;Vector<Edge>edges;Vector<Coincidence>coincidences;GraphMetrics metrics;uint32_t cut_count=0;
    Graph(PolynomialContext&c,const SABoundaryBudget&b):math(&c),budget(b),paths(c.numbers),blocks(c.numbers),curves(c.numbers),curve_table(c.numbers),source_table(c.numbers),free_curves(c.numbers),free_blocks(c.numbers),pair_table(c.numbers),cuts(c.numbers),parent(c.numbers),vertex_bounds(c.numbers),edges(c.numbers),coincidences(c.numbers){}
    Context*context()const{return&math->numbers;}bool good()const{return math->numbers.status==SA_INK_OK;}bool step(){return math->step();}
};
template<class T,class Less>inline void sort(Vector<T>&values,Less less){uint32_t n=values.size();if(n<2||!values.context()||values.context()->status)return;auto sift=[&](uint32_t root,uint32_t end){for(;;){if(values.context()->status)return;uint32_t child=root*2+1;if(child>=end)return;if(child+1<end&&less(values[child],values[child+1]))++child;if(!less(values[root],values[child]))return;T swap=values[root];values[root]=values[child];values[child]=swap;root=child;}};for(uint32_t i=n/2;i&&!values.context()->status;i--)sift(i-1,n);for(uint32_t i=n;i>1&&!values.context()->status;i--){T swap=values[0];values[0]=values[i-1];values[i-1]=swap;sift(0,i-1);}}
inline uint32_t vertex(Graph&g){if(g.parent.size()>=g.budget.max_cuts){g.context()->fail(SA_INK_CAPACITY);return 0;}uint32_t id=g.parent.size();g.parent.push_back(id);g.vertex_bounds.resize(g.parent.size());return id;}
inline uint32_t find(Graph&g,uint32_t v){while(g.good()&&static_cast<const Graph&>(g).parent[v]!=v){uint32_t p=static_cast<const Graph&>(g).parent[v],grand=static_cast<const Graph&>(g).parent[p];if(p!=grand)g.parent[v]=grand;v=p;}return v;}
inline void join(Graph&g,uint32_t a,uint32_t b){a=find(g,a);b=find(g,b);if(a==b||!g.good())return;const auto A=static_cast<const Graph&>(g).vertex_bounds[a],B=static_cast<const Graph&>(g).vertex_bounds[b];ExactVertexBounds merged=A;if(!A.initialized)merged=B;else if(B.initialized){merged.x={A.x.lower>B.x.lower?A.x.lower:B.x.lower,A.x.upper<B.x.upper?A.x.upper:B.x.upper};merged.y={A.y.lower>B.y.lower?A.y.lower:B.y.lower,A.y.upper<B.y.upper?A.y.upper:B.y.upper};if(merged.x.lower>merged.x.upper||merged.y.lower>merged.y.upper){g.context()->fail(SA_INK_RANGE);return;}}g.parent[b]=a;if(merged.initialized)g.vertex_bounds[a]=merged;}
inline Root rational_root(PolynomialContext&c,const Q&q){auto p=linear(c,-q,Q(1));return Root(p,q,q);}
inline void add_cut(Graph&g,uint32_t curve,Root root,uint32_t id){for(uint32_t i=0;i<g.cuts[curve].size()&&g.good();i++)if(same_root(g.cuts[curve][i].parameter,root)){join(g,g.cuts[curve][i].vertex,id);return;}if(g.cut_count>=g.budget.max_cuts){g.context()->fail(SA_INK_CAPACITY);return;}if(g.cuts[curve].push_back({root,id})){++g.cut_count;auto&source=g.curves[curve];if(source.cuts_generation==UINT64_MAX){g.context()->fail(SA_INK_CAPACITY);return;}++source.cuts_generation;source.cuts_sorted=false;source.bounds_dirty=true;}}
inline uint32_t insert_curve(Graph&g,Curve curve,uint32_t path,Origin origin,int32_t input_weight=1){
    if(!g.good())return no_index;int degree=curve.x.degree()>curve.y.degree()?curve.x.degree():curve.y.degree();if(degree<=0)return no_index;
    curve=restricted(curve,Q(0),Q(1));Point direction=curve.controls.back()-curve.controls[0];if(dot(direction,direction).zero())for(const Point&p:curve.controls)if(!dot(p-curve.controls[0],p-curve.controls[0]).zero()){direction=p-curve.controls[0];break;}
    bool collinear=true;for(const Point&p:curve.controls)if(!cross(p-curve.controls[0],direction).zero())collinear=false;
    if(collinear){if(exact_equal(curve.controls[0].x,curve.controls.back().x)&&exact_equal(curve.controls[0].y,curve.controls.back().y))return no_index;Point line[2]={curve.controls[0],curve.controls.back()};curve=from_controls(*g.math,line,2);origin.flags|=2u;}
    int32_t weight=input_weight;Curve reverse=restricted(curve,Q(1),Q(0));if(compare_curve(reverse,curve)<0){curve=static_cast<Curve&&>(reverse);weight=-input_weight;origin.flags^=4u;}
    if(!g.good())return no_index;uint64_t hash=hash_curve(curve);uint32_t mask=g.curve_table.size()-1,slot=uint32_t(hash)&mask,tombstone=no_index,chosen=no_index;
    for(uint32_t n=0;n<g.curve_table.size()&&g.good();n++,slot=(slot+1)&mask){
        if(!g.step())return no_index;uint32_t value=static_cast<const Graph&>(g).curve_table[slot];if(value==no_index){if(tombstone==no_index)tombstone=slot;continue;}
        if(!value){chosen=tombstone==no_index?slot:tombstone;break;}
        if(exact_equal(static_cast<const Graph&>(g).curves[value-1].geometry,curve)){g.curves[value-1].weight[path]+=weight;g.curves[value-1].origins.push_back(origin);return value-1;}
    }
    if(chosen==no_index)chosen=tombstone;if(chosen==no_index||!g.good()){g.context()->fail(SA_INK_CAPACITY);return no_index;}
    if(g.free_curves.empty()&&g.curves.size()>=g.budget.max_curves){g.context()->fail(SA_INK_CAPACITY);return no_index;}
    if(g.next_curve_identity==UINT64_MAX){g.context()->fail(SA_INK_CAPACITY);return no_index;}SourceCurve result(*g.math);result.identity=g.next_curve_identity++;result.geometry=static_cast<Curve&&>(curve);result.bounds=curve_bounds(result.geometry);result.weight[path]=weight;result.origins.push_back(origin);uint32_t index;
    if(g.free_curves.empty()){index=g.curves.size();g.curves.push_back(result);}else{index=g.free_curves.back();g.free_curves.pop_back();g.curves[index]=result;}
    g.curve_table[chosen]=index+1;SABoundarySourceKey tree_key{};tree_key.words[0]=index+1;g.curve_tree=set_block(*g.context(),g.curve_tree,tree_key,index,result.bounds);return index;
}
inline Point transformed(PolynomialContext&c,double x,double y,const double*matrix){Q X=Q::from_double(c.numbers,x),Y=Q::from_double(c.numbers,y);return{Q::from_double(c.numbers,matrix[0])*X+Q::from_double(c.numbers,matrix[2])*Y+Q::from_double(c.numbers,matrix[4]),Q::from_double(c.numbers,matrix[1])*X+Q::from_double(c.numbers,matrix[3])*Y+Q::from_double(c.numbers,matrix[5])};}
inline bool same_key(SABoundarySourceKey a,SABoundarySourceKey b){for(uint32_t i=0;i<4;i++)if(a.words[i]!=b.words[i])return false;return true;}
inline uint64_t hash_key(SABoundarySourceKey key){uint64_t h=1469598103934665603ull;for(uint32_t word:key.words)h=mix(h,word);return h;}
inline uint32_t source_slot(const Graph&g,SABoundarySourceKey key){if(g.source_table.empty())return no_index;uint32_t mask=g.source_table.size()-1,slot=uint32_t(hash_key(key))&mask;for(uint32_t count=0;count<g.source_table.size();count++,slot=(slot+1)&mask){uint32_t value=g.source_table[slot];if(!value)return no_index;if(value!=no_index&&same_key(g.blocks[value-1].description.key,key))return slot;}return no_index;}
inline void index_source(Graph&g,uint32_t index){uint32_t mask=g.source_table.size()-1,slot=uint32_t(hash_key(static_cast<const Graph&>(g).blocks[index].description.key))&mask,tombstone=no_index;for(uint32_t count=0;count<g.source_table.size()&&g.good();count++,slot=(slot+1)&mask){uint32_t value=static_cast<const Graph&>(g).source_table[slot];if(value==no_index){if(tombstone==no_index)tombstone=slot;continue;}if(!value){g.source_table[tombstone==no_index?slot:tombstone]=index+1;return;}g.step();}if(g.good()&&tombstone!=no_index){g.source_table[tombstone]=index+1;return;}g.context()->fail(SA_INK_CAPACITY);}
inline bool capture(Graph&g,const SABoundaryPath*paths,uint32_t path_count,const SABoundarySourceBlock*sources,uint32_t source_count,const SAInkPathCommand*commands,uint32_t command_count){
    if(!paths||!path_count||path_count>g.budget.max_paths||source_count>g.budget.max_sources||command_count>g.budget.max_commands||(!sources&&source_count)||(!commands&&command_count)){g.context()->fail(SA_INK_INVALID);return false;}
    for(uint32_t i=0;i<path_count;i++){if(paths[i].fill>1||paths[i].role!=(i?SA_BOUNDARY_CLIP:SA_BOUNDARY_PAINT)||paths[i].reserved[0]||paths[i].reserved[1]){g.context()->fail(SA_INK_INVALID);return false;}g.paths.push_back(paths[i]);}
    uint32_t table=8;while(table<uint64_t(g.budget.max_curves)*2u){if(table>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return false;}table*=2;}g.curve_table.resize(table);uint32_t source_capacity=8;while(uint64_t(source_capacity)<uint64_t(g.budget.max_sources)*2){if(source_capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return false;}source_capacity*=2;}g.source_table.resize(source_capacity);uint32_t pair_capacity=8;while(uint64_t(pair_capacity)<uint64_t(g.budget.max_pairs)*2){if(pair_capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return false;}pair_capacity*=2;}g.pair_table.resize(pair_capacity);uint32_t key_capacity=8;while(key_capacity<uint64_t(source_count)*2){if(key_capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return false;}key_capacity*=2;}Vector<uint32_t>source_keys(*g.context());source_keys.resize(key_capacity);uint64_t total=0;
    for(uint32_t source=0;source<source_count&&g.good();source++){const auto&description=sources[source];if(description.reserved||description.path_index>=path_count||description.first_command>command_count||description.command_count>command_count-description.first_command){g.context()->fail(SA_INK_INVALID);return false;}total+=description.command_count;if(total>g.budget.max_commands){g.context()->fail(SA_INK_CAPACITY);return false;}uint64_t kh=1469598103934665603ull;for(uint32_t word:description.key.words)kh=mix(kh,word);uint32_t ks=uint32_t(kh)&(key_capacity-1);while(source_keys[ks]&&g.good()){if(same_key(sources[source_keys[ks]-1].key,description.key)){g.context()->fail(SA_INK_INVALID);return false;}ks=(ks+1)&(key_capacity-1);g.step();}source_keys[ks]=source+1;for(uint32_t i=0;i<6;i++)if(!finite_double(description.affine[i])){g.context()->fail(SA_INK_INVALID);return false;}
        CapturedBlock captured(*g.context());captured.description=description;Point current,start;bool open=false;
        auto emit=[&](const Point*points,uint32_t count,uint32_t command,uint32_t flags){Curve curve=from_controls(*g.math,points,count);Bounds b=curve_bounds(curve);if(!captured.has_bounds){captured.bounds=b;captured.has_bounds=true;}else captured.bounds=unite(captured.bounds,b);uint32_t index=insert_curve(g,static_cast<Curve&&>(curve),description.path_index,{source,command,flags});if(index!=no_index)captured.curves.push_back({index,(g.curves[index].origins.back().flags&4u)?-1:1});};
        auto close=[&](uint32_t command,bool synthetic){if(open&&(!exact_equal(current.x,start.x)||!exact_equal(current.y,start.y))){Point points[2]={current,start};emit(points,2,command,synthetic?1u:0u);}open=false;};
        for(uint32_t i=0;i<description.command_count&&g.good();i++){const auto&command=commands[description.first_command+i];if(command.operation>SA_INK_CLOSE||command.reserved){g.context()->fail(SA_INK_INVALID);return false;}uint32_t used=command.operation==SA_INK_CUBIC?6:command.operation==SA_INK_QUAD?4:command.operation==SA_INK_CLOSE?0:2;for(uint32_t j=0;j<used;j++)if(!finite_double(command.values[j])){g.context()->fail(SA_INK_INVALID);return false;}captured.commands.push_back(command);if(command.operation==SA_INK_MOVE){close(i,true);current=start=transformed(*g.math,command.values[0],command.values[1],description.affine);open=true;}else if(command.operation==SA_INK_CLOSE)close(i,false);else{if(!open){g.context()->fail(SA_INK_INVALID);return false;}Point points[4];points[0]=current;for(uint32_t j=0;j<used;j+=2)points[j/2+1]=transformed(*g.math,command.values[j],command.values[j+1],description.affine);emit(points,used/2+1,i,0);current=points[used/2];}}
        close(description.command_count,true);captured.closed=g.good();captured.active=captured.closed;if(!captured.closed)return false;uint32_t block_index=g.blocks.size();g.blocks.push_back(captured);g.active_commands+=captured.commands.size();++g.active_sources;index_source(g,block_index);if(captured.has_bounds&&g.good())g.block_tree=set_block(*g.context(),g.block_tree,captured.description.key,block_index,captured.bounds);
    }return g.good();}
template<class Visit>inline void query_curves(Graph&g,Bounds query,Visit visit){Vector<Record<BlockNode>,1>pending(*g.context());if(g.curve_tree.valid())pending.push_back(g.curve_tree);while(!pending.empty()&&g.good()){auto record=pending.back();pending.pop_back();const auto&node=*record.get();++g.metrics.bvh_visits;if(!g.step())return;if(!overlap(node.all,query))continue;if(node.left.valid())pending.push_back(node.left);if(node.right.valid())pending.push_back(node.right);if(overlap(node.own,query)&&!static_cast<const Graph&>(g).curves[node.block].weight.zero())visit(node.block);}}
inline uint64_t pair_hash(uint64_t a,uint64_t b){uint64_t h=1469598103934665603ull;return mix(mix(mix(mix(h,uint32_t(a)),uint32_t(a>>32)),uint32_t(b)),uint32_t(b>>32));}
inline uint32_t pair_slot(const Graph&g,uint64_t a,uint64_t b){if(g.pair_table.empty())return no_index;uint32_t mask=g.pair_table.size()-1,slot=uint32_t(pair_hash(a,b))&mask;for(uint32_t i=0;i<g.pair_table.size();i++,slot=(slot+1)&mask){const auto&value=g.pair_table[slot];if(!value.occupied)return no_index;if(value.occupied==1&&value.record.get()->a_identity==a&&value.record.get()->b_identity==b)return slot;}return no_index;}
inline Record<CachedPair> pair_proof(Graph&g,uint32_t a,uint32_t b){
    const auto&A=static_cast<const Graph&>(g).curves[a];const auto&B=static_cast<const Graph&>(g).curves[b];uint32_t cached=pair_slot(g,A.identity,B.identity);
    if(cached!=no_index){++g.metrics.pair_cache_hits;return static_cast<const Graph&>(g).pair_table[cached].record;}
    if(g.metrics.pair_proofs>=g.budget.max_pairs||g.pair_count>=g.budget.max_pairs){g.context()->fail(SA_INK_CAPACITY);return{};}++g.metrics.pair_proofs;
    auto proof=curve_pair(A.geometry,B.geometry);if(!proof.complete||!g.good())return{};auto record=Record<CachedPair>::create(*g.context(),CachedPair(a,b,A.identity,B.identity,proof));
    uint32_t mask=g.pair_table.size()-1,slot=uint32_t(pair_hash(A.identity,B.identity))&mask,tombstone=no_index,chosen=no_index;
    for(uint32_t i=0;i<g.pair_table.size()&&g.good();i++,slot=(slot+1)&mask){if(!g.step())return{};const auto&value=static_cast<const Graph&>(g).pair_table[slot];if(value.occupied==2){if(tombstone==no_index)tombstone=slot;continue;}if(!value.occupied){chosen=tombstone==no_index?slot:tombstone;break;}}
    if(chosen==no_index)chosen=tombstone;if(chosen==no_index){g.context()->fail(SA_INK_CAPACITY);return{};}g.pair_table[chosen]={record,1};g.curves[a].proofs.push_back(record);g.curves[b].proofs.push_back(record);++g.pair_count;return record;
}
inline void retire_pairs(Graph&g,uint32_t index){
    auto records=static_cast<const Graph&>(g).curves[index].proofs;
    for(const auto&record:records){if(!g.good())return;const auto&p=*record.get();uint32_t slot=pair_slot(g,p.a_identity,p.b_identity);if(slot==no_index){g.context()->fail(SA_INK_RANGE);return;}g.pair_table[slot]={{},2};--g.pair_count;uint32_t other=p.a==index?p.b:p.a;Vector<Record<CachedPair>>retained(*g.context());for(const auto&old:static_cast<const Graph&>(g).curves[other].proofs)if(old.get()!=record.get())retained.push_back(old);g.curves[other].proofs=static_cast<Vector<Record<CachedPair>>&&>(retained);}
    g.curves[index].proofs.clear();
}
inline void add_pair(Graph&g,uint32_t a,uint32_t b){
    if(!g.good()||a==b)return;if(a>b){uint32_t swap=a;a=b;b=swap;}++g.metrics.pair_candidates;
    if(!overlap(static_cast<const Graph&>(g).curves[a].bounds,static_cast<const Graph&>(g).curves[b].bounds))return;
    auto record=pair_proof(g,a,b);if(!record.valid()||!g.good())return;const auto&proof=record.get()->proof;
    if(proof.coincident){Q p=proof.beta,q=proof.beta+proof.alpha,lo=p<q?p:q,hi=p>q?p:q;if(lo<Q(0))lo=Q(0);if(hi>Q(1))hi=Q(1);if(lo>hi)return;Q endpoints[2]={lo,hi};for(const Q&t:endpoints){uint32_t id=vertex(g);add_cut(g,a,rational_root(*g.math,t),id);add_cut(g,b,rational_root(*g.math,(t-proof.beta)/proof.alpha),id);}if(lo<hi)g.coincidences.push_back({a,b,proof.alpha,proof.beta,lo,hi});return;}
    for(const auto&hit:proof.hits){uint32_t id=vertex(g);add_cut(g,a,hit.a,id);add_cut(g,b,hit.b,id);++g.metrics.pair_hits;}
}
inline int sign_at(const Polynomial&p,Root&r){if(!r.valid()||!p.valid())return 0;if(p.zero())return 0;for(uint32_t i=0;i<256&&p.valid();i++){auto range=evaluate(p,{r.lower,r.upper});if(range.lower>Q(0))return 1;if(range.upper<Q(0))return-1;if(!i&&root_of(r,p))return 0;refine(r);}if(p.context())p.context()->fail(SA_INK_RANGE);return 0;}
inline int compare(Root r,const Q&q){if(!r.valid())return 0;return sign_at(linear(*r.definition().owner(),-q,Q(1)),r);}
inline int compare(Root a,Root b){if(!a.valid()||!b.valid())return 0;if(same_root(a,b))return 0;for(uint32_t i=0;i<256&&a.valid()&&b.valid();i++){if(a.upper<b.lower)return-1;if(b.upper<a.lower)return 1;refine(a);refine(b);}if(a.context())a.context()->fail(SA_INK_RANGE);return 0;}
inline void self_cuts(Graph&g,uint32_t i){const auto&c=static_cast<const Graph&>(g).curves[i].geometry;Polynomial derivatives[2]={derivative(c.x),derivative(c.y)};for(const auto&p:derivatives)for(const auto&r:roots(p))if(compare(r,Q(0))>0&&compare(r,Q(1))<0)add_cut(g,i,r,vertex(g));if(c.x.degree()<3&&c.y.degree()<3)return;Q denominator=cross({c.x[3],c.y[3]},{c.x[2],c.y[2]});if(denominator.zero())return;Q sum=-cross({c.x[3],c.y[3]},{c.x[1],c.y[1]})/denominator;Q product=sum*sum+(c.x[3].zero()?(c.y[2]*sum+c.y[1])/c.y[3]:(c.x[2]*sum+c.x[1])/c.x[3]);Polynomial p(*g.math);p.coefficients.push_back(product);p.coefficients.push_back(-sum);p.coefficients.push_back(Q::from_signed(*g.context(),1));auto r=roots(p);if(r.size()!=2||compare(r[0],r[1])==0)return;auto rx=divide(c.x,p).remainder,ry=divide(c.y,p).remainder;if(rx.degree()>0||ry.degree()>0){g.context()->fail(SA_INK_RANGE);return;}if(compare(r[0],Q(0))>=0&&compare(r[1],Q(1))<=0){uint32_t id=vertex(g);add_cut(g,i,r[0],id);add_cut(g,i,r[1],id);}}
inline Root affine_root(const Root&r,const Q&alpha,const Q&beta){if(!r.valid())return{};auto&c=*r.definition().owner();Polynomial map=linear(c,-beta/alpha,Q(1)/alpha);Polynomial p=compose(r.definition(),map);Q a=alpha*r.lower+beta,b=alpha*r.upper+beta;return Root(p,a<b?a:b,a>b?a:b);}
inline void propagate(Graph&g,const PagedVector<uint32_t,6>*marked=nullptr){for(uint32_t round=0;round<=g.coincidences.size()+1&&g.good();round++){uint64_t before=g.cut_count;for(const auto&relation:g.coincidences){if(marked&&!(*marked)[relation.a]&&!(*marked)[relation.b])continue;auto A=static_cast<const Graph&>(g).cuts[relation.a],B=static_cast<const Graph&>(g).cuts[relation.b];for(const auto&cut:A)if(compare(cut.parameter,relation.lo)>=0&&compare(cut.parameter,relation.hi)<=0)add_cut(g,relation.b,affine_root(cut.parameter,Q(1)/relation.alpha,-relation.beta/relation.alpha),cut.vertex);for(const auto&cut:B){Root t=affine_root(cut.parameter,relation.alpha,relation.beta);if(compare(t,relation.lo)>=0&&compare(t,relation.hi)<=0)add_cut(g,relation.a,t,cut.vertex);}}if(before==g.cut_count)return;}if(g.good())g.context()->fail(SA_INK_RANGE);}
inline int derivative_sign(const Polynomial&p,Root&r,uint32_t&order){Polynomial d=p;order=0;while(!d.zero()&&d.valid()){int sign=sign_at(d,r);if(sign)return sign;d=derivative(d);++order;}return 0;}
inline bool filled(const Graph&g,const Weight&w){for(uint32_t p=0;p<g.paths.size();p++)if(g.paths[p].fill?(w[p]%2==0):(w[p]==0))return false;return true;}
inline Weight winding(Graph&g,const Point&q,bool boundary_error=false){
    Weight result(*g.context());if(!g.block_tree.valid())return result;Vector<Record<BlockNode>,1>pending(*g.context());pending.push_back(g.block_tree);
    double xlo=lower(q.x),xhi=upper(q.x),ylo=lower(q.y),yhi=upper(q.y);
    while(!pending.empty()&&g.good()){
        auto record=pending.back();pending.pop_back();const auto&node=*record.get();++g.metrics.bvh_visits;if(!g.step())return result;
        // A complete actually captured closed chain has winding zero outside
        // its control box. This does not assume individual open curves have
        // zero winding and does not prune a caller-asserted "closed" flag.
        auto outside=[&](Bounds b){return b.x1<xlo||b.x0>xhi||b.y1<ylo||b.y0>yhi;};
        if(outside(node.all))continue;if(node.left.valid())pending.push_back(node.left);if(node.right.valid())pending.push_back(node.right);
        if(outside(node.own))continue;const auto&block=static_cast<const Graph&>(g).blocks[node.block];if(!block.closed){g.context()->fail(SA_INK_RANGE);return result;}
        uint32_t path=block.description.path_index;
        for(const auto&item:block.curves){const auto&curve=static_cast<const Graph&>(g).curves[item.curve].geometry;auto b=static_cast<const Graph&>(g).curves[item.curve].bounds;if(b.y1<ylo||b.y0>yhi||b.x1<xlo)continue;++g.metrics.winding_curves;
            if(b.x0>xhi){int delta=int(evaluate(curve.y,Q(1))>q.y)-int(evaluate(curve.y,Q(0))>q.y);result[path]+=delta*item.weight;continue;}
            Polynomial py=curve.y-Polynomial(*g.math,q.y),px=curve.x-Polynomial(*g.math,q.x);
            for(Root root:roots(py)){int side=sign_at(px,root);if(!side&&boundary_error){g.context()->fail(SA_INK_RANGE);return result;}if(side<=0)continue;uint32_t order=0;int sign=derivative_sign(py,root,order),delta=0;if(compare(root,Q(0))==0){if(sign>0)delta=1;}else if(compare(root,Q(1))==0){if(sign*((order&1)?-1:1)>0)delta=-1;}else if(order&1)delta=sign;result[path]+=delta*item.weight;}
        }
    }
    return result;
}


/* A separating normal segment is accepted only after exact original-curve
 * intersection tests. Refinement is a bounded proof search, never a sampled
 * substitute for checking the two sides of a Boolean boundary. */
inline bool neighborhood(Graph&g,const Point&center,const Point&T,const Point&N,const Q&distance){
    Point A=center-N*distance,B=center+N*distance;
    Q xmin=A.x<B.x?A.x:B.x,xmax=A.x>B.x?A.x:B.x,ymin=A.y<B.y?A.y:B.y,ymax=A.y>B.y?A.y:B.y;
    Bounds query{lower(xmin),lower(ymin),upper(xmax),upper(ymax)};
    Vector<uint32_t>candidates(*g.context());query_curves(g,query,[&](uint32_t index){candidates.push_back(index);});
    for(uint32_t index:candidates){if(!g.good())return false;
            const auto&source=static_cast<const Graph&>(g).curves[index];if(source.weight.zero()||!overlap(source.bounds,query))continue;
            const auto&curve=source.geometry;
            Polynomial x=curve.x-Polynomial(*g.math,center.x),y=curve.y-Polynomial(*g.math,center.y);
            Polynomial line=scale(x,T.x)+scale(y,T.y);
            Q threshold=distance*dot(N,N);
            if(line.zero()){
                auto range=evaluate(scale(x,N.x)+scale(y,N.y),{Q(0),Q(1)});
                if(range.upper< -threshold||range.lower>threshold)continue;
                return false;
            }
            for(Root root:roots(line)){
                auto normal=scale(x,N.x)+scale(y,N.y);
                int lo=sign_at(normal+Polynomial(*g.math,threshold),root),hi=sign_at(normal-Polynomial(*g.math,threshold),root);
                if(!g.good())return false;if(lo<0||hi>0)continue;
                if(root_of(root,x)&&root_of(root,y)){
                    auto parallel=scale(derivative(curve.y),T.x)-scale(derivative(curve.x),T.y);
                    if(!root_of(root,parallel)){g.context()->fail(SA_INK_RANGE);return false;}
                    auto transverse=scale(derivative(curve.x),T.x)+scale(derivative(curve.y),T.y);
                    if(!sign_at(transverse,root)){g.context()->fail(SA_INK_RANGE);return false;}
                    continue;
                }
                return false;
            }
    }
    return g.good();
}
inline bool separate(const Graph&g,Root&a,Root&b){for(uint32_t i=0;i<256&&g.good();i++){if(a.upper<b.lower)return true;refine(a);refine(b);}if(g.good())g.context()->fail(SA_INK_RANGE);return false;}
inline void classify(Graph&g,uint32_t index,uint32_t cut_index,Root a,Root b,uint32_t va,uint32_t vb){
    const auto&owned=static_cast<const Graph&>(g).curves[index];
    if(owned.membership_valid&&owned.cache_generation==owned.cuts_generation){uint32_t lo=0,hi=owned.classes.size();while(lo<hi){uint32_t mid=lo+(hi-lo)/2;if(owned.classes[mid].cut<cut_index)lo=mid+1;else hi=mid;}if(lo<owned.classes.size()&&owned.classes[lo].cut==cut_index){const auto&cached=owned.classes[lo];++g.metrics.classification_cache_hits;if(cached.direction){if(g.edges.size()>=g.budget.max_edges){g.context()->fail(SA_INK_CAPACITY);return;}g.edges.push_back({index,find(g,va),find(g,vb),a,b,cached.direction,cached.left,cached.right});}return;}}
    if(!g.good()||compare(a,b)>=0||!separate(g,a,b))return;
    Q t=(a.upper+b.lower)/Q(2);const auto&curve=static_cast<const Graph&>(g).curves[index].geometry;
    Point C=at(curve,t),T=tangent(curve,t),N{-T.y,T.x};Q nx=N.x.absolute(),ny=N.y.absolute(),norm=nx>ny?nx:ny;
    if(norm.zero()){g.context()->fail(SA_INK_RANGE);return;}Q span=Q::from_signed(*g.context(),0);
    for(const Point&p:curve.controls){Q x=(p.x-C.x).absolute(),y=(p.y-C.y).absolute();if(x>span)span=x;if(y>span)span=y;}
    Q delta=span/(Q(32)*norm);if(delta.zero()){g.context()->fail(SA_INK_RANGE);return;}
    bool certified=false;for(uint32_t i=0;i<128&&g.good();i++){++g.metrics.classification_refinements;if(neighborhood(g,C,T,N,delta)){certified=true;break;}delta/=Q(2);}
    if(!certified){g.context()->fail(SA_INK_RANGE);return;}
    Weight left=winding(g,C+N*delta,true),right=winding(g,C-N*delta,true);++g.metrics.classifications;
    bool a_filled=filled(g,left),b_filled=filled(g,right);if(!g.good())return;
    g.cuts[index][cut_index].parameter=a;g.cuts[index][cut_index+1].parameter=b;
    auto&cached=g.curves[index];if(!cached.membership_valid||cached.cache_generation!=cached.cuts_generation){cached.classes.clear();cached.cache_generation=cached.cuts_generation;}cached.membership_valid=true;cached.classes.push_back({cut_index,a_filled==b_filled?0:a_filled?1:-1,left,right});if(a_filled==b_filled)return;
    if(g.edges.size()>=g.budget.max_edges){g.context()->fail(SA_INK_CAPACITY);return;}
    g.edges.push_back({index,find(g,va),find(g,vb),a,b,a_filled?1:-1,left,right});
}
struct Arc{uint32_t curve=0,cut=0,va=0,vb=0;};
struct ArcLookup{uint32_t curve=0,va=0,vb=0,arc=0;};
inline uint64_t triple_hash(uint32_t a,uint32_t b,uint32_t c){uint64_t h=1469598103934665603ull;return mix(mix(mix(h,a),b),c);}
inline uint32_t group_root(Vector<uint32_t>&groups,uint32_t i){while(groups.context()->status==SA_INK_OK&&groups[i]!=i){groups[i]=groups[groups[i]];i=groups[i];}return i;}
inline void finish_graph(Graph&g){if(!g.good())return;
    Vector<Arc>arcs(*g.context());Vector<uint32_t>starts(*g.context());starts.resize(g.curves.size()+1);
    for(uint32_t i=0;i<g.curves.size()&&g.good();i++){
        starts[i]=arcs.size();if(!static_cast<const Graph&>(g).curves[i].cuts_sorted){sort(g.cuts[i],[](const Cut&a,const Cut&b){return compare(a.parameter,b.parameter)<0;});g.curves[i].cuts_sorted=true;}const auto&cuts=static_cast<const Graph&>(g).cuts[i];
        for(uint32_t k=0;k+1<cuts.size()&&g.good();k++){
            if(arcs.size()>=g.budget.max_cuts){g.context()->fail(SA_INK_CAPACITY);return;}
            arcs.push_back({i,k,find(g,cuts[k].vertex),find(g,cuts[k+1].vertex)});
        }
    }
    starts[g.curves.size()]=arcs.size();Vector<uint32_t>groups(*g.context());groups.resize(arcs.size());
    uint32_t capacity=8;while(uint64_t(capacity)<uint64_t(arcs.size())*2){if(capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return;}capacity*=2;}
    Vector<ArcLookup>lookup(*g.context());lookup.resize(capacity);
    for(uint32_t i=0;i<arcs.size()&&g.good();i++){
        groups[i]=i;const auto&a=arcs[i];uint32_t slot=uint32_t(triple_hash(a.curve,a.va,a.vb))&(capacity-1);
        while(lookup[slot].arc&&g.good()){const auto&old=lookup[slot];if(old.curve==a.curve&&old.va==a.va&&old.vb==a.vb){g.context()->fail(SA_INK_RANGE);return;}slot=(slot+1)&(capacity-1);g.step();}
        lookup[slot]={a.curve,a.va,a.vb,i+1};
    }
    for(const auto&relation:g.coincidences)for(uint32_t i=starts[relation.a];i<starts[relation.a+1]&&g.good();i++){
        const auto&a=arcs[i];Root ca=static_cast<const Graph&>(g).cuts[a.curve][a.cut].parameter,cb=static_cast<const Graph&>(g).cuts[a.curve][a.cut+1].parameter;
        if(!separate(g,ca,cb))return;Q mid=(ca.upper+cb.lower)/Q(2);if(mid<relation.lo||mid>relation.hi)continue;
        uint32_t va=relation.alpha>Q(0)?a.va:a.vb,vb=relation.alpha>Q(0)?a.vb:a.va;
        uint32_t slot=uint32_t(triple_hash(relation.b,va,vb))&(capacity-1),other=no_index;
        while(lookup[slot].arc&&g.good()){const auto&candidate=lookup[slot];if(candidate.curve==relation.b&&candidate.va==va&&candidate.vb==vb){other=candidate.arc-1;break;}slot=(slot+1)&(capacity-1);g.step();}
        if(other==no_index){g.context()->fail(SA_INK_RANGE);return;}groups[group_root(groups,other)]=group_root(groups,i);
    }
    for(uint32_t i=0;i<arcs.size()&&g.good();i++)if(group_root(groups,i)==i){const auto&a=arcs[i];classify(g,a.curve,a.cut,static_cast<const Graph&>(g).cuts[a.curve][a.cut].parameter,static_cast<const Graph&>(g).cuts[a.curve][a.cut+1].parameter,a.va,a.vb);}
    Vector<int32_t>balance(*g.context());balance.resize(g.parent.size());
    for(const auto&e:g.edges){uint32_t a=find(g,e.va),b=find(g,e.vb);balance[e.direction>0?a:b]++;balance[e.direction>0?b:a]--;}
    for(int32_t value:balance)if(value){g.context()->fail(SA_INK_RANGE);return;}
    g.vertex_bounds.resize(g.parent.size());
    for(uint32_t i=0;i<g.curves.size()&&g.good();i++){if(!static_cast<const Graph&>(g).curves[i].bounds_dirty)continue;for(const auto&cut:static_cast<const Graph&>(g).cuts[i]){
        uint32_t v=find(g,cut.vertex);auto&b=g.vertex_bounds[v];Interval x=evaluate(g.curves[i].geometry.x,{cut.parameter.lower,cut.parameter.upper}),y=evaluate(g.curves[i].geometry.y,{cut.parameter.lower,cut.parameter.upper});
        if(!b.initialized){b={x,y,true};}else{
            b.x={b.x.lower>x.lower?b.x.lower:x.lower,b.x.upper<x.upper?b.x.upper:x.upper};
            b.y={b.y.lower>y.lower?b.y.lower:y.lower,b.y.upper<y.upper?b.y.upper:y.upper};
            if(b.x.lower>b.x.upper||b.y.lower>b.y.upper){g.context()->fail(SA_INK_RANGE);return;}
        }
    }g.curves[i].bounds_dirty=false;}
}
inline void initialize_curves(Graph&g,const Vector<uint32_t>&selected){
    if(!g.good())return;g.cuts.resize(g.curves.size());
    struct Endpoint{Point p;uint32_t v=0;bool used=false;};uint32_t capacity=8;
    while(uint64_t(capacity)<uint64_t(selected.size())*4){if(capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return;}capacity*=2;}
    Vector<Endpoint>points(*g.context());points.resize(capacity);
    for(uint32_t i:selected){if(!g.good())return;uint32_t old=static_cast<const Graph&>(g).cuts[i].size();if(old>g.cut_count){g.context()->fail(SA_INK_RANGE);return;}g.cut_count-=old;g.cuts[i]=Vector<Cut>(*g.context());auto&source=g.curves[i];source.membership_valid=false;source.cuts_sorted=false;source.bounds_dirty=true;source.classes.clear();if(source.cuts_generation==UINT64_MAX){g.context()->fail(SA_INK_CAPACITY);return;}++source.cuts_generation;
        if(source.weight.zero())continue;
        for(uint32_t endpoint=0;endpoint<2&&g.good();endpoint++){
            Point p=at(static_cast<const Graph&>(g).curves[i].geometry,Q(endpoint));uint64_t hash=1469598103934665603ull;hash=hash_integer(hash,p.x.numerator());hash=hash_integer(hash,p.x.denominator());hash=hash_integer(hash,p.y.numerator());hash=hash_integer(hash,p.y.denominator());uint32_t slot=uint32_t(hash)&(capacity-1);
            while(points[slot].used&&g.good()&&(!exact_equal(points[slot].p.x,p.x)||!exact_equal(points[slot].p.y,p.y))){slot=(slot+1)&(capacity-1);g.step();}
            if(!points[slot].used){points[slot].used=true;points[slot].p=p;points[slot].v=vertex(g);}add_cut(g,i,rational_root(*g.math,Q::from_signed(*g.context(),endpoint)),points[slot].v);
        }
        self_cuts(g,i);
    }
}
inline void construct(Graph&g){Vector<uint32_t>active(*g.context());for(uint32_t i=0;i<g.curves.size()&&g.good();i++)if(!static_cast<const Graph&>(g).curves[i].weight.zero())active.push_back(i);initialize_curves(g,active);for(uint32_t id:active){if(!g.good())break;query_curves(g,static_cast<const Graph&>(g).curves[id].bounds,[&](uint32_t other){if(id<other)add_pair(g,id,other);});}propagate(g);if(g.good())finish_graph(g);}
inline Interval primitive_area(const Curve&c,const Root&a,const Root&b,const Q&left){
    Polynomial p=(c.x-Polynomial(*c.owner(),left))*derivative(c.y),integral(*c.owner());integral.coefficients.resize(p.coefficients.size()+1);
    for(int i=0;i<=p.degree()&&p.valid();i++)integral.coefficients[uint32_t(i)+1]=p[i]/Q(i+1);
    integral.trim();return add(evaluate(integral,{b.lower,b.upper}),negate(evaluate(integral,{a.lower,a.upper})));
}
inline Interval area(const Graph&g,const Q&left,const Q&bottom,const Q&right,const Q&top){
    if(!(left<right&&bottom<top)){g.context()->fail(SA_INK_INVALID);return{};}Interval total{Q(0),Q(0)};
    Integer den=Integer::from(*g.context(),1).shifted_left(120);Q precision(Integer::from(*g.context(),1),den);
    for(const auto&edge:g.edges){if(!g.good())return{};const auto&c=static_cast<const Graph&>(g).curves[edge.source].geometry;Vector<Root>cuts(*g.context());cuts.push_back(edge.a);cuts.push_back(edge.b);
        Polynomial boundaries[4]={c.x-Polynomial(*g.math,left),c.x-Polynomial(*g.math,right),c.y-Polynomial(*g.math,bottom),c.y-Polynomial(*g.math,top)};
        for(const auto&p:boundaries)for(const auto&r:roots(p))if(compare(r,edge.a)>0&&compare(r,edge.b)<0)cuts.push_back(r);
        sort(cuts,[](const Root&a,const Root&b){return compare(a,b)<0;});
        Vector<Root>unique(*g.context());for(const auto&r:cuts)if(unique.empty()||compare(unique.back(),r)!=0)unique.push_back(r);
        for(uint32_t i=0;i+1<unique.size()&&g.good();i++){
            Root a=unique[i],b=unique[i+1];if(!separate(g,a,b))return{};Point p=at(c,(a.upper+b.lower)/Q(2));if(p.y<bottom||p.y>top||p.x<left)continue;
            for(uint32_t n=0;n<128&&g.good()&&(a.upper-a.lower>=precision||b.upper-b.lower>=precision);n++){refine(a);refine(b);}
            if(a.upper-a.lower>=precision||b.upper-b.lower>=precision){g.context()->fail(SA_INK_RANGE);return{};}
            Interval value;if(p.x>right)value=multiply({right-left,right-left},add(evaluate(c.y,{b.lower,b.upper}),negate(evaluate(c.y,{a.lower,a.upper}))));else value=primitive_area(c,a,b,left);
            total=add(total,edge.direction>0?value:negate(value));
        }
    }
    return divide(total,{(right-left)*(top-bottom),(right-left)*(top-bottom)});
}
inline int normalized_winding(Graph&g,const Point&q){int result=0;for(const auto&edge:g.edges){if(!g.good())return 0;const auto&c=static_cast<const Graph&>(g).curves[edge.source].geometry;Polynomial py=c.y-Polynomial(*g.math,q.y),px=c.x-Polynomial(*g.math,q.x);
    for(Root root:roots(py)){int ca=compare(root,edge.a),cb=compare(root,edge.b);if(ca<0||cb>0)continue;int x=sign_at(px,root);if(!x)return-999;if(x<0)continue;
        uint32_t order=0;int sign=derivative_sign(py,root,order),delta=0;
        if(!ca){if(sign>0)delta=1;}else if(!cb){if(sign*((order&1)?-1:1)>0)delta=-1;}else if(order&1)delta=sign;result+=edge.direction*delta;
    }}return result;
}

}
#endif
