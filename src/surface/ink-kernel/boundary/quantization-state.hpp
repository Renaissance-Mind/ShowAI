#ifndef SHOWAI_BOUNDARY_QUANTIZATION_STATE_HPP
#define SHOWAI_BOUNDARY_QUANTIZATION_STATE_HPP
#include "quantization-anchors.hpp"
#include "quantization-source-pin.hpp"
namespace showai_boundary {
struct BoundaryQuantizedBlockChange{SABoundaryBlockKey before{},after{};uint64_t before_revision=0,after_revision=0;};
struct BoundaryQuantizationWork{uint64_t blocks=0,arcs=0,incident_blocks=0,aliases=0,certificates=0,new_anchors=0,anchor_nodes=0,anchor_visits=0;BoundaryQuantizationMetrics math{};};
struct BoundaryQuantizationSnapshot{
 // First member: destroyed last, after all source-arena records.
 BoundaryQuantizationSourcePin source;
 BoundaryAnchorTable anchors;ChunkTree<BoundaryQuantizedArc>blocks;
 Vector<BoundaryQuantizedBlockChange,1>changes;
 BoundaryQuantizationOptions options{};BoundaryQuantizationWork work{};
 uint64_t revision=0,next_block_revision=1;
 explicit BoundaryQuantizationSnapshot(Context&c):anchors(c),blocks(c),changes(c){}
};
namespace boundary_quantization_state {
inline bool same_options(const BoundaryQuantizationOptions&a,const BoundaryQuantizationOptions&b){return equal_double(a.origin[0],b.origin[0])&&equal_double(a.origin[1],b.origin[1])&&equal_double(a.maximum_error_l1,b.maximum_error_l1);}
inline bool valid_options(const BoundaryQuantizationOptions&o){return finite_double(o.origin[0])&&finite_double(o.origin[1])&&finite_double(o.maximum_error_l1)&&o.maximum_error_l1>0&&!o.reserved&&o.maximum_refinements<=1000000&&o.maximum_vertices&&o.maximum_edges;}
inline bool bind(BoundaryQuantizationSnapshot&s,const VertexCertificateLookup&actual,uint32_t representative,uint32_t endpoint){
 auto&c=*s.anchors.context();if(!actual.certificate.valid()||actual.certificate.context()!=&c||!actual.certificate.get()->point.valid()){c.fail(SA_INK_RANGE);return false;}
 const auto point=actual.certificate.get()->point;const auto*old=s.anchors.get(point);
 if(old&&old->certificate.get()==actual.certificate.get())return true;
 BoundaryAnchorBinding next;next.point=point;next.certificate=actual.certificate;
 if(old)next.anchor=old->anchor;
 else{
  BoundaryQuantizedVertex value{};bool okay=false;auto options=s.options;
  if(s.work.math.root_refinements>options.maximum_refinements){c.fail(SA_INK_RANGE);return false;}options.maximum_refinements-=uint32_t(s.work.math.root_refinements);
  BoundaryQuantizationMetrics metrics{};
  if(point.get()->exact())okay=boundary_quantization::anchor_exact_point(point.get()->rational,actual.canonical,representative,endpoint,options,metrics,value);
  else{const auto&p=*point.get()->algebraic.get();if(!p.function.valid()){c.fail(SA_INK_RANGE);return false;}okay=boundary_quantization::anchor_polynomials(p.function.get()->x,p.function.get()->y,p.parameter,actual.canonical,representative,endpoint,options,metrics,value);}
  if(!okay)return false;s.work.math.root_refinements+=metrics.root_refinements;s.work.math.vertex_attempts+=metrics.vertex_attempts;
  next.anchor=Record<BoundaryQuantizedVertex>::create(c,value);++s.work.new_anchors;
 }
 return !c.status&&s.anchors.set(next);
}
inline bool selected_add(Context&c,PagedVector<uint8_t,6>&marked,Vector<uint32_t,1>&selected,uint32_t slot){if(slot>=marked.size()){c.fail(SA_INK_RANGE);return false;}if(!static_cast<const PagedVector<uint8_t,6>&>(marked)[slot]){marked[slot]=1;selected.push_back(slot);}return !c.status;}
inline uint32_t build(const BoundaryQuantizationSourcePin&source,const BoundaryQuantizationSnapshot*before,bool cold,const BoundaryQuantizationOptions&o,uint64_t revision,BoundaryQuantizationSnapshot&output,uint64_t first_block_revision=1){
 const auto*held=source.get();if(!held||!valid_options(o))return SA_INK_INVALID;const auto&g=held->graph;auto&c=*g.context();
 if(output.anchors.context()!=&c||(!cold&&(!before||!before->source.valid()||before->source.domain()!=source.domain()||(!before->source.same_snapshot(source)&&!before->source.base_of(source))||!same_options(before->options,o))))return SA_INK_INVALID;
 if(g.edges.size()>o.maximum_edges)return SA_INK_CAPACITY;
 const uint64_t poly=g.math->polynomial.operations,work=c.work;
 BoundaryQuantizationSnapshot staged(c);if(!cold)staged=*before;staged.source=source;staged.next_block_revision=first_block_revision;staged.options=o;staged.revision=revision;staged.changes=Vector<BoundaryQuantizedBlockChange,1>(c);staged.work={};staged.anchors.reset_metrics();staged.blocks.reset_metrics();
 PagedVector<uint8_t,6>marked(c),incident_marked(c),cleanup_marked(c);marked.resize(g.curves.size());incident_marked.resize(g.parent.size());cleanup_marked.resize(before?before->source.get()->graph.parent.size():0);Vector<uint32_t,1>selected(c),cleanup(c);
 auto add=[&](uint32_t slot){return selected_add(c,marked,selected,slot);};
 if(cold){g.edges.each_chunk([&](uint32_t slot,const ChunkTree<Edge>::Chunk&){add(slot);});}
 else if(!before->source.same_snapshot(source)){
  const auto&old=before->source.get()->graph;
  for(const auto&change:g.output_changes){
   if(change.before_edges&&!checked_block(old,change.before)){c.fail(SA_INK_INVALID);break;}
   if(change.after_edges&&!checked_block(g,change.after)){c.fail(SA_INK_INVALID);break;}
   uint32_t slot=change.after_edges?change.after.slot:change.before.slot;if(!add(slot))break;
   if(change.before_edges){const auto*block=checked_block(old,change.before);for(const auto&e:block->values){uint32_t raw[2]={e.va,e.vb};for(uint32_t v:raw)if(!selected_add(c,cleanup_marked,cleanup,v))break;}}
  }
  // Actual producer aliases prove equality. Choose a certified retained anchor,
  // then rebuild the full actual incident set once per resulting component.
  for(const auto&record:g.point_aliases){
   if(!record.valid()||record.context()!=&c){c.fail(SA_INK_INVALID);break;}const auto&a=*record.get();++staged.work.aliases;
   auto actual=vertex_certificate(g,a.target);if(!g.good())break;
   if(!actual.certificate.valid()){if(a.a.valid())staged.anchors.erase(a.a);if(a.b.valid())staged.anchors.erase(a.b);if(a.point.valid())staged.anchors.erase(a.point);continue;}
   const BoundaryAnchorBinding*chosen=a.point.valid()?staged.anchors.get(a.point):nullptr;
   if(!chosen&&a.a.valid())chosen=staged.anchors.get(a.a);if(!chosen&&a.b.valid())chosen=staged.anchors.get(a.b);
   Record<BoundaryQuantizedVertex>anchor=chosen?chosen->anchor:Record<BoundaryQuantizedVertex>();
   if(a.a.valid()&&a.a.get()!=a.point.get())staged.anchors.erase(a.a);if(a.b.valid()&&a.b.get()!=a.point.get())staged.anchors.erase(a.b);
   if(anchor.valid()){BoundaryAnchorBinding binding;binding.point=a.point;binding.anchor=anchor;if(a.before_a.valid()&&a.before_a.get()->point.get()==a.point.get())binding.certificate=a.before_a;else if(a.before_b.valid()&&a.before_b.get()->point.get()==a.point.get())binding.certificate=a.before_b;if(!staged.anchors.set(binding))break;}
   if(!static_cast<const PagedVector<uint8_t,6>&>(incident_marked)[actual.canonical]){
    incident_marked[actual.canonical]=1;if(!vertex_incidents(g,actual.canonical,[&](const IncidentNode<Edge>&entry){++staged.work.incident_blocks;if(entry.epoch!=g.output_epoch||g.edges.chunk(entry.slot)!=entry.block.get()){c.fail(SA_INK_INVALID);return false;}return add(entry.slot);}))break;
   }
  }
  for(uint32_t v:cleanup){auto previous=vertex_certificate(old,v);if(!old.good())break;if(!previous.certificate.valid())continue;auto current=vertex_certificate(g,v);if(!g.good())break;if(!current.certificate.valid()||current.certificate.get()->point.get()!=previous.certificate.get()->point.get())staged.anchors.erase(previous.certificate.get()->point);}
  for(const auto&change:g.vertex_changes){++staged.work.certificates;auto actual=vertex_certificate(g,change.vertex);if(!g.good())break;if(actual.certificate.valid()&&staged.anchors.get(actual.certificate.get()->point))if(!bind(staged,actual,change.vertex,0))break;}
 }
 for(uint32_t slot:selected){
  if(!g.good())break;const auto*chunk=g.edges.chunk(slot);const auto*old=staged.blocks.chunk(slot);BoundaryQuantizedBlockChange change{};
  if(old){change.before_revision=old->revision;if(before){auto*source_before=before->source.get()->graph.edges.chunk(slot);if(!source_before||source_before->identity!=old->identity){c.fail(SA_INK_INVALID);break;}change.before=block_key(before->source.get()->graph,slot,source_before);}}
  if(!chunk){staged.blocks.erase(slot);staged.changes.push_back(change);continue;}
  if(staged.next_block_revision==UINT64_MAX){c.fail(SA_INK_CAPACITY);break;}
  SharedChunkValues<BoundaryQuantizedArc>arcs(c);
  for(uint32_t i=0;i<chunk->values.size()&&g.good();i++){
   const auto&e=chunk->values[i];auto a=vertex_certificate(g,e.va),b=vertex_certificate(g,e.vb);
   if(!bind(staged,a,slot,0)||!bind(staged,b,slot,1))break;
   const auto*left=staged.anchors.get(a.certificate.get()->point);const auto*right=staged.anchors.get(b.certificate.get()->point);if(!left||!right){c.fail(SA_INK_RANGE);break;}
   BoundaryQuantizedArc arc;arc.a=left->anchor;arc.b=right->anchor;BoundaryQuantizationMetrics metrics{};auto options=o;if(staged.work.math.root_refinements>o.maximum_refinements){c.fail(SA_INK_RANGE);break;}options.maximum_refinements-=uint32_t(staged.work.math.root_refinements);
   if(!boundary_quantization::captured_edge(g,e,i,*arc.a.get(),*arc.b.get(),options,metrics,arc.edge,a.canonical,b.canonical))break;
   staged.work.math.root_refinements+=metrics.root_refinements;staged.work.math.edge_attempts+=metrics.edge_attempts;
   if(!arcs.push_back(arc))break;++staged.work.arcs;
  }
  if(!g.good())break;
  change.after=block_key(g,slot,chunk);change.after_revision=staged.next_block_revision++;
  if(!staged.blocks.set_owned(slot,chunk->identity,change.after_revision,arcs))break;staged.changes.push_back(change);++staged.work.blocks;
 }
 if(!g.good())return c.status;if(staged.blocks.size()!=g.edges.size())return SA_INK_RANGE;if(staged.anchors.size()>o.maximum_vertices||staged.blocks.size()>o.maximum_edges)return SA_INK_CAPACITY;
 staged.work.anchor_nodes=staged.anchors.created_nodes();staged.work.anchor_visits=staged.anchors.visits();staged.work.math.polynomial_operations=g.math->polynomial.operations-poly;staged.work.math.limb_operations=c.work-work;staged.work.math.arena_peak_bytes=c.peak_bytes;
 output=static_cast<BoundaryQuantizationSnapshot&&>(staged);return SA_INK_OK;
}
 }
// Internal owner API. Flat keys are accepted only against this actual registry.
// Public ABI/wrappers must also bind their actual WASM instance / Swift storage.
struct BoundaryQuantizationLease{uint64_t owner=0;uint32_t epoch=0,slot=0,generation=0,reserved=0;};
class BoundaryQuantizationState{
 struct Slot{Record<BoundaryQuantizationSnapshot>snapshot;uint64_t base_revision=0;uint32_t generation=0,references=0;bool prepared=false,cancelled=false,cold=false;};
 BoundaryQuantizationSourcePin domain_pin_;Vector<Slot,1>slots_;
 uint32_t initialization_status_=SA_INK_INVALID;
 uint32_t epoch_=0,current_=no_index,next_generation_=1;uint64_t next_revision_=1,next_block_revision_=1;bool retired_=false,busy_=false;
 const Slot&edit_slot(uint32_t index)const{return static_cast<const Vector<Slot,1>&>(slots_)[index];}
 Slot&edit_slot(uint32_t index){return const_cast<Slot&>(static_cast<const Vector<Slot,1>&>(slots_)[index]);}
 bool valid(BoundaryQuantizationLease key,bool cancelled=false)const{return key.owner==uint64_t((uintptr_t)this)&&!key.reserved&&key.epoch==epoch_&&key.slot<slots_.size()&&edit_slot(key.slot).references&&edit_slot(key.slot).generation==key.generation&&edit_slot(key.slot).snapshot.valid()&&(cancelled||!edit_slot(key.slot).cancelled);}
 BoundaryQuantizationLease key(uint32_t slot)const{return{uint64_t((uintptr_t)this),epoch_,slot,edit_slot(slot).generation,0};}
 void drop(uint32_t slot){auto&s=edit_slot(slot);if(!--s.references)s=Slot();}
 uint32_t prepare(const BoundaryQuantizationSourcePin&source,bool cold,BoundaryQuantizationLease base,const BoundaryQuantizationOptions&o,BoundaryQuantizationLease&output){
  if(initialization_status_)return initialization_status_;
  if(retired_||busy_||!source.valid()||source.domain()!=domain_pin_.domain()||!epoch_||!boundary_quantization_state::valid_options(o))return SA_INK_INVALID;
  if(current_==no_index){if(base.owner||base.epoch||base.slot||base.generation||base.reserved||!cold)return SA_INK_INVALID;}else if(!valid(base)||base.slot!=current_)return SA_INK_INVALID;
  if(next_generation_==UINT32_MAX||next_revision_==UINT64_MAX||next_block_revision_==UINT64_MAX)return SA_INK_CAPACITY;
  uint32_t target=no_index;for(uint32_t i=0;i<slots_.size();i++)if(!edit_slot(i).references){target=i;break;}if(target==no_index)return SA_INK_CAPACITY;
  auto*actual=const_cast<Owner*>(domain_pin_.domain());if(!actual->begin())return SA_INK_INVALID;OwnerCall call(*actual);busy_=true;
  uint32_t result=SA_INK_OK;Record<BoundaryQuantizationSnapshot>captured;
  const auto*before=current_==no_index?nullptr:edit_slot(current_).snapshot.get();
  {
   BoundaryQuantizationSnapshot staged(actual->math.numbers);
   if(cold&&before&&!before->source.same_snapshot(source)&&!before->source.base_of(source)&&
      !(source.get()->graph.output_reset&&source.source().generation>before->source.source().generation))result=SA_INK_INVALID;
   else result=boundary_quantization_state::build(source,before,cold,o,next_revision_,staged,next_block_revision_);
   if(!result)captured=Record<BoundaryQuantizationSnapshot>::create(actual->math.numbers,staged);
  }
  auto&c=actual->math.numbers;if(!result&&c.status)result=c.status;
  if(!result&&(c.live_bytes>actual->budget.retained_bytes||c.peak_bytes-c.live_bytes>actual->budget.workspace_bytes))result=SA_INK_CAPACITY;
  if(!result){auto&slot=edit_slot(target);slot.snapshot=static_cast<Record<BoundaryQuantizationSnapshot>&&>(captured);slot.base_revision=before?before->revision:0;slot.generation=next_generation_++;slot.references=2;slot.prepared=true;slot.cancelled=false;slot.cold=cold;next_block_revision_=slot.snapshot.get()->next_block_revision;++next_revision_;output=key(target);}
  busy_=false;return result;
 }
public:
 // Requires an already actually captured source pin; never accepts a caller Graph.
 BoundaryQuantizationState(const BoundaryQuantizationSourcePin&source,uint32_t epoch,uint32_t maximum_leases):domain_pin_(source),slots_(source.valid()?Vector<Slot,1>(*source.get()->graph.context()):Vector<Slot,1>()),epoch_(epoch){
  if(!source.valid())return;auto&c=*source.get()->graph.context();if(!epoch||!maximum_leases||maximum_leases>1024){c.fail(SA_INK_INVALID);return;}slots_.resize(maximum_leases);initialization_status_=c.status;
 }
 uint32_t initialization_status()const{return initialization_status_;}
 BoundaryQuantizationState(const BoundaryQuantizationState&)=delete;BoundaryQuantizationState&operator=(const BoundaryQuantizationState&)=delete;
 uint32_t prepare_cold(const BoundaryQuantizationSourcePin&source,BoundaryQuantizationLease base,const BoundaryQuantizationOptions&o,BoundaryQuantizationLease&output){return prepare(source,true,base,o,output);}
 uint32_t prepare_update(const BoundaryQuantizationSourcePin&source,BoundaryQuantizationLease base,const BoundaryQuantizationOptions&o,BoundaryQuantizationLease&output){return prepare(source,false,base,o,output);}
 const BoundaryQuantizationSnapshot*read(BoundaryQuantizationLease lease)const{return !retired_&&valid(lease)?edit_slot(lease.slot).snapshot.get():nullptr;}
 BoundaryQuantizationLease current()const{return current_==no_index?BoundaryQuantizationLease():key(current_);}
 uint32_t commit(BoundaryQuantizationLease lease){
  if(retired_||busy_||!valid(lease)||!edit_slot(lease.slot).prepared)return SA_INK_INVALID;auto&slot=edit_slot(lease.slot);
  const uint64_t revision=current_==no_index?0:edit_slot(current_).snapshot.get()->revision;if(slot.base_revision!=revision)return SA_INK_INVALID;
  const auto*next=slot.snapshot.get();if(!next->source.valid()||next->source.domain()!=domain_pin_.domain())return SA_INK_INVALID;
  if(!slot.cold&&current_!=no_index){const auto&prior=edit_slot(current_).snapshot.get()->source;if(!prior.same_snapshot(next->source)&&!prior.base_of(next->source))return SA_INK_INVALID;}
  BoundaryQuantizationSourcePin next_domain(next->source);if(!next_domain.valid())return SA_INK_CAPACITY;
  domain_pin_=static_cast<BoundaryQuantizationSourcePin&&>(next_domain);uint32_t previous=current_;current_=lease.slot;slot.prepared=false;
  if(previous!=no_index)drop(previous);
  if(slot.cold)for(uint32_t i=0;i<slots_.size();i++)if(i!=current_&&edit_slot(i).references&&edit_slot(i).prepared){edit_slot(i).cancelled=true;edit_slot(i).prepared=false;drop(i);}
  return SA_INK_OK;
 }
 uint32_t cancel(BoundaryQuantizationLease lease){if(busy_||!valid(lease)||!edit_slot(lease.slot).prepared)return SA_INK_INVALID;auto&s=edit_slot(lease.slot);s.cancelled=true;s.prepared=false;drop(lease.slot);return SA_INK_OK;}
 uint32_t retain(BoundaryQuantizationLease lease){if(retired_||busy_||!valid(lease))return SA_INK_INVALID;auto&s=edit_slot(lease.slot);if(s.references==UINT32_MAX)return SA_INK_CAPACITY;++s.references;return SA_INK_OK;}
 uint32_t release(BoundaryQuantizationLease lease){if(busy_||!valid(lease,true))return SA_INK_INVALID;auto&s=edit_slot(lease.slot);uint32_t internal=lease.slot==current_||s.prepared?1:0;if(s.references<=internal)return SA_INK_INVALID;drop(lease.slot);return SA_INK_OK;}
 void retire(){if(retired_||busy_)return;retired_=true;uint32_t current=current_;current_=no_index;for(uint32_t i=0;i<slots_.size();i++)if(edit_slot(i).references&&(i==current||edit_slot(i).prepared)){edit_slot(i).prepared=false;edit_slot(i).cancelled=true;drop(i);}}
};
}
#endif
