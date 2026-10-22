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
    auto*o=owner(state);if(!o||o->busy||!graph_fp_mode()||!paths||!path_count||path_count>o->budget.max_paths||(!sources&&source_count)||source_count>o->budget.max_sources||(!commands&&command_count)||command_count>o->budget.max_commands||!output||((uintptr_t)paths&3u)||((uintptr_t)sources&7u)||((uintptr_t)commands&7u)||((uintptr_t)output&3u)||(base&&((uintptr_t)base&3u)))return SA_INK_INVALID;
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
    const auto&graph=prepared.get()->graph;SABoundarySnapshot report{};for(const auto&block:graph.blocks)report.source_commands+=block.commands.size();report.source_curves=graph.curves.size();report.exposed_edges=graph.edges.size();report.vertices=graph.parent.size();report.polynomial_operations=o->math.polynomial.operations;report.limb_operations=o->math.numbers.work;report.pair_proofs=graph.metrics.pair_proofs;report.classifications=graph.metrics.classifications;report.bvh_visits=graph.metrics.bvh_visits;report.retained_peak_bytes=o->math.numbers.live_bytes;report.workspace_peak_bytes=o->math.numbers.peak_bytes-baseline;report.arena_peak_bytes=o->math.numbers.peak_bytes;report.baseline_bytes=baseline;report.prepared_bytes=o->math.numbers.live_bytes-baseline;
    auto&target=o->slots[slot];target.snapshot=static_cast<Record<OwnedSnapshot>&&>(prepared);target.generation=o->next_generation++;target.references=2;target.report=report;
    uint32_t previous=o->current;o->current=slot;if(previous!=no_index)o->drop(previous);*output=o->lease(slot);return SA_INK_OK;
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
uint32_t sa_boundary_destroy(void*state){auto*o=owner(state);if(!o||o->busy)return SA_INK_INVALID;const auto&slots=static_cast<const Owner*>(o)->slots;for(uint32_t i=0;i<slots.size();i++)if(slots[i].references>(i==o->current?1u:0u))return SA_INK_INVALID;o->math.numbers.begin_work(o->budget.max_limb_operations);o->~Owner();for(uint32_t i=0;i<sizeof(Owner);i++)((uint8_t*)state)[i]=0;return SA_INK_OK;}
}
