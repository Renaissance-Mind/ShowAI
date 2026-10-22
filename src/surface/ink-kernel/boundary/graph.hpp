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
struct Weight{int32_t values[8]{};int32_t&operator[](uint32_t i){return values[i];}int32_t operator[](uint32_t i)const{return values[i];}bool zero()const{for(auto x:values)if(x)return false;return true;}};
struct Origin {uint32_t source=0,command=0,flags=0;};
struct SourceCurve {Curve geometry;Weight weight;Vector<Origin>origins;Bounds bounds;SourceCurve()=default;explicit SourceCurve(PolynomialContext&c):geometry(c),origins(c.numbers){}Context*context()const{return geometry.context();}};
struct BlockCurve {uint32_t curve=0;int32_t weight=0;};
struct CapturedBlock {SABoundarySourceBlock description{};Vector<SAInkPathCommand>commands;Vector<BlockCurve>curves;Bounds bounds;bool has_bounds=false,closed=false;CapturedBlock()=default;explicit CapturedBlock(Context&c):commands(c),curves(c){}Context*context()const{return commands.context();}};
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
struct EndpointEvent{Q y;Weight suffix;Context*context()const{return y.context();}};
struct CurveNode {Bounds bounds;uint32_t left=no_index,right=no_index;Vector<uint32_t>ids;Vector<EndpointEvent>right_events;CurveNode()=default;explicit CurveNode(Context&c):ids(c),right_events(c){}Context*context()const{return ids.context();}};
struct ExactVertexBounds{Interval x,y;bool initialized=false;};
struct GraphMetrics{uint64_t bvh_visits=0,pair_candidates=0,pair_proofs=0,pair_hits=0,classifications=0,winding_curves=0,classification_refinements=0;};
struct Graph {
    Pointer<PolynomialContext>math;SABoundaryBudget budget{};Vector<SABoundaryPath>paths;PagedVector<CapturedBlock>blocks;PagedVector<SourceCurve>curves;PagedVector<uint32_t,6>curve_table;
    Record<BlockNode>block_tree;Vector<CurveNode>tree;PagedVector<Vector<Cut>>cuts;PagedVector<uint32_t,6>parent;PagedVector<ExactVertexBounds>vertex_bounds;Vector<Edge>edges;Vector<Coincidence>coincidences;GraphMetrics metrics;uint32_t cut_count=0;
    Graph(PolynomialContext&c,const SABoundaryBudget&b):math(&c),budget(b),paths(c.numbers),blocks(c.numbers),curves(c.numbers),curve_table(c.numbers),tree(c.numbers),cuts(c.numbers),parent(c.numbers),vertex_bounds(c.numbers),edges(c.numbers),coincidences(c.numbers){}
    Context*context()const{return&math->numbers;}bool good()const{return math->numbers.status==SA_INK_OK;}bool step(){return math->step();}
};
template<class T,class Less>inline void sort(Vector<T>&values,Less less){uint32_t n=values.size();if(n<2||!values.context()||values.context()->status)return;auto sift=[&](uint32_t root,uint32_t end){for(;;){if(values.context()->status)return;uint32_t child=root*2+1;if(child>=end)return;if(child+1<end&&less(values[child],values[child+1]))++child;if(!less(values[root],values[child]))return;T swap=values[root];values[root]=values[child];values[child]=swap;root=child;}};for(uint32_t i=n/2;i&&!values.context()->status;i--)sift(i-1,n);for(uint32_t i=n;i>1&&!values.context()->status;i--){T swap=values[0];values[0]=values[i-1];values[i-1]=swap;sift(0,i-1);}}
inline uint32_t vertex(Graph&g){if(g.parent.size()>=g.budget.max_cuts){g.context()->fail(SA_INK_CAPACITY);return 0;}uint32_t id=g.parent.size();g.parent.push_back(id);return id;}
inline uint32_t find(Graph&g,uint32_t v){while(g.good()&&g.parent[v]!=v){g.parent[v]=g.parent[g.parent[v]];v=g.parent[v];}return v;}
inline void join(Graph&g,uint32_t a,uint32_t b){a=find(g,a);b=find(g,b);if(a!=b&&g.good())g.parent[b]=a;}
inline Root rational_root(PolynomialContext&c,const Q&q){auto p=linear(c,-q,Q(1));return Root(p,q,q);}
inline void add_cut(Graph&g,uint32_t curve,Root root,uint32_t id){for(uint32_t i=0;i<g.cuts[curve].size()&&g.good();i++)if(same_root(g.cuts[curve][i].parameter,root)){join(g,g.cuts[curve][i].vertex,id);return;}if(g.cut_count>=g.budget.max_cuts){g.context()->fail(SA_INK_CAPACITY);return;}if(g.cuts[curve].push_back({root,id}))++g.cut_count;}
inline uint32_t insert_curve(Graph&g,Curve curve,uint32_t path,Origin origin){if(!g.good())return no_index;int degree=curve.x.degree()>curve.y.degree()?curve.x.degree():curve.y.degree();if(degree<=0)return no_index;curve=restricted(curve,Q(0),Q(1));Point direction=curve.controls.back()-curve.controls[0];if(dot(direction,direction).zero())for(const Point&p:curve.controls)if(!dot(p-curve.controls[0],p-curve.controls[0]).zero()){direction=p-curve.controls[0];break;}bool collinear=true;for(const Point&p:curve.controls)if(!cross(p-curve.controls[0],direction).zero())collinear=false;
    if(collinear){if(exact_equal(curve.controls[0].x,curve.controls.back().x)&&exact_equal(curve.controls[0].y,curve.controls.back().y))return no_index;Point line[2]={curve.controls[0],curve.controls.back()};curve=from_controls(*g.math,line,2);origin.flags|=2u;}
    int32_t weight=1;Curve reverse=restricted(curve,Q(1),Q(0));if(compare_curve(reverse,curve)<0){curve=static_cast<Curve&&>(reverse);weight=-1;origin.flags|=4u;}uint64_t hash=hash_curve(curve);uint32_t mask=g.curve_table.size()-1,slot=uint32_t(hash)&mask;for(uint32_t n=0;n<g.curve_table.size()&&g.good();n++,slot=(slot+1)&mask){uint32_t value=g.curve_table[slot];if(value){if(exact_equal(g.curves[value-1].geometry,curve)){g.curves[value-1].weight[path]+=weight;g.curves[value-1].origins.push_back(origin);return value-1;}continue;}if(g.curves.size()>=g.budget.max_curves){g.context()->fail(SA_INK_CAPACITY);return no_index;}SourceCurve result(*g.math);result.geometry=static_cast<Curve&&>(curve);result.bounds=curve_bounds(result.geometry);result.weight[path]=weight;result.origins.push_back(origin);uint32_t index=g.curves.size();g.curves.push_back(result);g.curve_table[slot]=index+1;return index;}g.context()->fail(SA_INK_CAPACITY);return no_index;}
