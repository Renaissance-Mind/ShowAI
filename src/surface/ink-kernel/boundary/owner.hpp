#ifndef SHOWAI_BOUNDARY_OWNER_HPP
#define SHOWAI_BOUNDARY_OWNER_HPP
#include "graph.hpp"
namespace showai_boundary {
inline bool memory_overlap(const void*a,uint64_t an,const void*b,uint64_t bn){uint64_t x=(uintptr_t)a,y=(uintptr_t)b;if((!a&&an)||(!b&&bn)||an>UINTPTR_MAX-x||bn>UINTPTR_MAX-y)return true;return an&&bn&&x<y+bn&&y<x+an;}
inline bool zero_bytes(const void*p,uint32_t count){const auto*b=(const uint8_t*)p;for(uint32_t i=0;i<count;i++)if(b[i])return false;return true;}
// Spatial-index ordering uses binary64 arithmetic; require the public target's
// defined nearest/gradual mode rather than silently accepting altered FP state.
// Exact Integer/Rational operations themselves remain independent of FP mode.
inline bool graph_fp_mode(){volatile double large=9007199254740992.0,one=1.0,half=1.5;volatile double a=large+one,b=-large-one,c=large+half,d=-large-half;if(a!=9007199254740992.0||b!=-9007199254740992.0||c!=9007199254740994.0||d!=-9007199254740994.0)return false;uint64_t bits=1;double input;copy_bytes(&input,&bits,8);volatile double tiny=input;volatile double sum=tiny+tiny;double result=sum;copy_bytes(&bits,&result,8);return bits==2;}
inline bool equal_double(double a,double b){uint64_t x,y;copy_bytes(&x,&a,8);copy_bytes(&y,&b,8);return x==y;}
inline bool same_source(const Graph&g,const SABoundaryPath*paths,uint32_t path_count,const SABoundarySourceBlock*sources,uint32_t source_count,const SAInkPathCommand*commands,uint32_t command_count){
    if(g.paths.size()!=path_count||g.blocks.size()!=source_count)return false;
    for(uint32_t i=0;i<path_count;i++)if(paths[i].fill!=g.paths[i].fill||paths[i].role!=g.paths[i].role||paths[i].reserved[0]||paths[i].reserved[1])return false;
    for(uint32_t i=0;i<source_count;i++){
        const auto&old=g.blocks[i];const auto&next=sources[i];if(next.reserved||next.path_index!=old.description.path_index||!same_key(next.key,old.description.key)||next.command_count!=old.commands.size()||next.first_command>command_count||next.command_count>command_count-next.first_command)return false;
        for(uint32_t j=0;j<6;j++)if(!equal_double(next.affine[j],old.description.affine[j]))return false;
        for(uint32_t j=0;j<next.command_count;j++){
            const auto&a=old.commands[j];const auto&b=commands[next.first_command+j];if(a.operation!=b.operation||a.reserved!=b.reserved)return false;
            for(uint32_t k=0;k<6;k++)if(!equal_double(a.values[k],b.values[k]))return false;
        }
    }
    return true;
}
struct OwnedSnapshot{Graph graph;Vector<SABoundaryEdge>output;OwnedSnapshot(const Graph&g,const Vector<SABoundaryEdge>&o):graph(g),output(o){}};
struct LeaseSlot{Record<OwnedSnapshot>snapshot;SABoundarySnapshot report{};uint32_t generation=0,references=0;};
struct alignas(16) Owner{
    static constexpr uint64_t signature=0x5341424f574e5231ull;
    uint64_t magic=signature;uint32_t name=0,busy=0,current=no_index,next_generation=1,backing_bytes=0;SABoundaryBudget budget{};PolynomialContext math;Vector<LeaseSlot,1>slots;
    Owner(uint32_t n,const SABoundaryBudget&b):name(n),budget(b),slots(math.numbers){}
    bool begin(){if(busy)return false;busy=1;math.numbers.begin_work(budget.max_limb_operations);math.polynomial.operations=0;math.polynomial.max_operations=budget.max_polynomial_operations;math.numbers.peak_bytes=math.numbers.live_bytes;return true;}
    bool valid(SABoundaryLease lease)const{return !lease.reserved&&lease.owner==name&&lease.slot<slots.size()&&slots[lease.slot].references&&slots[lease.slot].generation==lease.generation&&slots[lease.slot].snapshot.valid();}
    SABoundaryLease lease(uint32_t slot)const{return{name,slot,slots[slot].generation,0};}
    void drop(uint32_t slot){auto&s=slots[slot];if(!--s.references){s.snapshot={};s.report={};}}
    bool external_memory(const void*p,uint64_t bytes)const{return !memory_overlap(p,bytes,this,sizeof(Owner))&&!memory_overlap(p,bytes,math.numbers.memory,backing_bytes);}
};
inline Owner*owner(void*state){if(!state||((uintptr_t)state&15u))return nullptr;uint64_t signature;copy_bytes(&signature,state,8);return signature==Owner::signature?(Owner*)state:nullptr;}
struct OwnerCall{Owner&value;explicit OwnerCall(Owner&o):value(o){}~OwnerCall(){value.busy=0;}};
inline bool valid_budget(const SABoundaryBudget&b){uint64_t sum=uint64_t(b.retained_bytes)+b.workspace_bytes;return b.max_commands&&b.max_commands<=1000000&&b.max_curves&&b.max_curves<=1000000&&b.max_pairs&&b.max_cuts&&b.max_edges&&b.max_leases&&b.max_leases<=1024&&b.max_sources&&b.max_sources<=1000000&&b.max_paths&&b.max_paths<=8&&b.max_polynomial_degree==64&&b.max_stored_bits==stored_bits&&b.max_polynomial_operations&&b.max_limb_operations&&b.retained_bytes>=4096&&b.workspace_bytes>=4096&&sum<=0x40000000u;}
inline Vector<SABoundaryEdge> output_edges(Graph&g){
    Vector<SABoundaryEdge>output(*g.context());
    for(uint32_t index=0;index<g.edges.size()&&g.good();index++){
        const auto&e=g.edges[index];const auto&source=g.curves[e.source];if(source.origins.empty()){g.context()->fail(SA_INK_RANGE);break;}
        const auto&origin=source.origins[0];const auto&curve=source.geometry;SABoundaryEdge item{};item.source=g.blocks[origin.source].description.key;item.command_index=origin.command;item.degree=curve.controls.size()-1;item.from_vertex=e.direction>0?e.va:e.vb;item.to_vertex=e.direction>0?e.vb:e.va;item.flags=origin.flags;
        item.origin[0]=lower(curve.controls[0].x);item.origin[1]=lower(curve.controls[0].y);Q ox=Q::from_double(*g.context(),item.origin[0]),oy=Q::from_double(*g.context(),item.origin[1]);
        for(uint32_t j=0;j<curve.controls.size()&&g.good();j++){item.controls[j*2]=lower(curve.controls[j].x-ox);item.controls[j*2+1]=lower(curve.controls[j].y-oy);if(!finite_double(item.controls[j*2])||!finite_double(item.controls[j*2+1]))g.context()->fail(SA_INK_RANGE);}
        item.parameter_bounds[0]=lower(e.a.lower);item.parameter_bounds[1]=upper(e.a.upper);item.parameter_bounds[2]=lower(e.b.lower);item.parameter_bounds[3]=upper(e.b.upper);item.parameter_certificate[0]=index*2;item.parameter_certificate[1]=index*2+1;
        // direction is explicit, including the canonical source reversal. It is
        // not inferred from rounded controls or a caller's source key.
        item.direction=e.direction;output.push_back(item);
    }
    return output;
}
inline void append_q(Vector<uint32_t>&out,const Q&q){out.push_back(uint32_t(q.sign()));out.push_back(q.numerator().size());out.push_back(q.denominator().size());for(uint32_t i=0;i<q.numerator().size();i++)out.push_back(q.numerator().data()[i]);for(uint32_t i=0;i<q.denominator().size();i++)out.push_back(q.denominator().data()[i]);}
}
#endif
