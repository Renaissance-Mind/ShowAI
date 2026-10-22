#ifndef SHOWAI_BOUNDARY_QUANTIZATION_HPP
#define SHOWAI_BOUNDARY_QUANTIZATION_HPP
#include "graph.hpp"
namespace showai_boundary {
/* Derived quantization version 1. This is NOT a portable source format or an
 * exact Boolean/topology claim. The retained Curve and Root certificates remain
 * authoritative. All coordinates below are relative to ONE common owner/paint
 * origin. No rounded world-space addition is part of the promised error bound.
 * A consumer must additionally bound its affine/physical metric and GPU error.
 *
 * For F(u)=C(a+(b-a)u), choose rational interval midpoints alpha,beta. Bernstein
 * derivative controls bound |C'_x|<=Mx and |C'_y|<=My on [0,1]. Thus, for every
 * u in [0,1], ||F(u)-C(alpha+(beta-alpha)u)||_1 <= (Mx+My)*delta, where delta is
 * max half-width of the two certified root intervals. The exact restricted
 * curve has Bernstein controls D_i. Quantized controls P_i (including shared
 * endpoint anchors) satisfy ||B_P-B_D||_1 <= max_i|P_ix-D_ix|+max_i|P_iy-D_iy|.
 * Both bounds are computed as actual exact Q values; only their outward upper
 * binary64 encoding escapes. No midpoint/sample test substitutes for this bound.
 */
constexpr uint32_t boundary_quantization_version=1;
struct BoundaryQuantizationOptions {
    double origin[2]{},maximum_error_l1=0;
    uint32_t maximum_refinements=0,maximum_vertices=0,maximum_edges=0,reserved=0;
};
struct BoundaryQuantizedVertex {
    uint32_t vertex=0,representative_edge=0,endpoint=0,reserved=0;
    double position[2]{},error_l1=0;
};
struct BoundaryQuantizedEdge {
    SABoundarySourceKey source{};uint32_t command_index=0,source_flags=0;
    uint32_t edge=0,curve=0,degree=0,vertex_a=0,vertex_b=0;
    uint32_t certificate_a=0,certificate_b=0,reserved=0;
    uint64_t curve_identity=0;
    int32_t direction=0;uint32_t reserved2=0;
    double controls[8]{},error_l1=0,parameter_error_l1=0,control_error_l1=0;
};
struct BoundaryQuantizationMetrics {
    uint64_t root_refinements=0,vertex_attempts=0,edge_attempts=0;
    uint64_t polynomial_operations=0,limb_operations=0,arena_peak_bytes=0;
};
struct BoundaryQuantizedGraph {
    Vector<BoundaryQuantizedVertex>vertices;Vector<BoundaryQuantizedEdge>edges;
    uint32_t version=boundary_quantization_version,reserved=0;
    BoundaryQuantizationOptions options{};BoundaryQuantizationMetrics metrics{};
    explicit BoundaryQuantizedGraph(Context&c):vertices(c),edges(c){}
};
namespace boundary_quantization {
inline Q maximum(const Q&a,const Q&b){return a>b?a:b;}
inline bool nearest_lower_tie(const Q&value,double&out){
    double lo=0,hi=0;if(!value.bounds(lo,hi)||!finite_double(lo)||!finite_double(hi)){if(value.context())value.context()->fail(SA_INK_RANGE);return false;}
    Q a=Q::from_double(*value.context(),lo),b=Q::from_double(*value.context(),hi);
    out=value-a<=b-value?lo:hi;return value.context()->status==SA_INK_OK;
}
inline bool upper_bound(const Q&value,double&out){
    double lo=0;if(!value.bounds(lo,out)||!finite_double(out)||value<Q(0)){if(value.context())value.context()->fail(SA_INK_RANGE);return false;}return value.context()->status==SA_INK_OK;
}
inline bool refine_owned(Root&r,BoundaryQuantizationMetrics&m,const BoundaryQuantizationOptions&o){
    if(!r.valid()||r.exact())return false;
    if(m.root_refinements>=o.maximum_refinements){r.context()->fail(SA_INK_RANGE);return false;}
    ++m.root_refinements;refine(r);return r.valid();
}
inline bool in_domain(const Root&r){return r.lower>=Q(0)&&r.upper<=Q(1)&&r.lower<=r.upper;}
inline bool root_domain(Root&r,BoundaryQuantizationMetrics&m,const BoundaryQuantizationOptions&o){
    while(r.valid()&&!in_domain(r)){
        if(r.lower>r.upper||r.upper<Q(0)||r.lower>Q(1)){r.context()->fail(SA_INK_RANGE);return false;}
        if(!refine_owned(r,m,o))return false;
    }return r.valid();
}
inline uint32_t vertex_root(const Graph&g,uint32_t v){
    uint32_t steps=0;while(v<g.parent.size()&&g.parent[v]!=v){if(++steps>g.parent.size()){g.context()->fail(SA_INK_RANGE);return no_index;}v=g.parent[v];}
    if(v>=g.parent.size()){g.context()->fail(SA_INK_RANGE);return no_index;}return v;
}
inline bool anchor(const Curve&curve,Root root,uint32_t vertex,uint32_t edge,uint32_t endpoint,
                   const BoundaryQuantizationOptions&o,BoundaryQuantizationMetrics&m,BoundaryQuantizedVertex&output){
    auto&c=*curve.context();if(root.context()!=&c){c.fail(SA_INK_INVALID);return false;}if(!root_domain(root,m,o))return false;
    const Q ox=Q::from_double(c,o.origin[0]),oy=Q::from_double(c,o.origin[1]),allowed=Q::from_double(c,o.maximum_error_l1)/Q(8);
    while(c.status==SA_INK_OK){
        ++m.vertex_attempts;auto x=evaluate(curve.x,Interval{root.lower,root.upper}),y=evaluate(curve.y,Interval{root.lower,root.upper});
        double px=0,py=0;if(!nearest_lower_tie((x.lower+x.upper)/Q(2)-ox,px)||!nearest_lower_tie((y.lower+y.upper)/Q(2)-oy,py))return false;
        const Q qx=Q::from_double(c,px)+ox,qy=Q::from_double(c,py)+oy;
        const Q error=maximum((qx-x.lower).absolute(),(qx-x.upper).absolute())+maximum((qy-y.lower).absolute(),(qy-y.upper).absolute());
        if(error<=allowed){BoundaryQuantizedVertex staged{};staged.vertex=vertex;staged.representative_edge=edge;staged.endpoint=endpoint;staged.position[0]=px;staged.position[1]=py;if(!upper_bound(error,staged.error_l1))return false;output=staged;return true;}
        if(!refine_owned(root,m,o)){if(c.status==SA_INK_OK)c.fail(SA_INK_RANGE);return false;}
    }return false;
}
/* The supplied edge comes from an actual retained immutable source chunk.
 * index is the certificate index within that binding (flat only for cold export).
 * This entry permits changed-block consumers to avoid any flat-tree traversal. */
inline bool captured_edge(const Graph&g,const Edge&edge,uint32_t index,const BoundaryQuantizedVertex&a,const BoundaryQuantizedVertex&b,
                          const BoundaryQuantizationOptions&o,BoundaryQuantizationMetrics&m,BoundaryQuantizedEdge&output,
                          uint32_t topology_a=no_index,uint32_t topology_b=no_index){
    auto&c=*g.context();if(edge.source>=g.curves.size()){c.fail(SA_INK_INVALID);return false;}const auto&source=g.curves[edge.source];const auto&curve=source.geometry;
    if(source.origins.empty()||curve.controls.size()<2||curve.controls.size()>4||(edge.direction!=1&&edge.direction!=-1)||index>0x7ffffffeu){c.fail(SA_INK_RANGE);return false;}
    Root lo=edge.a,hi=edge.b;if(lo.context()!=&c||hi.context()!=&c){c.fail(SA_INK_INVALID);return false;}if(!root_domain(lo,m,o)||!root_domain(hi,m,o))return false;
    // Exact order only. Same algebraic roots do not become an artificial span.
    while(c.status==SA_INK_OK&&!(lo.upper<hi.lower)){
        if(hi.upper<=lo.lower){c.fail(SA_INK_RANGE);return false;}
        bool changed=false;if(!lo.exact()){if(!refine_owned(lo,m,o))return false;changed=true;}if(!hi.exact()){if(!refine_owned(hi,m,o))return false;changed=true;}
        if(!changed){c.fail(SA_INK_RANGE);return false;}
    }
    Q mx=Q::from_signed(c,0),my=mx;const Q degree((int)curve.controls.size()-1);
    for(uint32_t i=0;i+1<curve.controls.size()&&g.good();i++){mx=maximum(mx,(degree*(curve.controls[i+1].x-curve.controls[i].x)).absolute());my=maximum(my,(degree*(curve.controls[i+1].y-curve.controls[i].y)).absolute());}
    const Q ox=Q::from_double(c,o.origin[0]),oy=Q::from_double(c,o.origin[1]),allowed=Q::from_double(c,o.maximum_error_l1);
    while(g.good()){
        ++m.edge_attempts;const Q alpha=lo.midpoint(),beta=hi.midpoint();Curve exact=restricted(curve,alpha,beta);
        if(exact.controls.size()<2||exact.controls.size()>4){c.fail(SA_INK_RANGE);return false;}
        BoundaryQuantizedEdge staged{};const auto&origin=source.origins[0];if(origin.source>=g.blocks.size()){c.fail(SA_INK_RANGE);return false;}staged.source=g.blocks[origin.source].description.key;staged.command_index=origin.command;staged.source_flags=origin.flags;staged.edge=index;staged.curve=edge.source;staged.degree=exact.controls.size()-1;staged.vertex_a=topology_a==no_index?a.vertex:topology_a;staged.vertex_b=topology_b==no_index?b.vertex:topology_b;staged.curve_identity=source.identity;staged.direction=edge.direction;staged.certificate_a=index*2;staged.certificate_b=index*2+1;
        Q ex=Q::from_signed(c,0),ey=ex;
        for(uint32_t i=0;i<exact.controls.size()&&g.good();i++){
            const auto&p=exact.controls[i];double x=0,y=0;
            if(!i){x=a.position[0];y=a.position[1];}else if(i+1==exact.controls.size()){x=b.position[0];y=b.position[1];}
            else if(!nearest_lower_tie(p.x-ox,x)||!nearest_lower_tie(p.y-oy,y))return false;
            staged.controls[i*2]=x;staged.controls[i*2+1]=y;
            ex=maximum(ex,(Q::from_double(c,x)+ox-p.x).absolute());ey=maximum(ey,(Q::from_double(c,y)+oy-p.y).absolute());
        }
        const Q delta=maximum(lo.upper-lo.lower,hi.upper-hi.lower)/Q(2),parameter=(mx+my)*delta,control=ex+ey,error=parameter+control;
        if(error<=allowed){if(!upper_bound(error,staged.error_l1)||!upper_bound(parameter,staged.parameter_error_l1)||!upper_bound(control,staged.control_error_l1))return false;output=staged;return true;}
        bool changed=false;if(!lo.exact()){if(!refine_owned(lo,m,o))return false;changed=true;}if(!hi.exact()){if(!refine_owned(hi,m,o))return false;changed=true;}
        if(!changed){c.fail(SA_INK_RANGE);return false;}
    }return false;
}
inline bool edge(const Graph&g,uint32_t index,const BoundaryQuantizedVertex&a,const BoundaryQuantizedVertex&b,
                 const BoundaryQuantizationOptions&o,BoundaryQuantizationMetrics&m,BoundaryQuantizedEdge&output){
    if(index>=g.edges.size()){g.context()->fail(SA_INK_INVALID);return false;}
    return captured_edge(g,g.edges[index],index,a,b,o,m,output);
}
}
/* Full explicit lease export, NOT a tail/live interface. New vertices are
 * anchored once per graph and all incident endpoints reuse their exact bits.
 * An incremental consumer must retain verified anchors or replace every incident
 * block; it cannot silently re-anchor a vertex while retaining old geometry.
 * Output changes only after success; all original curves/root bounds are read.
 */
inline uint32_t quantize_boundary_graph(const Graph&g,const BoundaryQuantizationOptions&o,BoundaryQuantizedGraph&output){
    auto&c=*g.context();if(!g.good())return c.status;
    if(!finite_double(o.origin[0])||!finite_double(o.origin[1])||!finite_double(o.maximum_error_l1)||!(o.maximum_error_l1>0)||o.reserved||
       o.maximum_refinements>1000000||!o.maximum_vertices||!o.maximum_edges||output.vertices.context()!=&c||output.edges.context()!=&c)return SA_INK_INVALID;
    if(g.edges.size()>o.maximum_edges)return SA_INK_CAPACITY;
    const uint64_t poly_before=g.math->polynomial.operations,work_before=c.work;
    BoundaryQuantizedGraph staged(c);staged.options=o;Vector<uint32_t>indices(c);indices.resize(g.parent.size());for(uint32_t i=0;i<indices.size()&&g.good();i++)indices[i]=no_index;
    for(uint32_t i=0;i<g.edges.size()&&g.good();i++){
        const auto&e=g.edges[i];if(e.source>=g.curves.size()){c.fail(SA_INK_RANGE);break;}
        const uint32_t ids[2]={boundary_quantization::vertex_root(g,e.va),boundary_quantization::vertex_root(g,e.vb)};
        for(uint32_t endpoint=0;endpoint<2&&g.good();endpoint++){
            const uint32_t v=ids[endpoint];if(v==no_index)break;if(indices[v]!=no_index)continue;
            if(staged.vertices.size()>=o.maximum_vertices){c.fail(SA_INK_CAPACITY);break;}
            BoundaryQuantizedVertex vertex{};if(!boundary_quantization::anchor(g.curves[e.source].geometry,endpoint?e.b:e.a,v,i,endpoint,o,staged.metrics,vertex)){if(g.good())c.fail(SA_INK_RANGE);break;}
            indices[v]=staged.vertices.size();staged.vertices.push_back(vertex);
        }
        if(!g.good())break;
        const auto&vertices=static_cast<const Vector<BoundaryQuantizedVertex>&>(staged.vertices);
        BoundaryQuantizedEdge edge{};if(!boundary_quantization::edge(g,i,vertices[indices[ids[0]]],vertices[indices[ids[1]]],o,staged.metrics,edge)){if(g.good())c.fail(SA_INK_RANGE);break;}
        staged.edges.push_back(edge);
    }
    if(!g.good())return c.status;
    staged.metrics.polynomial_operations=g.math->polynomial.operations-poly_before;staged.metrics.limb_operations=c.work-work_before;staged.metrics.arena_peak_bytes=c.peak_bytes;
    output=static_cast<BoundaryQuantizedGraph&&>(staged);return SA_INK_OK;
}
}
#endif