inline Point transformed(PolynomialContext&c,double x,double y,const double*matrix){Q X=Q::from_double(c.numbers,x),Y=Q::from_double(c.numbers,y);return{Q::from_double(c.numbers,matrix[0])*X+Q::from_double(c.numbers,matrix[2])*Y+Q::from_double(c.numbers,matrix[4]),Q::from_double(c.numbers,matrix[1])*X+Q::from_double(c.numbers,matrix[3])*Y+Q::from_double(c.numbers,matrix[5])};}
inline bool same_key(SABoundarySourceKey a,SABoundarySourceKey b){for(uint32_t i=0;i<4;i++)if(a.words[i]!=b.words[i])return false;return true;}
inline bool capture(Graph&g,const SABoundaryPath*paths,uint32_t path_count,const SABoundarySourceBlock*sources,uint32_t source_count,const SAInkPathCommand*commands,uint32_t command_count){
    if(!paths||!path_count||path_count>8||path_count>g.budget.max_paths||source_count>g.budget.max_sources||command_count>g.budget.max_commands||(!sources&&source_count)||(!commands&&command_count)){g.context()->fail(SA_INK_INVALID);return false;}
    for(uint32_t i=0;i<path_count;i++){if(paths[i].fill>1||paths[i].role!=(i?SA_BOUNDARY_CLIP:SA_BOUNDARY_PAINT)||paths[i].reserved[0]||paths[i].reserved[1]){g.context()->fail(SA_INK_INVALID);return false;}g.paths.push_back(paths[i]);}
    uint32_t table=8;while(table<uint64_t(g.budget.max_curves)*2u){if(table>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return false;}table*=2;}g.curve_table.resize(table);uint32_t key_capacity=8;while(key_capacity<uint64_t(source_count)*2){if(key_capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return false;}key_capacity*=2;}Vector<uint32_t>source_keys(*g.context());source_keys.resize(key_capacity);uint64_t total=0;
    for(uint32_t source=0;source<source_count&&g.good();source++){const auto&description=sources[source];if(description.reserved||description.path_index>=path_count||description.first_command>command_count||description.command_count>command_count-description.first_command){g.context()->fail(SA_INK_INVALID);return false;}total+=description.command_count;if(total>g.budget.max_commands){g.context()->fail(SA_INK_CAPACITY);return false;}uint64_t kh=1469598103934665603ull;for(uint32_t word:description.key.words)kh=mix(kh,word);uint32_t ks=uint32_t(kh)&(key_capacity-1);while(source_keys[ks]&&g.good()){if(same_key(sources[source_keys[ks]-1].key,description.key)){g.context()->fail(SA_INK_INVALID);return false;}ks=(ks+1)&(key_capacity-1);g.step();}source_keys[ks]=source+1;for(uint32_t i=0;i<6;i++)if(!finite_double(description.affine[i])){g.context()->fail(SA_INK_INVALID);return false;}
        CapturedBlock captured(*g.context());captured.description=description;Point current,start;bool open=false;
        auto emit=[&](const Point*points,uint32_t count,uint32_t command,uint32_t flags){Curve curve=from_controls(*g.math,points,count);Bounds b=curve_bounds(curve);if(!captured.has_bounds){captured.bounds=b;captured.has_bounds=true;}else captured.bounds=unite(captured.bounds,b);uint32_t index=insert_curve(g,static_cast<Curve&&>(curve),description.path_index,{source,command,flags});if(index!=no_index)captured.curves.push_back({index,(g.curves[index].origins.back().flags&4u)?-1:1});};
        auto close=[&](uint32_t command,bool synthetic){if(open&&(!exact_equal(current.x,start.x)||!exact_equal(current.y,start.y))){Point points[2]={current,start};emit(points,2,command,synthetic?1u:0u);}open=false;};
        for(uint32_t i=0;i<description.command_count&&g.good();i++){const auto&command=commands[description.first_command+i];if(command.operation>SA_INK_CLOSE||command.reserved){g.context()->fail(SA_INK_INVALID);return false;}uint32_t used=command.operation==SA_INK_CUBIC?6:command.operation==SA_INK_QUAD?4:command.operation==SA_INK_CLOSE?0:2;for(uint32_t j=0;j<used;j++)if(!finite_double(command.values[j])){g.context()->fail(SA_INK_INVALID);return false;}captured.commands.push_back(command);if(command.operation==SA_INK_MOVE){close(i,true);current=start=transformed(*g.math,command.values[0],command.values[1],description.affine);open=true;}else if(command.operation==SA_INK_CLOSE)close(i,false);else{if(!open){g.context()->fail(SA_INK_INVALID);return false;}Point points[4];points[0]=current;for(uint32_t j=0;j<used;j+=2)points[j/2+1]=transformed(*g.math,command.values[j],command.values[j+1],description.affine);emit(points,used/2+1,i,0);current=points[used/2];}}
        close(description.command_count,true);captured.closed=g.good();if(!captured.closed)return false;uint32_t block_index=g.blocks.size();g.blocks.push_back(captured);if(captured.has_bounds&&g.good())g.block_tree=set_block(*g.context(),g.block_tree,captured.description.key,block_index,captured.bounds);
    }return g.good();}
