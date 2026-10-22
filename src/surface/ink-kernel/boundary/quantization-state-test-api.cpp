// Test-only actual source + derived owner transport, never a public wire API.
#include "quantization-state.hpp"
static uint32_t saqt_state_failure_line=0;
inline uint32_t saqt_state_fail(uint32_t line){saqt_state_failure_line=line;return SA_INK_INVALID;}
extern "C" uint32_t saqt_state_error_line(){return saqt_state_failure_line;}
inline uint32_t saqt_serialize(const BoundaryQuantizationSnapshot&snapshot,uint64_t*serialized,uint32_t capacity){
 const auto*after=&snapshot;uint32_t serialized_count=0;if(uint64_t(snapshot.blocks.size())*50>capacity)return UINT32_MAX;
   after->blocks.each_chunk([&](uint32_t slot,const ChunkTree<BoundaryQuantizedArc>::Chunk&chunk){
    const auto*original=after->source.get()->graph.edges.chunk(slot);auto key=block_key(after->source.get()->graph,slot,original);
    auto word=[&](uint64_t value){serialized[serialized_count++]=value;};auto number=[&](double value){uint64_t bits;copy_bytes(&bits,&value,8);word(bits);};
    for(const auto&arc:chunk.values){word(slot);word(chunk.identity);word(chunk.revision);word(key.epoch);word(key.curve);word(key.revision);word(key.slot);word(key.reserved);
     const auto&e=arc.edge;for(uint32_t value:e.source.words)word(value);word(e.command_index);word(e.source_flags);word(e.edge);word(e.curve);word(e.degree);word(e.vertex_a);word(e.vertex_b);word(e.certificate_a);word(e.certificate_b);word(e.reserved);word(e.curve_identity);word(uint32_t(e.direction));word(e.reserved2);for(double value:e.controls)number(value);number(e.error_l1);number(e.parameter_error_l1);number(e.control_error_l1);
     const BoundaryQuantizedVertex*endpoints[2]={arc.a.get(),arc.b.get()};for(const auto*anchor:endpoints){word(anchor->vertex);word(anchor->representative_edge);word(anchor->endpoint);word(anchor->reserved);number(anchor->position[0]);number(anchor->position[1]);number(anchor->error_l1);}
    }
   }); return serialized_count;
}
extern "C" uint32_t saqt_state(uint32_t count,void*memory,uint32_t bytes,uint64_t*output,uint32_t capacity,uint32_t mode=0){
 saqt_state_failure_line=0;
 if(mode>1||count<2||count>4096||!memory||((uintptr_t)memory&15u)||bytes<80*1024*1024||!output||((uintptr_t)output&7u)||capacity<24+count*4*50||memory_overlap(memory,bytes,output,uint64_t(capacity)*8))return saqt_state_fail(__LINE__);
 auto*raw=(uint8_t*)memory;if(sizeof(Owner)>4096)return SA_INK_CAPACITY;for(uint32_t i=0;i<4096;i++)raw[i]=0;
 SABoundaryBudget budget{};budget.max_commands=count*5+10;budget.max_curves=count*4+16;budget.max_pairs=count*8+100;budget.max_cuts=count*16+1024;budget.max_edges=count*8+32;budget.max_sources=count+4;budget.max_paths=1;budget.max_leases=8;budget.max_polynomial_degree=64;budget.max_stored_bits=stored_bits;budget.max_polynomial_operations=50000000;budget.max_limb_operations=10000000000ull;
 budget.retained_bytes=count>128?232*1024*1024:48*1024*1024;budget.workspace_bytes=count>128?24*1024*1024:16*1024*1024;
 uint64_t needed=uint64_t(budget.retained_bytes)+budget.workspace_bytes;if(needed>bytes-4096)return SA_INK_CAPACITY;
 if(sa_boundary_initialize(raw,4096,877,raw+4096,uint32_t(needed),&budget))return saqt_state_fail(__LINE__);
 auto*source=owner(raw);auto&c=source->math.numbers;uint64_t report[24]{};uint32_t status=0,serialized_count=0;uint64_t*serialized=nullptr;
 {
  Vector<SABoundarySourceBlock,1>blocks(c);Vector<SAInkPathCommand,1>commands(c);
  // API input must be external to its owned arena. Allocate this small captured
  // transport in the reserved tail of the caller's test buffer instead.
  auto*source_blocks=(SABoundarySourceBlock*)(raw+4096+needed);auto*source_commands=(SAInkPathCommand*)(source_blocks+count);serialized=(uint64_t*)(source_commands+count*5);
  const uint64_t transport=uint64_t(count)*(sizeof(SABoundarySourceBlock)+5*sizeof(SAInkPathCommand));if(transport+uint64_t(count)*4*50*8>bytes-4096-needed)return SA_INK_CAPACITY;
  auto rectangle=[](SAInkPathCommand*out,double x){SAInkPathCommand value[5]={{0,0,{x,0}},{1,0,{x+1,0}},{1,0,{x+1,1}},{1,0,{x,1}},{4,0,{}}};for(uint32_t i=0;i<5;i++)out[i]=value[i];};
  for(uint32_t i=0;i<count;i++){source_blocks[i]={};source_blocks[i].key.words[0]=i+1;source_blocks[i].first_command=i*5;source_blocks[i].command_count=5;source_blocks[i].affine[0]=source_blocks[i].affine[3]=1;rectangle(source_commands+i*5,i*3);}
  SABoundaryPath path{};SABoundaryLease A{},B{},C{},D{};
  if(sa_boundary_prepare(raw,nullptr,&path,1,source_blocks,count,source_commands,count*5,&A))return c.status?c.status:SA_INK_INVALID;
  BoundaryQuantizationSourcePin a,b,d,reset;if(BoundaryQuantizationSourcePin::capture(raw,A,a))return saqt_state_fail(__LINE__);
  {
   BoundaryQuantizationState state(a,901,12);BoundaryQuantizationOptions options{};options.maximum_error_l1=1e-8;options.maximum_refinements=10000;options.maximum_edges=count*8;options.maximum_vertices=count*8;
   BoundaryQuantizationLease qa{},qb{},duplicate{},qd{},qe{},sentinel{123,456,7,8,9};
   {auto malformed=BoundaryQuantizationLease{0,1,2,3,4};auto out=sentinel;if(state.prepare_cold(a,malformed,options,out)!=SA_INK_INVALID||out.owner!=sentinel.owner||out.epoch!=sentinel.epoch||out.slot!=sentinel.slot||out.generation!=sentinel.generation||out.reserved!=sentinel.reserved)return saqt_state_fail(__LINE__);++report[0];}
   if(state.prepare_cold(a,{},options,qa)||state.commit(qa))return saqt_state_fail(__LINE__);auto*before=state.read(qa);if(!before||before->blocks.size()!=count*4)return saqt_state_fail(__LINE__);++report[0];
   {auto bad=qa;++bad.epoch;BoundaryQuantizationState other(a,902,2);if(state.read(bad)||state.commit(bad)!=SA_INK_INVALID||other.read(qa)||other.commit(qa)!=SA_INK_INVALID)return saqt_state_fail(__LINE__);++report[0];}
   SABoundarySourceMutation mutation{};mutation.source=source_blocks[count-1];mutation.source.first_command=0;SAInkPathCommand moved[5];rectangle(moved,mode?1:count*3+4);
   if(sa_boundary_update(raw,&A,&mutation,1,moved,5,&B)||BoundaryQuantizationSourcePin::capture(raw,B,b))return saqt_state_fail(__LINE__);
   rectangle(moved,count*3+8);if(sa_boundary_update(raw,&B,&mutation,1,moved,5,&C)||BoundaryQuantizationSourcePin::capture(raw,C,d))return saqt_state_fail(__LINE__);
   // The actual source owner is already C while quantization consumes A->B.
   if(b.latest()||!a.base_of(b)||!b.base_of(d)||state.prepare_update(b,qa,options,qb)||state.prepare_update(b,qa,options,duplicate))return saqt_state_fail(__LINE__);++report[0];
   auto limited=options;limited.maximum_edges=1;auto unchanged=sentinel;
   if(state.prepare_update(b,qa,limited,sentinel)!=SA_INK_CAPACITY||sentinel.owner!=unchanged.owner||sentinel.generation!=unchanged.generation||state.current().generation!=qa.generation)return saqt_state_fail(__LINE__);++report[0];
   // Real exact-arithmetic failure followed by cancellation must preserve pins.
   {BoundaryQuantizationSnapshot rejected(c);rejected.revision=12345;c.begin_work(1);auto result=boundary_quantization_state::build(b,before,false,options,999,rejected);if(result!=SA_INK_CAPACITY||rejected.revision!=12345)return saqt_state_fail(__LINE__);}
   if(state.cancel(duplicate)||state.read(duplicate)||state.release(duplicate)||c.status!=SA_INK_CAPACITY)return saqt_state_fail(__LINE__);++report[0];
   if(state.commit(qb))return saqt_state_fail(__LINE__);const auto*after=state.read(qb);if(!after||(!mode&&(after->changes.size()!=4||after->work.blocks!=4||after->work.arcs!=4))||(mode&&(!after->work.aliases||after->blocks.size()!=6)))return saqt_state_fail(__LINE__);++report[0];
   uint64_t retained=0,anchors=0;for(uint32_t i=0;i<count*4-4;i++){if(after->blocks.same_chunk(i,before->blocks))++retained;const auto*old=before->blocks.chunk(i);const auto*next=after->blocks.chunk(i);if(old&&next&&old->values[0].a.get()==next->values[0].a.get()&&old->values[0].b.get()==next->values[0].b.get())++anchors;}
   if((!mode&&retained!=count*4-4)||(!mode&&anchors!=retained)||(mode&&anchors<retained)||after->work.anchor_nodes>1024||after->work.anchor_visits>4096)return saqt_state_fail(__LINE__);++report[0];
   report[1]=count;report[2]=retained;report[3]=anchors;report[4]=after->work.blocks;report[5]=after->work.arcs;report[6]=after->work.anchor_nodes;report[7]=after->work.anchor_visits;report[8]=after->work.math.root_refinements;report[9]=after->work.math.polynomial_operations;report[10]=after->work.math.limb_operations;report[11]=after->work.aliases;report[12]=after->blocks.size();report[13]=after->anchors.size();
   // Explicit full TEST export for direct Native/WASM value parity. This
   // scan is outside the production prepare/update algorithm and its counters.
   serialized_count=saqt_serialize(*after,serialized,count*4*50);if(serialized_count!=after->blocks.size()*50)return saqt_state_fail(__LINE__);report[15]=serialized_count;report[16]=after->blocks.size();
   // SAME actual source, two simultaneous explicit cold derivations. Their
   // different local origins must not collide under an identical source key.
   {const auto*kept=after->blocks.chunk(0);auto left=options,right=options;left.origin[0]=.25;right.origin[0]=.5;right.maximum_error_l1=1e-7;BoundaryQuantizationLease l{},r{};
    if(state.prepare_cold(b,qb,left,l)||state.prepare_cold(b,qb,right,r))return saqt_state_fail(__LINE__);
    const auto*L=state.read(l);const auto*R=state.read(r);const auto*lc=L?L->blocks.chunk(0):nullptr;const auto*rc=R?R->blocks.chunk(0):nullptr;
    if(!lc||!rc||lc->identity!=rc->identity||lc->revision==rc->revision||lc->values[0].edge.controls[0]==rc->values[0].edge.controls[0]||after->blocks.chunk(0)!=kept||lc->revision==kept->revision||rc->revision==kept->revision)return saqt_state_fail(__LINE__);
    if(state.cancel(l)||state.release(l)||state.cancel(r)||state.release(r)||state.read(qb)!=after)return saqt_state_fail(__LINE__);++report[0];}
   // Prepare C, then full prepare D. Cold reset explicitly retires old stages.
   if(state.prepare_update(d,qb,options,qd))return saqt_state_fail(__LINE__);
   SABoundaryPath other=path;other.fill=SA_BOUNDARY_EVENODD;
   const uint64_t retained_before=c.live_bytes;const auto source_reset=sa_boundary_prepare(raw,&C,&other,1,source_blocks,count,source_commands,count*5,&D);
   if(count>128){
    // A second full4096-source graph does not fit this explicitly256MiB
    // arena while old source/derived leases remain pinned. Admission must fail
    // atomically, not evict caller-owned snapshots or relax the resource cap.
    if(source_reset!=SA_INK_CAPACITY||D.owner||c.live_bytes!=retained_before||!d.valid()||!d.latest()||state.read(qb)!=after||state.commit(qd))return saqt_state_fail(__LINE__);
    report[14]=1;++report[0];if(state.release(qa)||state.release(qb)||state.release(qd))return saqt_state_fail(__LINE__);
    state.retire();if(state.read(qd)||state.prepare_cold(d,{},options,sentinel)!=SA_INK_INVALID)return saqt_state_fail(__LINE__);++report[0];
   }else{
    if(source_reset||BoundaryQuantizationSourcePin::capture(raw,D,reset)||state.prepare_cold(reset,qb,options,qe)||state.commit(qe))return saqt_state_fail(__LINE__);
    if(state.read(qd)||state.commit(qd)!=SA_INK_INVALID||state.release(qd)||!state.read(qa)||state.commit(qa)!=SA_INK_INVALID)return saqt_state_fail(__LINE__);++report[0];
    if(state.release(qa)||state.release(qb)||state.release(qe))return saqt_state_fail(__LINE__);state.retire();if(state.read(qe)||state.prepare_cold(reset,{},options,sentinel)!=SA_INK_INVALID)return saqt_state_fail(__LINE__);++report[0];
   }
  }
  if(sa_boundary_release(raw,A)||sa_boundary_release(raw,B)||sa_boundary_release(raw,C)||(D.owner&&sa_boundary_release(raw,D)))return saqt_state_fail(__LINE__);
 }
 if(sa_boundary_destroy(raw))return saqt_state_fail(__LINE__);
 for(uint32_t i=0;i<24;i++)output[i]=report[i];for(uint32_t i=0;i<serialized_count;i++)output[24+i]=serialized[i];return status;
}
extern "C" uint32_t saqt_curve_state(void*memory,uint32_t bytes,uint64_t*output,uint32_t capacity){
 if(!memory||((uintptr_t)memory&15u)||bytes<48*1024*1024||!output||capacity<1024||memory_overlap(memory,bytes,output,uint64_t(capacity)*8))return saqt_state_fail(__LINE__);
 auto*raw=(uint8_t*)memory;for(uint32_t i=0;i<4096;i++)raw[i]=0;SABoundaryBudget budget{};budget.max_commands=32;budget.max_curves=32;budget.max_pairs=256;budget.max_cuts=1024;budget.max_edges=1024;budget.max_sources=4;budget.max_paths=2;budget.max_leases=4;budget.max_polynomial_degree=64;budget.max_stored_bits=stored_bits;budget.max_polynomial_operations=50000000;budget.max_limb_operations=1000000000;budget.retained_bytes=16*1024*1024;budget.workspace_bytes=16*1024*1024;
 if(sa_boundary_initialize(raw,4096,937,raw+4096,32*1024*1024,&budget))return saqt_state_fail(__LINE__);auto*actual=owner(raw);auto&c=actual->math.numbers;uint64_t report[24]{};auto*serialized=(uint64_t*)(raw+4096+32*1024*1024);
 {
  SABoundaryPath paths[2]={{0,0,{0,0}},{0,1,{0,0}}};SABoundarySourceBlock sources[2]{};for(uint32_t i=0;i<2;i++){sources[i].key.words[0]=i+1;sources[i].path_index=i;sources[i].affine[0]=sources[i].affine[3]=1;}sources[0].command_count=3;sources[1].first_command=3;sources[1].command_count=5;
  SAInkPathCommand commands[8]={{0,0,{0,0}},{2,0,{.5,1,1,0}},{4,0,{}},{0,0,{-1,.25}},{1,0,{2,.25}},{1,0,{2,2}},{1,0,{-1,2}},{4,0,{}}};SABoundaryLease A{},B{};
  if(sa_boundary_prepare(raw,nullptr,paths,2,sources,2,commands,8,&A))return saqt_state_fail(__LINE__);BoundaryQuantizationSourcePin a,b;if(BoundaryQuantizationSourcePin::capture(raw,A,a))return saqt_state_fail(__LINE__);
  {
   BoundaryQuantizationState state(a,938,6);BoundaryQuantizationOptions options{};options.maximum_error_l1=1e-9;options.maximum_refinements=10000;options.maximum_vertices=100;options.maximum_edges=100;BoundaryQuantizationLease qa{},qb{};
   if(state.prepare_cold(a,{},options,qa)||state.commit(qa))return saqt_state_fail(__LINE__);const auto*first=state.read(qa);if(!first||first->blocks.size()<2)return saqt_state_fail(__LINE__);
   uint32_t algebraic=0;first->blocks.each_chunk([&](uint32_t slot,const ChunkTree<BoundaryQuantizedArc>::Chunk&chunk){const auto*source=first->source.get()->graph.edges.chunk(slot);for(const auto&e:source->values){auto point=vertex_certificate(first->source.get()->graph,e.va);if(point.certificate.valid()&&!point.certificate.get()->point.get()->exact())++algebraic;}});if(algebraic<2)return saqt_state_fail(__LINE__);
   SABoundarySourceMutation mutation{};mutation.source=sources[1];mutation.source.first_command=0;SAInkPathCommand clip[5]={{0,0,{-1,.4}},{1,0,{2,.4}},{1,0,{2,2}},{1,0,{-1,2}},{4,0,{}}};if(sa_boundary_update(raw,&A,&mutation,1,clip,5,&B)||BoundaryQuantizationSourcePin::capture(raw,B,b)||state.prepare_update(b,qa,options,qb)||state.commit(qb))return saqt_state_fail(__LINE__);
   const auto*next=state.read(qb);if(!next||!state.read(qa))return saqt_state_fail(__LINE__);report[0]=3;report[1]=2;report[4]=next->work.blocks;report[5]=next->work.arcs;report[6]=next->work.anchor_nodes;report[7]=next->work.anchor_visits;report[8]=next->work.math.root_refinements;report[9]=next->work.math.polynomial_operations;report[10]=next->work.math.limb_operations;report[11]=next->work.aliases;report[17]=algebraic;report[12]=next->blocks.size();report[15]=saqt_serialize(*next,serialized,1000);report[16]=next->blocks.size();if(report[15]!=report[16]*50)return saqt_state_fail(__LINE__);
   if(state.release(qa)||state.release(qb))return saqt_state_fail(__LINE__);state.retire();
  }
  if(sa_boundary_release(raw,A)||sa_boundary_release(raw,B))return saqt_state_fail(__LINE__);
 }
 if(sa_boundary_destroy(raw))return saqt_state_fail(__LINE__);for(uint32_t i=0;i<24;i++)output[i]=report[i];for(uint32_t i=0;i<report[15];i++)output[24+i]=serialized[i];return SA_INK_OK;
}
