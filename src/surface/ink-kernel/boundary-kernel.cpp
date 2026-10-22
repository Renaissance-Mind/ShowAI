#include "boundary/owner.hpp"
using namespace showai_boundary;
extern "C" {
uint32_t sa_boundary_state_bytes(void){return uint32_t(sizeof(Owner));}
uint32_t sa_boundary_initialize(void*state,uint32_t state_bytes,uint32_t name,void*arena,uint32_t arena_bytes,const SABoundaryBudget*budget){
    if(!state||((uintptr_t)state&15u)||state_bytes<sizeof(Owner)||!name||!arena||((uintptr_t)arena&15u)||!budget||((uintptr_t)budget&7u)||!valid_budget(*budget)||!graph_fp_mode()||!zero_bytes(state,uint32_t(sizeof(Owner)))||memory_overlap(state,sizeof(Owner),arena,arena_bytes)||memory_overlap(state,sizeof(Owner),budget,sizeof(*budget))||memory_overlap(arena,arena_bytes,budget,sizeof(*budget)))return SA_INK_INVALID;
    uint64_t requested=uint64_t(budget->retained_bytes)+budget->workspace_bytes;if(requested>arena_bytes)return SA_INK_CAPACITY;
    auto*o=::new(state)Owner(name,*budget);o->backing_bytes=arena_bytes;if(!o->math.numbers.initialize(arena,uint32_t(requested),budget->max_limb_operations)){uint32_t status=o->math.numbers.status;o->~Owner();for(uint32_t i=0;i<sizeof(Owner);i++)((uint8_t*)state)[i]=0;return status;}
    o->slots.resize(budget->max_leases);if(o->math.numbers.status||o->math.numbers.live_bytes>budget->retained_bytes){uint32_t status=o->math.numbers.status?o->math.numbers.status:SA_INK_CAPACITY;o->~Owner();for(uint32_t i=0;i<sizeof(Owner);i++)((uint8_t*)state)[i]=0;return status;}return SA_INK_OK;
}
uint32_t sa_boundary_prepare(void*state,const SABoundaryLease*base,const SABoundaryPath*paths,uint32_t path_count,const SABoundarySourceBlock*sources,uint32_t source_count,const SAInkPathCommand*commands,uint32_t command_count,SABoundaryLease*output){
    auto*o=owner(state);if(!o||o->busy||!graph_fp_mode()||!paths||!path_count||path_count>o->budget.max_paths||(!sources&&source_count)||source_count>o->budget.max_sources||(!commands&&command_count)||command_count>o->budget.max_commands||!output||((uintptr_t)paths&3u)||((uintptr_t)sources&7u)||((uintptr_t)commands&7u)||((uintptr_t)output&7u)||(base&&((uintptr_t)base&7u)))return SA_INK_INVALID;
    const void*objects[4]={paths,sources,commands,output};uint64_t sizes[4]={uint64_t(path_count)*sizeof(*paths),uint64_t(source_count)*sizeof(*sources),uint64_t(command_count)*sizeof(*commands),sizeof(*output)};
    for(uint32_t i=0;i<4;i++){if(!o->external_memory(objects[i],sizes[i]))return SA_INK_INVALID;for(uint32_t j=i+1;j<4;j++)if(memory_overlap(objects[i],sizes[i],objects[j],sizes[j]))return SA_INK_INVALID;}
    SABoundaryLease captured_base{};if(base){if(!o->external_memory(base,sizeof(*base)))return SA_INK_INVALID;captured_base=*base;if(!o->valid(captured_base)||captured_base.slot!=o->current)return SA_INK_INVALID;}else if(o->current!=no_index)return SA_INK_INVALID;
    if(!o->begin())return SA_INK_INVALID;OwnerCall call(*o);uint64_t baseline=o->math.numbers.live_bytes;
    if(base&&same_source(static_cast<const Owner*>(o)->slots[o->current].snapshot.get()->graph,paths,path_count,sources,source_count,commands,command_count)){
        if(o->slots[o->current].references==0xffffffffu)return SA_INK_CAPACITY;++o->slots[o->current].references;*output=o->lease(o->current);return SA_INK_OK;
    }
    uint32_t slot=no_index;for(uint32_t i=0;i<o->slots.size();i++)if(!o->slots[i].references){slot=i;break;}if(slot==no_index||o->next_generation==0xffffffffu)return SA_INK_CAPACITY;
    Record<OwnedSnapshot>prepared;
    {
        Graph graph(o->math,o->budget);capture(graph,paths,path_count,sources,source_count,commands,command_count);construct(graph);auto edges=output_edges(graph);
        if(o->math.numbers.status)return o->math.numbers.status;OwnedSnapshot snapshot(graph,edges);prepared=Record<OwnedSnapshot>::create(o->math.numbers,snapshot);
    }
    if(o->math.numbers.status)return o->math.numbers.status;if(o->math.numbers.live_bytes>o->budget.retained_bytes)return SA_INK_CAPACITY;
    const auto&graph=prepared.get()->graph;SABoundarySnapshot report{};for(const auto&block:graph.blocks)if(block.active)report.source_commands+=block.commands.size();report.source_curves=graph.curves.size()-graph.free_curves.size();report.exposed_edges=graph.edges.size();report.vertices=graph.parent.size();report.polynomial_operations=o->math.polynomial.operations;report.limb_operations=o->math.numbers.work;report.pair_proofs=graph.metrics.pair_proofs;report.pair_cache_hits=graph.metrics.pair_cache_hits;report.classifications=graph.metrics.classifications;report.bvh_visits=graph.metrics.bvh_visits;report.retained_peak_bytes=o->math.numbers.live_bytes;report.workspace_peak_bytes=o->math.numbers.peak_bytes-baseline;report.arena_peak_bytes=o->math.numbers.peak_bytes;report.baseline_bytes=baseline;report.prepared_bytes=o->math.numbers.live_bytes-baseline;
    auto&target=o->slots[slot];target.snapshot=static_cast<Record<OwnedSnapshot>&&>(prepared);target.generation=o->next_generation++;target.references=2;target.report=report;
    uint32_t previous=o->current;o->current=slot;if(previous!=no_index)o->drop(previous);*output=o->lease(slot);return SA_INK_OK;
}
uint32_t sa_boundary_update(void*state,const SABoundaryLease*base,const SABoundarySourceMutation*mutations,uint32_t mutation_count,const SAInkPathCommand*commands,uint32_t command_count,SABoundaryLease*output){
    auto*o=owner(state);if(!o||o->busy||!graph_fp_mode()||!base||((uintptr_t)base&7u)||(!mutations&&mutation_count)||((uintptr_t)mutations&7u)||uint64_t(mutation_count)>uint64_t(o->budget.max_sources)*2||(!commands&&command_count)||((uintptr_t)commands&7u)||command_count>o->budget.max_commands||!output||((uintptr_t)output&7u))return SA_INK_INVALID;
    const void*objects[3]={mutations,commands,output};uint64_t sizes[3]={uint64_t(mutation_count)*sizeof(*mutations),uint64_t(command_count)*sizeof(*commands),sizeof(*output)};
    for(uint32_t i=0;i<3;i++){if(!o->external_memory(objects[i],sizes[i]))return SA_INK_INVALID;for(uint32_t j=i+1;j<3;j++)if(memory_overlap(objects[i],sizes[i],objects[j],sizes[j]))return SA_INK_INVALID;}
    if(!o->external_memory(base,sizeof(*base)))return SA_INK_INVALID;SABoundaryLease captured=*base;if(!o->valid(captured)||captured.slot!=o->current||!o->begin())return SA_INK_INVALID;OwnerCall call(*o);uint64_t baseline=o->math.numbers.live_bytes;
    const auto&before=static_cast<const Owner*>(o)->slots[o->current].snapshot.get()->graph;
    PagedVector<uint32_t,6>keys(o->math.numbers),changed(o->math.numbers),old_indices(o->math.numbers);uint32_t key_capacity=8;while(uint64_t(key_capacity)<uint64_t(mutation_count)*2){if(key_capacity>0x40000000u)return SA_INK_CAPACITY;key_capacity*=2;}keys.resize(key_capacity);changed.resize(mutation_count);old_indices.resize(mutation_count);
    uint64_t final_commands=before.active_commands,final_sources=before.active_sources;uint32_t changes=0;
    for(uint32_t i=0;i<mutation_count&&o->math.numbers.status==SA_INK_OK;i++){
        const auto&m=mutations[i];if(m.operation>SA_BOUNDARY_REMOVE_SOURCE||m.reserved[0]||m.reserved[1]||m.reserved[2])return SA_INK_INVALID;
        uint32_t slot=uint32_t(hash_key(m.source.key))&(key_capacity-1);while(static_cast<const PagedVector<uint32_t,6>&>(keys)[slot]){uint32_t previous=static_cast<const PagedVector<uint32_t,6>&>(keys)[slot]-1;if(same_key(mutations[previous].source.key,m.source.key))return SA_INK_INVALID;if(!o->math.step())return o->math.numbers.status;slot=(slot+1)&(key_capacity-1);}keys[slot]=i+1;
        uint32_t found=source_slot(before,m.source.key),index=found==no_index?no_index:before.source_table[found]-1;old_indices[i]=index;
        if(m.operation==SA_BOUNDARY_REMOVE_SOURCE){if(index==no_index||!zero_bytes((const uint8_t*)&m.source+sizeof(SABoundarySourceKey),sizeof(SABoundarySourceBlock)-sizeof(SABoundarySourceKey)))return SA_INK_INVALID;changed[i]=1;++changes;final_commands-=before.blocks[index].commands.size();--final_sources;}
        else{
            if(m.source.reserved||m.source.path_index>=before.paths.size()||m.source.first_command>command_count||m.source.command_count>command_count-m.source.first_command)return SA_INK_INVALID;
            bool same=index!=no_index&&block_unchanged(before.blocks[index],m.source,commands,command_count);if(same)continue;changed[i]=1;++changes;final_commands+=m.source.command_count;if(index==no_index)++final_sources;else final_commands-=before.blocks[index].commands.size();
        }
    }
    if(o->math.numbers.status)return o->math.numbers.status;if(final_commands>o->budget.max_commands||final_sources>o->budget.max_sources)return SA_INK_CAPACITY;
    if(!changes){if(o->slots[o->current].references==0xffffffffu)return SA_INK_CAPACITY;++o->slots[o->current].references;*output=o->lease(o->current);return SA_INK_OK;}
    uint32_t slot=available_slot(*o);if(slot==no_index)return SA_INK_CAPACITY;Graph graph=before;SourceDirty dirty(o->math.numbers);
    // Remove all changed old captures before inserting any replacement. Valid
    // final batches do not fail merely because packet order transiently exceeds
    // the source/command pool. The externally visible base remains immutable.
    for(uint32_t i=0;i<mutation_count&&graph.good();i++)if(static_cast<const PagedVector<uint32_t,6>&>(changed)[i]&&static_cast<const PagedVector<uint32_t,6>&>(old_indices)[i]!=no_index)remove_source(graph,static_cast<const PagedVector<uint32_t,6>&>(old_indices)[i],dirty);
    for(uint32_t i=0;i<mutation_count&&graph.good();i++)if(static_cast<const PagedVector<uint32_t,6>&>(changed)[i]&&mutations[i].operation==SA_BOUNDARY_UPSERT_SOURCE)upsert_source(graph,mutations[i].source,commands,command_count,dirty);
    if(!graph.good())return o->math.numbers.status;if(graph.active_commands!=final_commands||graph.active_sources!=final_sources)return SA_INK_RANGE;
    construct_delta(graph,dirty);if(!graph.good())return o->math.numbers.status;return publish_graph(*o,graph,slot,baseline,output);
}
uint32_t sa_boundary_retain(void*state,SABoundaryLease lease){auto*o=owner(state);if(!o||o->busy||!o->valid(lease)||!o->begin())return SA_INK_INVALID;OwnerCall call(*o);auto&s=o->slots[lease.slot];if(s.references==0xffffffffu)return SA_INK_CAPACITY;++s.references;return SA_INK_OK;}
uint32_t sa_boundary_release(void*state,SABoundaryLease lease){auto*o=owner(state);if(!o||o->busy||!o->valid(lease)||!o->begin())return SA_INK_INVALID;OwnerCall call(*o);if(o->slots[lease.slot].references<=(lease.slot==o->current?1u:0u))return SA_INK_INVALID;o->drop(lease.slot);return SA_INK_OK;}
uint32_t sa_boundary_snapshot(void*state,SABoundaryLease lease,SABoundarySnapshot*output){auto*o=owner(state);if(!o||o->busy||!o->valid(lease)||!output||((uintptr_t)output&7u)||!o->external_memory(output,sizeof(*output))||!o->begin())return SA_INK_INVALID;OwnerCall call(*o);*output=static_cast<const Owner*>(o)->slots[lease.slot].report;return SA_INK_OK;}
uint32_t sa_boundary_copy_edges(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryEdge*output,uint32_t capacity){auto*o=owner(state);if(!o||o->busy||!o->valid(lease)||(!output&&count)||((uintptr_t)output&7u)||!o->external_memory(output,uint64_t(capacity)*sizeof(*output))||!o->begin())return SA_INK_INVALID;OwnerCall call(*o);const auto&edges=static_cast<const Owner*>(o)->slots[lease.slot].snapshot.get()->output;if(first>edges.size()||count>edges.size()-first)return SA_INK_INVALID;if(count>capacity)return SA_INK_CAPACITY;for(uint32_t i=0;i<count;i++)output[i]=edges[first+i];return SA_INK_OK;}
uint32_t sa_boundary_copy_parameter(void*state,SABoundaryLease lease,uint32_t certificate,uint32_t*output,uint32_t capacity,uint32_t*required){
    auto*o=owner(state);if(!o||o->busy||!o->valid(lease)||(!output&&capacity)||!required||((uintptr_t)output&3u)||((uintptr_t)required&3u)||!o->external_memory(output,uint64_t(capacity)*4)||!o->external_memory(required,4)||memory_overlap(output,uint64_t(capacity)*4,required,4)||!o->begin())return SA_INK_INVALID;OwnerCall call(*o);
    const auto&graph=static_cast<const Owner*>(o)->slots[lease.slot].snapshot.get()->graph;if(certificate/2>=graph.edges.size())return SA_INK_INVALID;const auto&edge=graph.edges[certificate/2];const auto&root=certificate&1?edge.b:edge.a;Vector<uint32_t>words(o->math.numbers);words.push_back(root.definition().coefficients.size());for(const auto&q:root.definition().coefficients)append_q(words,q);append_q(words,root.lower);append_q(words,root.upper);if(o->math.numbers.status)return o->math.numbers.status;
    if(!output&&!capacity){*required=words.size();return SA_INK_OK;}if(capacity<words.size())return SA_INK_CAPACITY;for(uint32_t i=0;i<words.size();i++)output[i]=static_cast<const Vector<uint32_t>&>(words)[i];*required=words.size();return SA_INK_OK;
}
uint32_t sa_boundary_measure_coverage(void*state,SABoundaryLease lease,const double*rectangles,uint32_t count,double*output,uint32_t capacity){
    auto*o=owner(state);if(!o||o->busy||!o->valid(lease)||(!rectangles&&count)||(!output&&count)||((uintptr_t)rectangles&7u)||((uintptr_t)output&7u)||count>1024||!o->external_memory(rectangles,uint64_t(count)*32)||!o->external_memory(output,uint64_t(capacity)*16)||memory_overlap(rectangles,uint64_t(count)*32,output,uint64_t(capacity)*16))return SA_INK_INVALID;
    if(count>capacity)return SA_INK_CAPACITY;for(uint32_t i=0;i<count;i++){const double*p=rectangles+i*4;for(uint32_t j=0;j<4;j++)if(!finite_double(p[j]))return SA_INK_INVALID;if(!(p[0]<p[2]&&p[1]<p[3]))return SA_INK_INVALID;}
    if(!o->begin())return SA_INK_INVALID;OwnerCall call(*o);const auto&g=static_cast<const Owner*>(o)->slots[lease.slot].snapshot.get()->graph;Vector<double>values(o->math.numbers);
    for(uint32_t i=0;i<count&&g.good();i++){const double*p=rectangles+i*4;auto value=area(g,Q::from_double(o->math.numbers,p[0]),Q::from_double(o->math.numbers,p[1]),Q::from_double(o->math.numbers,p[2]),Q::from_double(o->math.numbers,p[3]));values.push_back(lower(value.lower));values.push_back(upper(value.upper));}
    if(!g.good())return o->math.numbers.status;for(uint32_t i=0;i<count*2;i++)output[i]=static_cast<const Vector<double>&>(values)[i];return SA_INK_OK;
}
uint32_t sa_boundary_destroy(void*state){auto*o=owner(state);if(!o||o->busy)return SA_INK_INVALID;const auto&slots=static_cast<const Owner*>(o)->slots;for(uint32_t i=0;i<slots.size();i++)if(slots[i].references>(i==o->current?1u:0u))return SA_INK_INVALID;o->math.numbers.begin_work(o->budget.max_limb_operations);o->~Owner();for(uint32_t i=0;i<sizeof(Owner);i++)((uint8_t*)state)[i]=0;return SA_INK_OK;}
}