inline uint32_t build_tree(Graph&g,Vector<uint32_t>ids){if(!g.good())return no_index;uint32_t index=g.tree.size();g.tree.push_back(CurveNode(*g.context()));if(!g.good())return no_index;if(ids.empty())return index;Bounds b=g.curves[ids[0]].bounds;for(uint32_t id:ids)b=unite(b,g.curves[id].bounds);g.tree[index].bounds=b;
    if(ids.size()<=4){g.tree[index].ids=static_cast<Vector<uint32_t>&&>(ids);return index;}bool y=b.y1-b.y0>b.x1-b.x0;sort(ids,[&](uint32_t a,uint32_t d){const Bounds&A=g.curves[a].bounds,&D=g.curves[d].bounds;double x=y?A.y0+A.y1:A.x0+A.x1,z=y?D.y0+D.y1:D.x0+D.x1;return x==z?a<d:x<z;});Vector<uint32_t>left(*g.context()),right(*g.context());for(uint32_t i=0;i<ids.size();i++)(i<ids.size()/2?left:right).push_back(ids[i]);uint32_t a=build_tree(g,static_cast<Vector<uint32_t>&&>(left)),d=build_tree(g,static_cast<Vector<uint32_t>&&>(right));if(!g.good())return no_index;g.tree[index].left=a;g.tree[index].right=d;return index;}
