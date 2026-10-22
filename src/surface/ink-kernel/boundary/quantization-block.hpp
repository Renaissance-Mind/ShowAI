#ifndef SHOWAI_BOUNDARY_QUANTIZATION_BLOCK_HPP
#define SHOWAI_BOUNDARY_QUANTIZATION_BLOCK_HPP
#include "quantization.hpp"
namespace showai_boundary {
// An internal mathematical staging primitive, not a public lease/authority API.
// The state owner must resolve the actual source lease and its vertex records,
// and supply the retained anchors for that exact snapshot. These records keep
// endpoint bits alive with every derived arc; no consumer-owned integer grants
// authority. Budget admission/commit across multiple blocks belongs to the state
// owner. The full cold exporter remains available separately.
struct BoundaryQuantizedAnchorPair {
    Record<BoundaryQuantizedVertex>a,b;
    // Actual current endpoint topology, independent of the anchor's immutable
    // original representative metadata after a proved vertex alias/union.
    uint32_t vertex_a=no_index,vertex_b=no_index;
};
struct BoundaryQuantizedArc {
    BoundaryQuantizedEdge edge{};
    Record<BoundaryQuantizedVertex>a,b;
};
struct BoundaryQuantizedBlock {
    SABoundaryBlockKey source{};
    SharedChunkValues<BoundaryQuantizedArc>arcs;
    BoundaryQuantizationMetrics metrics{};
    explicit BoundaryQuantizedBlock(Context&c):arcs(c){}
};
inline uint32_t quantize_boundary_block(const Graph&g,SABoundaryBlockKey key,
        const Vector<BoundaryQuantizedAnchorPair,1>&anchors,
        const BoundaryQuantizationOptions&o,BoundaryQuantizedBlock&output){
    auto&c=*g.context();if(!g.good())return c.status;
    if(key.reserved||key.epoch!=g.output_epoch||!key.curve||!key.revision||
       !finite_double(o.origin[0])||!finite_double(o.origin[1])||!finite_double(o.maximum_error_l1)||!(o.maximum_error_l1>0)||o.reserved||
       o.maximum_refinements>1000000||!o.maximum_vertices||!o.maximum_edges||
       anchors.context()!=&c||output.arcs.context()!=&c)return SA_INK_INVALID;
    const auto*chunk=g.edges.chunk(key.slot);
    if(!chunk||chunk->identity!=key.curve||chunk->revision!=key.revision)return SA_INK_INVALID;
    if(anchors.size()!=chunk->values.size())return SA_INK_INVALID;
    if(chunk->values.size()>o.maximum_edges)return SA_INK_CAPACITY;
    const uint64_t poly_before=g.math->polynomial.operations,work_before=c.work;
    BoundaryQuantizedBlock staged(c);staged.source=key;
    for(uint32_t i=0;i<chunk->values.size()&&g.good();i++){
        const auto&e=chunk->values[i];const auto&pair=anchors[i];
        if(!pair.a.valid()||!pair.b.valid()||pair.a.context()!=&c||pair.b.context()!=&c){c.fail(SA_INK_INVALID);break;}
        const auto&a=*pair.a.get();const auto&b=*pair.b.get();
        const uint32_t va=boundary_quantization::vertex_root(g,e.va),vb=boundary_quantization::vertex_root(g,e.vb);
        const uint32_t topology_a=pair.vertex_a==no_index?a.vertex:pair.vertex_a,topology_b=pair.vertex_b==no_index?b.vertex:pair.vertex_b;
        if(topology_a!=va||topology_b!=vb||a.reserved||b.reserved||
           !finite_double(a.position[0])||!finite_double(a.position[1])||!finite_double(b.position[0])||!finite_double(b.position[1])||
           !finite_double(a.error_l1)||!finite_double(b.error_l1)||a.error_l1<0||b.error_l1<0){c.fail(SA_INK_INVALID);break;}
        BoundaryQuantizedArc arc;arc.a=pair.a;arc.b=pair.b;
        if(!boundary_quantization::captured_edge(g,e,i,a,b,o,staged.metrics,arc.edge,topology_a,topology_b)){if(g.good())c.fail(SA_INK_RANGE);break;}
        if(!staged.arcs.push_back(arc))break;
    }
    if(!g.good())return c.status;
    staged.metrics.polynomial_operations=g.math->polynomial.operations-poly_before;
    staged.metrics.limb_operations=c.work-work_before;staged.metrics.arena_peak_bytes=c.peak_bytes;
    output=static_cast<BoundaryQuantizedBlock&&>(staged);return SA_INK_OK;
}
}
#endif
