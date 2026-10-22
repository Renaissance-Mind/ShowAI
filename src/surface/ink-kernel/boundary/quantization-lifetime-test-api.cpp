// Test-only actual source-owner API transport; no production/public ABI addition.
#include "../boundary-kernel.cpp"
#include "quantization-source-pin.hpp"
extern "C" uint32_t saqt_source_pins(void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
    if(!memory||((uintptr_t)memory&15u)||bytes<16*1024*1024||!output||capacity<8||memory_overlap(memory,bytes,output,uint64_t(capacity)*4))return SA_INK_INVALID;
    auto*raw=(uint8_t*)memory;void*stateA=raw;void*stateB=raw+8*1024*1024;
    if(sizeof(Owner)>4096)return SA_INK_CAPACITY;for(uint32_t i=0;i<4096;i++){raw[i]=0;raw[8*1024*1024+i]=0;}
    SABoundaryBudget budget{};budget.max_commands=32;budget.max_curves=32;budget.max_pairs=128;budget.max_cuts=128;budget.max_edges=128;budget.max_sources=8;budget.max_paths=1;budget.max_leases=8;
    budget.max_polynomial_degree=64;budget.max_stored_bits=stored_bits;budget.max_polynomial_operations=1000000;budget.max_limb_operations=100000000;
    budget.retained_bytes=2*1024*1024;budget.workspace_bytes=2*1024*1024;
    if(sa_boundary_initialize(stateA,4096,101,raw+4096,4*1024*1024,&budget)||sa_boundary_initialize(stateB,4096,202,raw+8*1024*1024+4096,4*1024*1024,&budget))return SA_INK_INVALID;
    SABoundaryPath path{};SABoundarySourceBlock block{};block.key.words[0]=1;block.command_count=5;block.affine[0]=block.affine[3]=1;
    SAInkPathCommand commands[5]={{0,0,{0,0}},{1,0,{1,0}},{1,0,{1,1}},{1,0,{0,1}},{4,0,{}}};SABoundaryLease A{},B{};
    if(sa_boundary_prepare(stateA,nullptr,&path,1,&block,1,commands,5,&A)||sa_boundary_prepare(stateB,nullptr,&path,1,&block,1,commands,5,&B))return SA_INK_INVALID;
    uint32_t checks=0;
    {
        BoundaryQuantizationSourcePin a,b;
        if(BoundaryQuantizationSourcePin::capture(stateA,A,a)||!a.valid()||!a.get()||a.get()->graph.edges.size()!=4)return SA_INK_INVALID;++checks;
        if(BoundaryQuantizationSourcePin::capture(stateB,B,b)||!b.valid())return SA_INK_INVALID;
        const auto*retained=b.get();
        if(BoundaryQuantizationSourcePin::capture(stateB,A,b)!=SA_INK_INVALID||b.get()!=retained)return SA_INK_INVALID;++checks;
        auto bad=A;++bad.epoch;if(BoundaryQuantizationSourcePin::capture(stateA,bad,b)!=SA_INK_INVALID||b.get()!=retained)return SA_INK_INVALID;++checks;
        auto*actual=owner(stateA);auto&slot=actual->slots[A.slot];const uint32_t references=slot.references;slot.references=0xffffffffu;
        if(BoundaryQuantizationSourcePin::capture(stateA,A,b)!=SA_INK_CAPACITY||b.get()!=retained)return SA_INK_INVALID;slot.references=references;++checks;
        BoundaryQuantizationSourcePin shared=a;
        if(!shared.valid()||shared.get()!=a.get())return SA_INK_INVALID;
        if(sa_boundary_release(stateA,A)||sa_boundary_destroy(stateA)!=SA_INK_INVALID)return SA_INK_INVALID;++checks;
        a.reset();if(sa_boundary_destroy(stateA)!=SA_INK_INVALID||!shared.get()||shared.get()->graph.edges.size()!=4)return SA_INK_INVALID;++checks;
        shared.reset();if(sa_boundary_destroy(stateA))return SA_INK_INVALID;++checks;
        b.reset();if(sa_boundary_release(stateB,B)||sa_boundary_destroy(stateB))return SA_INK_INVALID;++checks;
    }
    for(uint32_t i=0;i<sizeof(Owner);i++)if(raw[i]||raw[8*1024*1024+i])return SA_INK_INVALID;
    for(uint32_t i=0;i<8;i++)output[i]=0;output[0]=checks;return SA_INK_OK;
}