inline void add_pair(Graph&g,uint32_t a,uint32_t b){if(!g.good()||a==b)return;g.metrics.pair_candidates++;if(!overlap(g.curves[a].bounds,g.curves[b].bounds))return;if(g.metrics.pair_proofs>=g.budget.max_pairs){g.context()->fail(SA_INK_CAPACITY);return;}g.metrics.pair_proofs++;auto proof=curve_pair(g.curves[a].geometry,g.curves[b].geometry);if(!proof.complete||!g.good())return;if(proof.coincident){Q p=proof.beta,q=proof.beta+proof.alpha,lo=p<q?p:q,hi=p>q?p:q;if(lo<Q(0))lo=Q(0);if(hi>Q(1))hi=Q(1);if(lo>hi)return;Q endpoints[2]={lo,hi};for(const Q&t:endpoints){uint32_t id=vertex(g);add_cut(g,a,rational_root(*g.math,t),id);add_cut(g,b,rational_root(*g.math,(t-proof.beta)/proof.alpha),id);}if(lo<hi)g.coincidences.push_back({a,b,proof.alpha,proof.beta,lo,hi});return;}for(const auto&hit:proof.hits){uint32_t id=vertex(g);add_cut(g,a,hit.a,id);add_cut(g,b,hit.b,id);g.metrics.pair_hits++;}}
inline void tree_pairs(Graph&g,uint32_t a,uint32_t b){if(!g.step())return;g.metrics.bvh_visits++;const auto A=g.tree[a],B=g.tree[b];if(!overlap(A.bounds,B.bounds))return;if(A.left==no_index&&B.left==no_index){for(uint32_t i:A.ids)for(uint32_t j:B.ids)if((a==b&&i<j)||(a!=b&&i!=j))add_pair(g,i<j?i:j,i<j?j:i);return;}if(a==b){tree_pairs(g,A.left,A.left);tree_pairs(g,A.left,A.right);tree_pairs(g,A.right,A.right);return;}double aa=(A.bounds.x1-A.bounds.x0)*(A.bounds.y1-A.bounds.y0),bb=(B.bounds.x1-B.bounds.x0)*(B.bounds.y1-B.bounds.y0);if(B.left==no_index||(A.left!=no_index&&aa>=bb)){tree_pairs(g,A.left,b);tree_pairs(g,A.right,b);}else{tree_pairs(g,a,B.left);tree_pairs(g,a,B.right);}}
inline int sign_at(const Polynomial&p,Root&r){if(!r.valid()||!p.valid())return 0;if(p.zero())return 0;for(uint32_t i=0;i<256&&p.valid();i++){auto range=evaluate(p,{r.lower,r.upper});if(range.lower>Q(0))return 1;if(range.upper<Q(0))return-1;if(!i&&root_of(r,p))return 0;refine(r);}if(p.context())p.context()->fail(SA_INK_RANGE);return 0;}
inline int compare(Root r,const Q&q){if(!r.valid())return 0;return sign_at(linear(*r.definition().owner(),-q,Q(1)),r);}
inline int compare(Root a,Root b){if(!a.valid()||!b.valid())return 0;if(same_root(a,b))return 0;for(uint32_t i=0;i<256&&a.valid()&&b.valid();i++){if(a.upper<b.lower)return-1;if(b.upper<a.lower)return 1;refine(a);refine(b);}if(a.context())a.context()->fail(SA_INK_RANGE);return 0;}
inline void self_cuts(Graph&g,uint32_t i){const auto&c=g.curves[i].geometry;Polynomial derivatives[2]={derivative(c.x),derivative(c.y)};for(const auto&p:derivatives)for(const auto&r:roots(p))if(compare(r,Q(0))>0&&compare(r,Q(1))<0)add_cut(g,i,r,vertex(g));if(c.x.degree()<3&&c.y.degree()<3)return;Q denominator=cross({c.x[3],c.y[3]},{c.x[2],c.y[2]});if(denominator.zero())return;Q sum=-cross({c.x[3],c.y[3]},{c.x[1],c.y[1]})/denominator;Q product=sum*sum+(c.x[3].zero()?(c.y[2]*sum+c.y[1])/c.y[3]:(c.x[2]*sum+c.x[1])/c.x[3]);Polynomial p(*g.math);p.coefficients.push_back(product);p.coefficients.push_back(-sum);p.coefficients.push_back(Q::from_signed(*g.context(),1));auto r=roots(p);if(r.size()!=2||compare(r[0],r[1])==0)return;auto rx=divide(c.x,p).remainder,ry=divide(c.y,p).remainder;if(rx.degree()>0||ry.degree()>0){g.context()->fail(SA_INK_RANGE);return;}if(compare(r[0],Q(0))>=0&&compare(r[1],Q(1))<=0){uint32_t id=vertex(g);add_cut(g,i,r[0],id);add_cut(g,i,r[1],id);}}
inline Root affine_root(const Root&r,const Q&alpha,const Q&beta){if(!r.valid())return{};auto&c=*r.definition().owner();Polynomial map=linear(c,-beta/alpha,Q(1)/alpha);Polynomial p=compose(r.definition(),map);Q a=alpha*r.lower+beta,b=alpha*r.upper+beta;return Root(p,a<b?a:b,a>b?a:b);}
inline void propagate(Graph&g){for(uint32_t round=0;round<=g.coincidences.size()+1&&g.good();round++){uint64_t before=0;for(const auto&v:g.cuts)before+=v.size();for(const auto&relation:g.coincidences){auto A=g.cuts[relation.a],B=g.cuts[relation.b];for(const auto&cut:A)if(compare(cut.parameter,relation.lo)>=0&&compare(cut.parameter,relation.hi)<=0)add_cut(g,relation.b,affine_root(cut.parameter,Q(1)/relation.alpha,-relation.beta/relation.alpha),cut.vertex);for(const auto&cut:B){Root t=affine_root(cut.parameter,relation.alpha,relation.beta);if(compare(t,relation.lo)>=0&&compare(t,relation.hi)<=0)add_cut(g,relation.a,t,cut.vertex);}}uint64_t after=0;for(const auto&v:g.cuts)after+=v.size();if(before==after)return;}if(g.good())g.context()->fail(SA_INK_RANGE);}
inline int derivative_sign(const Polynomial&p,Root&r,uint32_t&order){Polynomial d=p;order=0;while(!d.zero()&&d.valid()){int sign=sign_at(d,r);if(sign)return sign;d=derivative(d);++order;}return 0;}
inline bool filled(const Graph&g,const Weight&w){for(uint32_t p=0;p<g.paths.size();p++)if(g.paths[p].fill?(w[p]%2==0):(w[p]==0))return false;return true;}
inline Weight winding(Graph&g,const Point&q,bool boundary_error=false){
    Weight result;if(!g.block_tree.valid())return result;Vector<Record<BlockNode>,1>pending(*g.context());pending.push_back(g.block_tree);
    double xlo=lower(q.x),xhi=upper(q.x),ylo=lower(q.y),yhi=upper(q.y);
    while(!pending.empty()&&g.good()){
        auto record=pending.back();pending.pop_back();const auto&node=*record.get();++g.metrics.bvh_visits;if(!g.step())return result;
        // A complete actually captured closed chain has winding zero outside
        // its control box. This does not assume individual open curves have
        // zero winding and does not prune a caller-asserted "closed" flag.
        auto outside=[&](Bounds b){return b.x1<xlo||b.x0>xhi||b.y1<ylo||b.y0>yhi;};
        if(outside(node.all))continue;if(node.left.valid())pending.push_back(node.left);if(node.right.valid())pending.push_back(node.right);
        if(outside(node.own))continue;const auto&block=g.blocks[node.block];if(!block.closed){g.context()->fail(SA_INK_RANGE);return result;}
        uint32_t path=block.description.path_index;
        for(const auto&item:block.curves){const auto&curve=g.curves[item.curve].geometry;auto b=g.curves[item.curve].bounds;if(b.y1<ylo||b.y0>yhi||b.x1<xlo)continue;++g.metrics.winding_curves;
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
    Vector<uint32_t>pending(*g.context());if(!g.tree.empty())pending.push_back(0);
    while(!pending.empty()&&g.good()){
        uint32_t id=pending.back();pending.pop_back();++g.metrics.bvh_visits;if(!g.step())return false;
        const auto&node=g.tree[id];if(!overlap(node.bounds,query))continue;
        if(node.left!=no_index){pending.push_back(node.left);pending.push_back(node.right);continue;}
        for(uint32_t index:node.ids){
            const auto&source=g.curves[index];if(source.weight.zero()||!overlap(source.bounds,query))continue;
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
    }
    return g.good();
}
inline bool separate(Graph&g,Root&a,Root&b){for(uint32_t i=0;i<256&&g.good();i++){if(a.upper<b.lower)return true;refine(a);refine(b);}if(g.good())g.context()->fail(SA_INK_RANGE);return false;}
inline void classify(Graph&g,uint32_t index,Root a,Root b,uint32_t va,uint32_t vb){
    if(!g.good()||compare(a,b)>=0||!separate(g,a,b))return;
    Q t=(a.upper+b.lower)/Q(2);const auto&curve=g.curves[index].geometry;
    Point C=at(curve,t),T=tangent(curve,t),N{-T.y,T.x};Q nx=N.x.absolute(),ny=N.y.absolute(),norm=nx>ny?nx:ny;
    if(norm.zero()){g.context()->fail(SA_INK_RANGE);return;}Q span=Q::from_signed(*g.context(),0);
    for(const Point&p:curve.controls){Q x=(p.x-C.x).absolute(),y=(p.y-C.y).absolute();if(x>span)span=x;if(y>span)span=y;}
    Q delta=span/(Q(32)*norm);if(delta.zero()){g.context()->fail(SA_INK_RANGE);return;}
    bool certified=false;for(uint32_t i=0;i<128&&g.good();i++){++g.metrics.classification_refinements;if(neighborhood(g,C,T,N,delta)){certified=true;break;}delta/=Q(2);}
    if(!certified){g.context()->fail(SA_INK_RANGE);return;}
    Weight left=winding(g,C+N*delta,true),right=winding(g,C-N*delta,true);++g.metrics.classifications;
    bool a_filled=filled(g,left),b_filled=filled(g,right);if(a_filled==b_filled||!g.good())return;
    if(g.edges.size()>=g.budget.max_edges){g.context()->fail(SA_INK_CAPACITY);return;}
    g.edges.push_back({index,find(g,va),find(g,vb),a,b,a_filled?1:-1,left,right});
}
struct Arc{uint32_t curve=0,cut=0,va=0,vb=0;};
struct ArcLookup{uint32_t curve=0,va=0,vb=0,arc=0;};
inline uint64_t triple_hash(uint32_t a,uint32_t b,uint32_t c){uint64_t h=1469598103934665603ull;return mix(mix(mix(h,a),b),c);}
inline uint32_t group_root(Vector<uint32_t>&groups,uint32_t i){while(groups.context()->status==SA_INK_OK&&groups[i]!=i){groups[i]=groups[groups[i]];i=groups[i];}return i;}
inline void construct(Graph&g){
    if(!g.good())return;g.cuts.resize(g.curves.size());for(uint32_t i=0;i<g.cuts.size()&&g.good();i++)g.cuts[i]=Vector<Cut>(*g.context());
    struct Endpoint{Point p;uint32_t v=0;bool used=false;};
    uint32_t capacity=8;while(uint64_t(capacity)<uint64_t(g.curves.size())*4){if(capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return;}capacity*=2;}
    Vector<Endpoint>points(*g.context());points.resize(capacity);Vector<uint32_t>active(*g.context());
    for(uint32_t i=0;i<g.curves.size()&&g.good();i++){
        if(g.curves[i].weight.zero())continue;active.push_back(i);
        for(uint32_t end=0;end<2&&g.good();end++){
            Point p=at(g.curves[i].geometry,Q(end));uint64_t hash=1469598103934665603ull;hash=hash_integer(hash,p.x.numerator());hash=hash_integer(hash,p.x.denominator());hash=hash_integer(hash,p.y.numerator());hash=hash_integer(hash,p.y.denominator());uint32_t slot=uint32_t(hash)&(capacity-1);
            while(points[slot].used&&g.good()&&(!exact_equal(points[slot].p.x,p.x)||!exact_equal(points[slot].p.y,p.y))){slot=(slot+1)&(capacity-1);g.step();}
            if(!points[slot].used){points[slot].used=true;points[slot].p=p;points[slot].v=vertex(g);}
            add_cut(g,i,rational_root(*g.math,Q::from_signed(*g.context(),end)),points[slot].v);
        }
        self_cuts(g,i);
    }
    points.clear();
    if(!active.empty()&&g.good()){build_tree(g,static_cast<Vector<uint32_t>&&>(active));if(g.good())tree_pairs(g,0,0);}
    propagate(g);if(!g.good())return;
    Vector<Arc>arcs(*g.context());Vector<uint32_t>starts(*g.context());starts.resize(g.curves.size()+1);
    for(uint32_t i=0;i<g.curves.size()&&g.good();i++){
        starts[i]=arcs.size();auto&cuts=g.cuts[i];sort(cuts,[](const Cut&a,const Cut&b){return compare(a.parameter,b.parameter)<0;});
        for(uint32_t k=0;k+1<cuts.size()&&g.good();k++){
            if(arcs.size()>=g.budget.max_cuts){g.context()->fail(SA_INK_CAPACITY);return;}
            arcs.push_back({i,k,find(g,cuts[k].vertex),find(g,cuts[k+1].vertex)});
        }
    }
    starts[g.curves.size()]=arcs.size();Vector<uint32_t>groups(*g.context());groups.resize(arcs.size());
    capacity=8;while(uint64_t(capacity)<uint64_t(arcs.size())*2){if(capacity>0x40000000u){g.context()->fail(SA_INK_CAPACITY);return;}capacity*=2;}
    Vector<ArcLookup>lookup(*g.context());lookup.resize(capacity);
    for(uint32_t i=0;i<arcs.size()&&g.good();i++){
        groups[i]=i;const auto&a=arcs[i];uint32_t slot=uint32_t(triple_hash(a.curve,a.va,a.vb))&(capacity-1);
        while(lookup[slot].arc&&g.good()){const auto&old=lookup[slot];if(old.curve==a.curve&&old.va==a.va&&old.vb==a.vb){g.context()->fail(SA_INK_RANGE);return;}slot=(slot+1)&(capacity-1);g.step();}
        lookup[slot]={a.curve,a.va,a.vb,i+1};
    }
    for(const auto&relation:g.coincidences)for(uint32_t i=starts[relation.a];i<starts[relation.a+1]&&g.good();i++){
        const auto&a=arcs[i];Root ca=g.cuts[a.curve][a.cut].parameter,cb=g.cuts[a.curve][a.cut+1].parameter;
        if(!separate(g,ca,cb))return;Q mid=(ca.upper+cb.lower)/Q(2);if(mid<relation.lo||mid>relation.hi)continue;
        uint32_t va=relation.alpha>Q(0)?a.va:a.vb,vb=relation.alpha>Q(0)?a.vb:a.va;
        uint32_t slot=uint32_t(triple_hash(relation.b,va,vb))&(capacity-1),other=no_index;
        while(lookup[slot].arc&&g.good()){const auto&candidate=lookup[slot];if(candidate.curve==relation.b&&candidate.va==va&&candidate.vb==vb){other=candidate.arc-1;break;}slot=(slot+1)&(capacity-1);g.step();}
        if(other==no_index){g.context()->fail(SA_INK_RANGE);return;}groups[group_root(groups,other)]=group_root(groups,i);
    }
    for(uint32_t i=0;i<arcs.size()&&g.good();i++)if(group_root(groups,i)==i){const auto&a=arcs[i];classify(g,a.curve,g.cuts[a.curve][a.cut].parameter,g.cuts[a.curve][a.cut+1].parameter,a.va,a.vb);}
    Vector<int32_t>balance(*g.context());balance.resize(g.parent.size());
    for(const auto&e:g.edges){uint32_t a=find(g,e.va),b=find(g,e.vb);balance[e.direction>0?a:b]++;balance[e.direction>0?b:a]--;}
    for(int32_t value:balance)if(value){g.context()->fail(SA_INK_RANGE);return;}
    g.vertex_bounds.resize(g.parent.size());
    for(uint32_t i=0;i<g.curves.size()&&g.good();i++)for(const auto&cut:g.cuts[i]){
        uint32_t v=find(g,cut.vertex);auto&b=g.vertex_bounds[v];Interval x=evaluate(g.curves[i].geometry.x,{cut.parameter.lower,cut.parameter.upper}),y=evaluate(g.curves[i].geometry.y,{cut.parameter.lower,cut.parameter.upper});
        if(!b.initialized){b={x,y,true};}else{
            b.x={b.x.lower>x.lower?b.x.lower:x.lower,b.x.upper<x.upper?b.x.upper:x.upper};
            b.y={b.y.lower>y.lower?b.y.lower:y.lower,b.y.upper<y.upper?b.y.upper:y.upper};
            if(b.x.lower>b.x.upper||b.y.lower>b.y.upper){g.context()->fail(SA_INK_RANGE);return;}
        }
    }
}
inline Interval primitive_area(const Curve&c,const Root&a,const Root&b,const Q&left){
    Polynomial p=(c.x-Polynomial(*c.owner(),left))*derivative(c.y),integral(*c.owner());integral.coefficients.resize(p.coefficients.size()+1);
    for(int i=0;i<=p.degree()&&p.valid();i++)integral.coefficients[uint32_t(i)+1]=p[i]/Q(i+1);
    integral.trim();return add(evaluate(integral,{b.lower,b.upper}),negate(evaluate(integral,{a.lower,a.upper})));
}
inline Interval area(Graph&g,const Q&left,const Q&bottom,const Q&right,const Q&top){
    if(!(left<right&&bottom<top)){g.context()->fail(SA_INK_INVALID);return{};}Interval total{Q(0),Q(0)};
    Integer den=Integer::from(*g.context(),1).shifted_left(120);Q precision(Integer::from(*g.context(),1),den);
    for(const auto&edge:g.edges){if(!g.good())return{};const auto&c=g.curves[edge.source].geometry;Vector<Root>cuts(*g.context());cuts.push_back(edge.a);cuts.push_back(edge.b);
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
inline int normalized_winding(Graph&g,const Point&q){int result=0;for(const auto&edge:g.edges){if(!g.good())return 0;const auto&c=g.curves[edge.source].geometry;Polynomial py=c.y-Polynomial(*g.math,q.y),px=c.x-Polynomial(*g.math,q.x);
    for(Root root:roots(py)){int ca=compare(root,edge.a),cb=compare(root,edge.b);if(ca<0||cb>0)continue;int x=sign_at(px,root);if(!x)return-999;if(x<0)continue;
        uint32_t order=0;int sign=derivative_sign(py,root,order),delta=0;
        if(!ca){if(sign>0)delta=1;}else if(!cb){if(sign*((order&1)?-1:1)>0)delta=-1;}else if(order&1)delta=sign;result+=edge.direction*delta;
    }}return result;
}

}
#endif
