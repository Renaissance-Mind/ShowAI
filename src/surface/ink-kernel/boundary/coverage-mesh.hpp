#ifndef SHOWAI_BOUNDARY_COVERAGE_MESH_HPP
#define SHOWAI_BOUNDARY_COVERAGE_MESH_HPP
#include "conditioned-klm.hpp"
namespace showai_boundary {
/* Internal full/cold mesh producer. Actual retained source/anchor capabilities
 * must be checked by the owner adapter; a vertex ID is never that capability.
 * Common-anchor fans are hard raster support, as in the measured vendor route.
 * This is not an exact pixel-area or hardware interpolation certificate. */
enum BoundaryCoverageKind:uint32_t {boundary_coverage_solid=0,boundary_coverage_embedded_quad=1,boundary_coverage_cubic=2};
struct alignas(16) BoundaryCoverageVertex {float x=0,y=0,pad0=0,pad1=0,k=0,l=0,m=0,pad2=0;};
static_assert(sizeof(BoundaryCoverageVertex)==32&&__builtin_offsetof(BoundaryCoverageVertex,k)==16,"coverage vertex ABI");
struct BoundaryCoverageDraw {
    double origin[2]{};uint32_t first=0,count=0,source_edge=0,kind=0;
    double float_cast_error_pixels=0;
};
struct BoundaryCoverageOptions {
    BoundaryKLMOptions conditioning{};uint32_t maximum_vertices=0,maximum_draws=0,maximum_edges=0,maximum_anchors=0;
};
struct BoundaryCoverageMesh {
    double common_origin[2]{};Vector<BoundaryCoverageVertex>vertices;Vector<BoundaryCoverageDraw>draws;
    uint32_t conditioned_cells=0,source_edges=0;uint64_t vertex_bytes=0;
    explicit BoundaryCoverageMesh(Context&c):vertices(c),draws(c){}
};
namespace boundary_coverage {
inline bool same_bits(double a,double b){uint64_t x,y;copy_bytes(&x,&a,8);copy_bytes(&y,&b,8);return x==y;}
inline Q cross(PolynomialContext&c,const BoundaryCoverageVertex&a,const BoundaryCoverageVertex&b,const BoundaryCoverageVertex&d){
    Q ax=Q::from_double(c.numbers,a.x),ay=Q::from_double(c.numbers,a.y);
    return (Q::from_double(c.numbers,b.x)-ax)*(Q::from_double(c.numbers,d.y)-ay)-(Q::from_double(c.numbers,b.y)-ay)*(Q::from_double(c.numbers,d.x)-ax);
}
inline double half_ulp(float x){uint32_t bits;copy_bytes(&bits,&x,4);uint32_t exponent=(bits>>23)&255;int power=exponent?int(exponent)-127-24:-150;uint64_t result=uint64_t(power+1023)<<52;double d;copy_bytes(&d,&result,8);return d;}
inline bool emit(PolynomialContext&c,BoundaryCoverageMesh&mesh,BoundaryCoverageVertex v[3],int winding,
                 double origin_x,double origin_y,uint32_t edge,uint32_t kind,const BoundaryCoverageOptions&o,BoundaryKLMReason&reason){
    if(mesh.vertices.size()>o.maximum_vertices-3||mesh.draws.size()>=o.maximum_draws){reason=boundary_klm_capacity;return false;}
    Q determinant=cross(c,v[0],v[1],v[2]);if(c.numbers.status!=SA_INK_OK)return false;
    if(determinant.zero()){reason=boundary_klm_singular_triangle;return false;}
    if(determinant.sign()!=winding){auto tmp=v[1];v[1]=v[2];v[2]=tmp;}
    BoundaryCoverageDraw draw{};draw.origin[0]=origin_x;draw.origin[1]=origin_y;draw.first=mesh.vertices.size();draw.count=3;draw.source_edge=edge;draw.kind=kind;
    Q max_error=Q::from_signed(c.numbers,0);const auto&m=o.conditioning.source_to_pixels;
    Q norm0=Q::from_double(c.numbers,m[0]).absolute()+Q::from_double(c.numbers,m[1]).absolute(),norm1=Q::from_double(c.numbers,m[2]).absolute()+Q::from_double(c.numbers,m[3]).absolute(),norm=norm0>norm1?norm0:norm1;
    for(uint32_t i=0;i<3;i++){
        if(!finite_double(v[i].x)||!finite_double(v[i].y)||!finite_double(v[i].k)||!finite_double(v[i].l)||!finite_double(v[i].m)){reason=boundary_klm_invalid;return false;}
        Q cast=(Q::from_double(c.numbers,half_ulp(v[i].x))+Q::from_double(c.numbers,half_ulp(v[i].y)))*norm;if(cast>max_error)max_error=cast;
    }
    if(max_error>Q::from_double(c.numbers,o.conditioning.maximum_residual_over_gradient_pixels)){reason=boundary_klm_error_budget;return false;}
    if(!boundary_quantization::upper_bound(max_error,draw.float_cast_error_pixels)){reason=boundary_klm_error_budget;return false;}
    // This is only the encoded position's rounding-cell bound, not the whole
    // source-to-pixel or interpolation error. Actual graph admission charges
    // vertices/draw uniforms plus cached and in-flight generations separately.
    for(uint32_t i=0;i<3;i++)mesh.vertices.push_back(v[i]);mesh.draws.push_back(draw);return c.numbers.status==SA_INK_OK;
}
struct AnchorSlot {uint32_t vertex=no_index,index=0;int32_t flow=0;};
inline uint32_t find(const Vector<AnchorSlot>&slots,uint32_t vertex){uint32_t mask=slots.size()-1,index=(vertex*2654435761u)&mask;for(uint32_t n=0;n<slots.size();n++,index=(index+1)&mask){if(slots[index].vertex==vertex||slots[index].vertex==no_index)return index;}return no_index;}
}
/* Always recomputes actual full input work; no K=N work is advertised as a
 * suffix update. The incremental owner can later invoke a block producer using
 * actual retained anchor Records. All accepted outputs are immutable by owner
 * policy, and failures leave the old output entirely intact. */
inline uint32_t build_boundary_coverage_mesh(PolynomialContext&c,const BoundaryQuantizedGraph&q,
        const BoundaryCoverageOptions&o,BoundaryCoverageMesh&output,BoundaryKLMReason&reason){
    auto&ctx=c.numbers;reason=boundary_klm_none;
    if(ctx.status!=SA_INK_OK)return ctx.status;
    if(q.version!=boundary_quantization_version||!o.maximum_edges||o.maximum_edges>1000000||!o.maximum_anchors||o.maximum_anchors>1000000||o.maximum_vertices<3||o.maximum_vertices>1000000||!o.maximum_draws||o.maximum_draws>333333||q.edges.size()>o.maximum_edges||q.vertices.size()>o.maximum_anchors||q.vertices.size()>1000000||
       q.edges.context()!=&ctx||q.vertices.context()!=&ctx||output.vertices.context()!=&ctx||output.draws.context()!=&ctx||!finite_double(q.options.origin[0])||!finite_double(q.options.origin[1])){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    const auto&co=o.conditioning;
    if(!co.maximum_conditioning_cells||co.maximum_conditioning_cells>1000000||co.maximum_conditioning_depth>24||!co.maximum_patches||co.maximum_patches>100000||!co.maximum_vertices||co.maximum_vertices>1000000||!co.maximum_depth||co.maximum_depth>32||co.reserved||!finite_double(co.maximum_residual_over_gradient_pixels)||!(co.maximum_residual_over_gradient_pixels>0)){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    for(uint32_t i=0;i<4;i++)if(!finite_double(co.source_to_pixels[i])){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    Q determinant=Q::from_double(ctx,co.source_to_pixels[0])*Q::from_double(ctx,co.source_to_pixels[3])-Q::from_double(ctx,co.source_to_pixels[1])*Q::from_double(ctx,co.source_to_pixels[2]);if(determinant.zero()){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    BoundaryCoverageMesh staged(ctx);staged.common_origin[0]=q.options.origin[0];staged.common_origin[1]=q.options.origin[1];
    uint32_t table_count=2;while(table_count<q.vertices.size()*2){if(table_count>0x100000){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}table_count*=2;}
    Vector<boundary_coverage::AnchorSlot>anchors(ctx);anchors.resize(table_count);
    for(uint32_t i=0;i<q.vertices.size()&&ctx.step();i++){
        const auto&v=q.vertices[i];if(v.vertex==no_index||!finite_double(v.position[0])||!finite_double(v.position[1])){reason=boundary_klm_invalid;return SA_INK_INVALID;}
        uint32_t slot=boundary_coverage::find(anchors,v.vertex);if(slot==no_index||static_cast<const Vector<boundary_coverage::AnchorSlot>&>(anchors)[slot].vertex!=no_index){reason=boundary_klm_invalid;return SA_INK_INVALID;}anchors[slot]={v.vertex,i,0};
    }
    for(const auto&e:q.edges){
        if(!ctx.step())return ctx.status;
        if(e.degree<1||e.degree>3||(e.direction!=1&&e.direction!=-1)){reason=boundary_klm_invalid;return SA_INK_INVALID;}
        uint32_t ai=boundary_coverage::find(anchors,e.vertex_a),bi=boundary_coverage::find(anchors,e.vertex_b);
        if(ai==no_index||bi==no_index||static_cast<const Vector<boundary_coverage::AnchorSlot>&>(anchors)[ai].vertex!=e.vertex_a||static_cast<const Vector<boundary_coverage::AnchorSlot>&>(anchors)[bi].vertex!=e.vertex_b){reason=boundary_klm_invalid;return SA_INK_INVALID;}
        const auto&a=q.vertices[static_cast<const Vector<boundary_coverage::AnchorSlot>&>(anchors)[ai].index];const auto&b=q.vertices[static_cast<const Vector<boundary_coverage::AnchorSlot>&>(anchors)[bi].index];
        for(uint32_t axis=0;axis<2;axis++)if(!boundary_coverage::same_bits(a.position[axis],e.controls[axis])||!boundary_coverage::same_bits(b.position[axis],e.controls[e.degree*2+axis])){reason=boundary_klm_invalid;return SA_INK_INVALID;}
        if(anchors[ai].flow==0x7fffffff||anchors[bi].flow==(-0x7fffffff-1)){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}anchors[ai].flow+=e.direction;anchors[bi].flow-=e.direction;
    }
    for(const auto&slot:anchors)if(slot.vertex!=no_index&&slot.flow){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    for(const auto&e:q.edges){
        BoundaryKLMOptions local=o.conditioning;
        if(staged.conditioned_cells>=local.maximum_conditioning_cells){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}local.maximum_conditioning_cells-=staged.conditioned_cells;
        uint32_t remaining=o.maximum_vertices-staged.vertices.size();if(remaining<3){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}if(local.maximum_vertices>remaining)local.maximum_vertices=remaining;
        BoundaryKLMArc arc(ctx);uint32_t status=condition_quantized_boundary_arc(c,e,local,arc,reason);if(status)return status;staged.conditioned_cells+=arc.conditioning_cells;
        // Boundary source graph is a balanced directed chain. Summing these
        // directed triangles closes every arc to ONE common source-local anchor;
        // radial edges cancel without guessing a loop walk at branch vertices.
        const auto&z=arc.closure;Q area=Q::from_double(ctx,z.from[0])*Q::from_double(ctx,z.to[1])-Q::from_double(ctx,z.from[1])*Q::from_double(ctx,z.to[0]);
        if(!area.zero()){
            BoundaryCoverageVertex fan[3]{};fan[1].x=float(z.from[0]);fan[1].y=float(z.from[1]);fan[2].x=float(z.to[0]);fan[2].y=float(z.to[1]);for(auto&v:fan){v.k=0;v.l=v.m=1;}
            if(!boundary_coverage::emit(c,staged,fan,area.sign(),0,0,e.edge,boundary_coverage_solid,o,reason))return ctx.status?ctx.status:reason==boundary_klm_capacity?SA_INK_CAPACITY:SA_INK_RANGE;
        }
        for(const auto&patch:arc.patches){
            if(patch.mode==SA_ANALYTIC_RAY){reason=boundary_klm_ray;return SA_INK_RANGE;}
            for(uint32_t i=0;i<patch.vertex_count;i+=3){BoundaryCoverageVertex tri[3]{};uint32_t quad_values=0;
                for(uint32_t j=0;j<3;j++){
                    const auto&v=arc.vertices[patch.first_vertex+i+j];auto&out=tri[j];out.x=v.x;out.y=v.y;
                    if(patch.mode==SA_ANALYTIC_SOLID){out.k=0;out.l=out.m=1;}
                    else if(patch.mode==SA_ANALYTIC_QUADRATIC){
                        if(patch.sign!=-1||!((v.k==0&&v.l==0)||(v.k==0.5f&&v.l==0)||(v.k==1&&v.l==1))){reason=boundary_klm_invalid;return SA_INK_INVALID;}
                        // M==K exactly. K/L are affine-independent and K is
                        // nonnegative, zero at only the canonical start vertex.
                        // F=K*(K*K-L); the single critical endpoint uses the
                        // explicit finite-zero shader semantics, not epsilon.
                        quad_values|=v.k==0?1u:v.k==0.5f?2u:4u;out.k=out.m=v.k;out.l=v.l;
                    }else if(patch.mode==SA_ANALYTIC_CUBIC){float sign=-patch.sign;out.k=v.k*sign;out.l=v.l*sign;out.m=v.m;}
                    else {reason=boundary_klm_invalid;return SA_INK_INVALID;}
                }
                if(patch.mode==SA_ANALYTIC_QUADRATIC&&quad_values!=7){reason=boundary_klm_invalid;return SA_INK_INVALID;}
                uint32_t kind=patch.mode==SA_ANALYTIC_SOLID?boundary_coverage_solid:patch.mode==SA_ANALYTIC_QUADRATIC?boundary_coverage_embedded_quad:boundary_coverage_cubic;
                if(!boundary_coverage::emit(c,staged,tri,patch.winding,patch.origin[0],patch.origin[1],e.edge,kind,o,reason))return ctx.status?ctx.status:reason==boundary_klm_capacity?SA_INK_CAPACITY:SA_INK_RANGE;
            }
        }
        ++staged.source_edges;
    }
    if(ctx.status!=SA_INK_OK)return ctx.status;staged.vertex_bytes=uint64_t(staged.vertices.size())*sizeof(BoundaryCoverageVertex);output=static_cast<BoundaryCoverageMesh&&>(staged);return SA_INK_OK;
}
}
#endif
