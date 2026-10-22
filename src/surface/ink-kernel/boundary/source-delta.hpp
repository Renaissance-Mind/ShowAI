#ifndef SHOWAI_BOUNDARY_SOURCE_DELTA_HPP
#define SHOWAI_BOUNDARY_SOURCE_DELTA_HPP
#include "graph.hpp"
namespace showai_boundary {
struct SourceDirty {Bounds bounds;bool initialized=false;Vector<uint32_t>curves;Vector<Bounds>support;explicit SourceDirty(Context&c):curves(c),support(c){}void include(Bounds b){support.push_back(b);bounds=initialized?unite(bounds,b):b;initialized=true;}};
inline bool block_unchanged(const CapturedBlock&old,const SABoundarySourceBlock&next,const SAInkPathCommand*commands,uint32_t count){
    if(!old.active||next.reserved||!same_key(old.description.key,next.key)||old.description.path_index!=next.path_index||next.command_count!=old.commands.size()||next.first_command>count||next.command_count>count-next.first_command)return false;
    for(uint32_t i=0;i<6;i++){uint64_t a,b;copy_bytes(&a,&old.description.affine[i],8);copy_bytes(&b,&next.affine[i],8);if(a!=b)return false;}
    for(uint32_t i=0;i<next.command_count;i++){const auto&a=old.commands[i];const auto&b=commands[next.first_command+i];if(a.operation!=b.operation||a.reserved!=b.reserved)return false;for(uint32_t j=0;j<6;j++){uint64_t x,y;copy_bytes(&x,&a.values[j],8);copy_bytes(&y,&b.values[j],8);if(x!=y)return false;}}
    return true;
}
inline void remove_curve(Graph&g,uint32_t index){
    const auto&source=static_cast<const Graph&>(g).curves[index];if(!source.origins.empty())return;if(!source.weight.zero()){g.context()->fail(SA_INK_RANGE);return;}
    uint32_t mask=g.curve_table.size()-1,slot=uint32_t(hash_curve(source.geometry))&mask;bool found=false;
    for(uint32_t n=0;n<g.curve_table.size()&&g.good();n++,slot=(slot+1)&mask){if(!g.step())return;uint32_t value=static_cast<const Graph&>(g).curve_table[slot];if(!value)break;if(value==index+1){g.curve_table[slot]=no_index;found=true;break;}}
    if(!found){g.context()->fail(SA_INK_RANGE);return;}retire_pairs(g,index);if(!g.good())return;SABoundarySourceKey key{};key.words[0]=index+1;g.curve_tree=remove_block(*g.context(),g.curve_tree,key,source.bounds);g.curves[index]=SourceCurve(*g.math);g.free_curves.push_back(index);
}
inline bool remove_source(Graph&g,uint32_t index,SourceDirty&dirty){
    const CapturedBlock old=static_cast<const Graph&>(g).blocks[index];if(!old.active){g.context()->fail(SA_INK_INVALID);return false;}
    uint32_t slot=source_slot(g,old.description.key);if(slot==no_index){g.context()->fail(SA_INK_RANGE);return false;}g.source_table[slot]=no_index;
    if(old.has_bounds){dirty.include(old.bounds);g.block_tree=remove_block(*g.context(),g.block_tree,old.description.key,old.bounds);}
    PagedVector<uint32_t,6>seen(*g.context());seen.resize(g.curves.size());Vector<uint32_t>unique(*g.context());
    for(const auto&item:old.curves){g.curves[item.curve].weight[old.description.path_index]-=item.weight;if(!static_cast<const PagedVector<uint32_t,6>&>(seen)[item.curve]){seen[item.curve]=1;unique.push_back(item.curve);dirty.curves.push_back(item.curve);}}
    for(uint32_t id:unique){Vector<Origin>origins(*g.context());for(const auto&origin:static_cast<const Graph&>(g).curves[id].origins)if(origin.source!=index)origins.push_back(origin);g.curves[id].origins=static_cast<Vector<Origin>&&>(origins);if(static_cast<const Graph&>(g).curves[id].origins.empty())remove_curve(g,id);}
    g.active_commands-=old.commands.size();--g.active_sources;g.blocks[index]=CapturedBlock(*g.context());g.free_blocks.push_back(index);return g.good();
}
inline bool upsert_source(Graph&g,const SABoundarySourceBlock&description,const SAInkPathCommand*commands,uint32_t count,SourceDirty&dirty){
    if(description.path_index>=g.paths.size()||description.reserved||description.first_command>count||description.command_count>count-description.first_command){g.context()->fail(SA_INK_INVALID);return false;}
    uint32_t slot=source_slot(g,description.key),old_index=slot==no_index?no_index:static_cast<const Graph&>(g).source_table[slot]-1;
    if(old_index!=no_index&&block_unchanged(static_cast<const Graph&>(g).blocks[old_index],description,commands,count))return true;
    uint64_t resulting=uint64_t(g.active_commands)+description.command_count-(old_index==no_index?0:static_cast<const Graph&>(g).blocks[old_index].commands.size());
    if(resulting>g.budget.max_commands||(old_index==no_index&&g.active_sources>=g.budget.max_sources)){g.context()->fail(SA_INK_CAPACITY);return false;}
    // A real independent captured parse mints closure and exact transformed
    // curves. No key, caller flag or previously writable input is an authority.
    Graph fragment(*g.math,g.budget);if(!capture(fragment,g.paths.begin(),g.paths.size(),&description,1,commands,count))return false;
    if(old_index!=no_index&&!remove_source(g,old_index,dirty))return false;
    uint32_t index;if(g.free_blocks.empty()){index=g.blocks.size();g.blocks.push_back(CapturedBlock(*g.context()));}else{index=g.free_blocks.back();g.free_blocks.pop_back();}
    CapturedBlock next=static_cast<const Graph&>(fragment).blocks[0];next.curves.clear();PagedVector<uint32_t,6>origin_position(*g.context());origin_position.resize(fragment.curves.size());
    for(const auto&item:static_cast<const Graph&>(fragment).blocks[0].curves){
        const auto&source=static_cast<const Graph&>(fragment).curves[item.curve];uint32_t origin_index=origin_position[item.curve]++;if(origin_index>=source.origins.size()){g.context()->fail(SA_INK_RANGE);return false;}auto origin=source.origins[origin_index];origin.source=index;
        uint32_t id=insert_curve(g,source.geometry,description.path_index,origin,item.weight);if(id==no_index){if(g.good())g.context()->fail(SA_INK_RANGE);return false;}next.curves.push_back({id,item.weight});dirty.curves.push_back(id);
    }
    if(!g.good())return false;g.blocks[index]=next;index_source(g,index);g.active_commands+=next.commands.size();++g.active_sources;
    if(next.has_bounds){dirty.include(next.bounds);g.block_tree=set_block(*g.context(),g.block_tree,next.description.key,index,next.bounds);}return g.good();
}
inline void construct_delta(Graph&g,const SourceDirty&dirty){
    if(!g.good())return;g.output_reset=false;g.coincidences.clear();g.point_aliases.clear();g.vertex_changes.clear();g.metrics={};PagedVector<uint32_t,6>marked(*g.context());marked.resize(g.curves.size());Vector<uint32_t>selected(*g.context());
    auto mark=[&](uint32_t id){if(id<g.curves.size()&&!static_cast<const PagedVector<uint32_t,6>&>(marked)[id]){marked[id]=1;selected.push_back(id);}};
    for(uint32_t id:dirty.curves)mark(id);for(Bounds box:dirty.support)query_curves(g,box,mark);
    // Coincident intervals share cuts. Include the exact retained component;
    // this may conservatively visit more arcs, but never skips a required cut.
    for(uint32_t cursor=0;cursor<selected.size()&&g.good();cursor++)for(const auto&record:static_cast<const Graph&>(g).curves[selected[cursor]].proofs)if(record.get()->proof.coincident){mark(record.get()->a);mark(record.get()->b);}
    initialize_curves(g,selected);
    for(uint32_t id:selected){if(!g.good())return;if(static_cast<const Graph&>(g).curves[id].weight.zero())continue;query_curves(g,static_cast<const Graph&>(g).curves[id].bounds,[&](uint32_t other){if(id!=other&&(!static_cast<const PagedVector<uint32_t,6>&>(marked)[other]||id<other))add_pair(g,id,other);});}
    g.coincidences.clear();
    for(uint32_t i:selected){if(!g.good())return;const auto&source=static_cast<const Graph&>(g).curves[i];if(source.weight.zero())continue;for(const auto&record:source.proofs){const auto&p=*record.get();if(!p.proof.coincident||static_cast<const Graph&>(g).curves[p.a].weight.zero()||static_cast<const Graph&>(g).curves[p.b].weight.zero())continue;if(!static_cast<const PagedVector<uint32_t,6>&>(marked)[p.a]||!static_cast<const PagedVector<uint32_t,6>&>(marked)[p.b]){g.context()->fail(SA_INK_RANGE);return;}if(p.a!=i)continue;Q a=p.proof.beta,b=p.proof.beta+p.proof.alpha,lo=a<b?a:b,hi=a>b?a:b;if(lo<Q(0))lo=Q(0);if(hi>Q(1))hi=Q(1);if(lo<hi)g.coincidences.push_back({p.a,p.b,p.proof.alpha,p.proof.beta,lo,hi});}}
    propagate(g,&marked);if(g.good())finish_graph(g,&selected);g.coincidences.clear();
}
inline void reset_topology(Graph&g){g.cuts.clear();g.parent.clear();g.parent_size.clear();g.vertex_bounds.clear();g.point_authorities.clear();g.vertex_certificates.clear();g.vertex_incidence.clear();g.point_aliases.clear();g.vertex_changes.clear();g.incident_endpoint_count=0;g.edges.clear();g.coincidences.clear();g.cut_count=0;g.metrics={};}
}
#endif
