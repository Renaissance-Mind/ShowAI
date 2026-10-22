#ifndef SHOWAI_BOUNDARY_CONDITIONED_KLM_HPP
#define SHOWAI_BOUNDARY_CONDITIONED_KLM_HPP
#include "quantization.hpp"
#include "../include/analytic-path.h"
namespace showai_boundary {
/* Internal derived-geometry analysis, not a source format/public trust flag.
 * Uses the existing shared Loop--Blinn factory and audits its actual Float32
 * fields in exact Q. No RAY patch is accepted as continuous coverage. Closure
 * records are directed authoritative anchors, NOT antialiased triangle edges.
 * Outside support/closure-fringe construction and hardware interpolation error
 * remain obligations of a later coverage mesh producer; this record alone is
 * deliberately not a "pixel certified" or live-render authorization. */
enum BoundaryKLMReason:uint32_t { boundary_klm_none=0,boundary_klm_invalid=1,
    boundary_klm_ray=2,boundary_klm_singular_triangle=3,boundary_klm_zero_gradient=4,
    boundary_klm_error_budget=5,boundary_klm_capacity=6 };
struct BoundaryKLMOptions {
    double source_to_pixels[4]{1,0,0,1}; // actual linear map [a,b,c,d]
    double maximum_residual_over_gradient_pixels=0;
    uint32_t maximum_patches=0,maximum_vertices=0,maximum_depth=0,reserved=0;
    uint32_t maximum_conditioning_cells=0,maximum_conditioning_depth=0;
};
struct BoundaryKLMClosure {
    uint32_t from_vertex=0,to_vertex=0;double from[2]{},to[2]{};
    uint32_t source_edge=0,degree=0;uint64_t curve_identity=0;
};
struct BoundaryKLMAudit {
    uint32_t first_vertex=0,mode=0; // exactly one emitted triangle
    double residual_upper=0,gradient_lower_source=0,gradient_lower_pixels=0;
    double residual_over_gradient_pixels=0,source_quantization_pixels=0;
    // These are exact-real audits of the actual encoded Float32 interpolants.
    // This residual/gradient ratio is NOT a global Hausdorff/topology or
    // pixel-alpha bound. Raster interpolation/derivative instruction errors
    // and support/branch selection are NOT certified by this audit.
};
struct BoundaryKLMArc {
    BoundaryKLMClosure closure{};uint32_t conditioning_cells=0;
    Vector<SAAnalyticPatch>patches;Vector<SAAnalyticVertex>vertices;Vector<BoundaryKLMAudit>audits;
    explicit BoundaryKLMArc(Context&c):patches(c),vertices(c),audits(c){}
};
namespace boundary_conditioning {
inline Q absolute_max(const Q&a,const Q&b){return a.absolute()>b.absolute()?a.absolute():b.absolute();}
inline Q minimum_abs(Interval v){if(v.lower<=Q(0)&&v.upper>=Q(0))return Q(0);return v.lower.absolute()<v.upper.absolute()?v.lower.absolute():v.upper.absolute();}
inline Interval square(Interval v){Q a=v.lower*v.lower,b=v.upper*v.upper;return{v.lower<=Q(0)&&v.upper>=Q(0)?Q(0):(a<b?a:b),a>b?a:b};}
inline uint32_t choose(uint32_t n,uint32_t k){uint32_t z=1;for(uint32_t i=0;i<k;i++)z=z*(n-i)/(i+1);return z;}
inline Q bernstein_bound(const Polynomial&p){
    auto&c=*p.context();Q result=Q::from_signed(c,0);uint32_t n=p.degree()<0?0:uint32_t(p.degree());
    for(uint32_t i=0;i<=n&&p.valid();i++){Q v=Q::from_signed(c,0);for(uint32_t k=0;k<=i;k++)v+=p[int(k)]*Q(Integer::from(c,choose(i,k)),Integer::from(c,choose(n,k)));if(v.absolute()>result)result=v.absolute();}return result;
}
inline bool upward(const Q&q,double&v){return boundary_quantization::upper_bound(q,v);}
inline bool downward(const Q&q,double&v){double hi=0;if(!q.bounds(v,hi)||!finite_double(v))return false;return true;}
inline Q affine(const Q f[3],const Point&p){return f[0]*p.x+f[1]*p.y+f[2];}
struct Cell {Q values[3][3];uint32_t depth=0;};
inline Q gradient_lower(PolynomialContext&c,const Q f[3][3],const SAAnalyticVertex*v,uint32_t mode,const BoundaryKLMOptions&o,const Q&required,uint32_t&visited,BoundaryKLMReason&reason){
    Vector<Cell>pending(c.numbers);Cell first{};for(uint32_t i=0;i<3;i++){first.values[i][0]=Q::from_double(c.numbers,v[i].k);first.values[i][1]=Q::from_double(c.numbers,v[i].l);first.values[i][2]=Q::from_double(c.numbers,v[i].m);}pending.push_back(first);
    Q minimum=Q::from_signed(c.numbers,0);
    while(!pending.empty()&&c.numbers.status==SA_INK_OK){
        if(visited++>=o.maximum_conditioning_cells){reason=boundary_klm_capacity;return Q(0);}if(!c.step())return Q(0);
        Cell cell=pending.back();pending.pop_back();Interval range[3];for(uint32_t j=0;j<3;j++){Q lo=cell.values[0][j],hi=lo;for(uint32_t i=1;i<3;i++){if(cell.values[i][j]<lo)lo=cell.values[i][j];if(cell.values[i][j]>hi)hi=cell.values[i][j];}range[j]={lo,hi};}
        Q lower=Q::from_signed(c.numbers,0),upper=lower;
        for(uint32_t axis=0;axis<2;axis++){
            Interval g;if(mode==SA_ANALYTIC_QUADRATIC)g=add(multiply(range[0],{Q(2)*f[0][axis],Q(2)*f[0][axis]}),{-f[1][axis],-f[1][axis]});
            else g=add(add(multiply(square(range[0]),{Q(3)*f[0][axis],Q(3)*f[0][axis]}),negate(multiply(range[2],{f[1][axis],f[1][axis]}))),negate(multiply(range[1],{f[2][axis],f[2][axis]})));
            Q component=minimum_abs(g);if(component>lower)lower=component;upper+=absolute_max(g.lower,g.upper);
        }
        Interval field=mode==SA_ANALYTIC_QUADRATIC?add(square(range[0]),negate(range[1])):add({range[0].lower*range[0].lower*range[0].lower,range[0].upper*range[0].upper*range[0].upper},negate(multiply(range[1],range[2])));
        // A zero derivative away from the zero set is valid: F/|grad F|
        // is infinite and the ramp saturates. Certify saturation instead of
        // demanding a global gradient lower bound in constant-coverage areas.
        if((field.lower>Q(0)&&field.lower>=upper/Q(2))||(field.upper<Q(0)&&-field.upper>=upper/Q(2)))continue;
        if(lower>Q(0)&&lower>=required){if(minimum.zero()||lower<minimum)minimum=lower;continue;}
        if(cell.depth>=o.maximum_conditioning_depth){reason=lower>Q(0)?boundary_klm_error_budget:boundary_klm_zero_gradient;return Q(0);}
        Q middle[3][3];for(uint32_t i=0;i<3;i++)for(uint32_t j=0;j<3;j++)middle[i][j]=(cell.values[i][j]+cell.values[(i+1)%3][j])/Q(2);
        for(uint32_t i=0;i<4;i++){Cell child{};child.depth=cell.depth+1;for(uint32_t j=0;j<3;j++){if(i<3){child.values[0][j]=cell.values[i][j];child.values[1][j]=middle[i][j];child.values[2][j]=middle[(i+2)%3][j];}else for(uint32_t k=0;k<3;k++)child.values[k][j]=middle[k][j];}pending.push_back(child);}
    }
    return minimum;
}
inline bool audit(PolynomialContext&c,const BoundaryQuantizedEdge&e,const SAAnalyticPatch&p,
                  const SAAnalyticVertex*v,uint32_t first,const BoundaryKLMOptions&o,uint32_t&cells,BoundaryKLMAudit&result,BoundaryKLMReason&reason){
    auto&ctx=c.numbers;Q x[3],y[3],f[3][3];
    for(uint32_t i=0;i<3;i++){x[i]=Q::from_double(ctx,v[i].x);y[i]=Q::from_double(ctx,v[i].y);}
    Q dx1=x[1]-x[0],dx2=x[2]-x[0],dy1=y[1]-y[0],dy2=y[2]-y[0],det=dx1*dy2-dx2*dy1;
    if(det.zero()){reason=boundary_klm_singular_triangle;return false;}
    for(uint32_t j=0;j<3;j++){
        auto value=[&](uint32_t i){return Q::from_double(ctx,j==0?v[i].k:j==1?v[i].l:v[i].m);};
        Q a=value(0),b=value(1)-a,d=value(2)-a;
        f[j][0]=(b*dy2-d*dy1)/det;f[j][1]=(dx1*d-dx2*b)/det;f[j][2]=a-f[j][0]*x[0]-f[j][1]*y[0];
    }
    Point controls[4];Q ox=Q::from_double(ctx,p.origin[0]),oy=Q::from_double(ctx,p.origin[1]);
    for(uint32_t i=0;i<=e.degree;i++)controls[i]={Q::from_double(ctx,e.controls[2*i])-ox,Q::from_double(ctx,e.controls[2*i+1])-oy};
    Curve curve=from_controls(c,controls,e.degree+1);Polynomial fields[3]={Polynomial(c),Polynomial(c),Polynomial(c)};
    for(uint32_t j=0;j<3;j++)fields[j]=scale(curve.x,f[j][0])+scale(curve.y,f[j][1])+Polynomial(c,f[j][2]);
    Polynomial implicit= p.mode==SA_ANALYTIC_QUADRATIC?fields[0]*fields[0]-fields[1]:fields[0]*fields[0]*fields[0]-fields[1]*fields[2];
    Q residual=bernstein_bound(implicit);
    Q a=Q::from_double(ctx,o.source_to_pixels[0]).absolute()+Q::from_double(ctx,o.source_to_pixels[1]).absolute();
    Q b=Q::from_double(ctx,o.source_to_pixels[2]).absolute()+Q::from_double(ctx,o.source_to_pixels[3]).absolute();Q metric=a>b?a:b;
    // ||g_source||inf <= ||A^T||inf * ||g_pixel||inf. The actual
    // smallest Euclidean gradient is at least this certified component bound.
    Q source_error=Q::from_double(ctx,e.error_l1)*metric,remaining=Q::from_double(ctx,o.maximum_residual_over_gradient_pixels)-source_error;
    if(remaining<=Q(0)&&residual>Q(0)){reason=boundary_klm_error_budget;return false;}
    Q required=residual.zero()?Q::from_signed(ctx,0):residual*metric/remaining;
    Q lower=gradient_lower(c,f,v,p.mode,o,required,cells,reason);if(ctx.status!=SA_INK_OK)return false;if(lower.zero()){if(reason==boundary_klm_none)reason=boundary_klm_zero_gradient;return false;}
    Q pixels=residual*metric/lower;
    if(pixels+source_error>Q::from_double(ctx,o.maximum_residual_over_gradient_pixels)){reason=boundary_klm_error_budget;return false;}
    BoundaryKLMAudit staged{};staged.first_vertex=first;staged.mode=p.mode;
    if(!upward(residual,staged.residual_upper)||!downward(lower,staged.gradient_lower_source)||!downward(lower/metric,staged.gradient_lower_pixels)||!upward(pixels,staged.residual_over_gradient_pixels)||!upward(source_error,staged.source_quantization_pixels))return false;
    if(staged.gradient_lower_source<=0||staged.gradient_lower_pixels<=0){reason=boundary_klm_zero_gradient;return false;}
    result=staged;return ctx.status==SA_INK_OK;
}
}
/* One actual parameter-ordered quantized arc. The source key/certificates and
 * endpoint anchor values remain unchanged. direction is applied only to the
 * closure; candidate path follows parameter order and carries that direction
 * into patch winding. No guessed edge adjacency or loop walk is performed.
 * Atomic output on any analysis/budget failure. Reason is diagnostic only.
 */
inline uint32_t condition_quantized_boundary_arc(PolynomialContext&c,const BoundaryQuantizedEdge&e,
        const BoundaryKLMOptions&o,BoundaryKLMArc&output,BoundaryKLMReason&reason){
    reason=boundary_klm_none;auto&ctx=c.numbers;if(ctx.status!=SA_INK_OK)return ctx.status;
    if(e.degree<1||e.degree>3||(e.direction!=1&&e.direction!=-1)||!finite_double(e.error_l1)||e.error_l1<0||
       o.reserved||!o.maximum_patches||!o.maximum_vertices||!o.maximum_depth||o.maximum_patches>100000||o.maximum_vertices>1000000||o.maximum_depth>32||!o.maximum_conditioning_cells||o.maximum_conditioning_cells>1000000||o.maximum_conditioning_depth>24||
       !finite_double(o.maximum_residual_over_gradient_pixels)||!(o.maximum_residual_over_gradient_pixels>0)||output.patches.context()!=&ctx||output.vertices.context()!=&ctx||output.audits.context()!=&ctx){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    for(uint32_t i=0;i<4;i++)if(!finite_double(o.source_to_pixels[i])){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    Q determinant=Q::from_double(ctx,o.source_to_pixels[0])*Q::from_double(ctx,o.source_to_pixels[3])-Q::from_double(ctx,o.source_to_pixels[1])*Q::from_double(ctx,o.source_to_pixels[2]);
    if(determinant.zero()){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    Q metric0=Q::from_double(ctx,o.source_to_pixels[0]).absolute()+Q::from_double(ctx,o.source_to_pixels[1]).absolute(),metric1=Q::from_double(ctx,o.source_to_pixels[2]).absolute()+Q::from_double(ctx,o.source_to_pixels[3]).absolute();
    if(Q::from_double(ctx,e.error_l1)*(metric0>metric1?metric0:metric1)>Q::from_double(ctx,o.maximum_residual_over_gradient_pixels)){reason=boundary_klm_error_budget;return SA_INK_RANGE;}
    for(uint32_t i=0;i<2*(e.degree+1);i++)if(!finite_double(e.controls[i])){reason=boundary_klm_invalid;return SA_INK_INVALID;}
    SAInkPathCommand commands[3]{};commands[0].operation=0;commands[0].values[0]=e.controls[0];commands[0].values[1]=e.controls[1];
    commands[1].operation=e.degree==1?1:e.degree==2?2:3;
    for(uint32_t i=0;i<e.degree*2;i++)commands[1].values[i]=e.controls[i+2];commands[2].operation=4;
    const double identity[6]={1,0,0,1,0,0};SAAnalyticBudget budget{3,o.maximum_patches,o.maximum_depth,0};SAAnalyticCounts counts{};
    auto status=sa_analytic_path_counts(commands,3,identity,&budget,&counts);if(status)return status;
    if(counts.ray_patches){reason=boundary_klm_ray;return SA_INK_RANGE;}
    if(counts.vertices>o.maximum_vertices){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}
    BoundaryKLMArc staged(ctx);staged.patches.resize(counts.patches);staged.vertices.resize(counts.vertices);if(ctx.status!=SA_INK_OK)return ctx.status;
    status=sa_analytic_path_build(commands,3,identity,&budget,counts.patches?&staged.patches[0]:nullptr,counts.patches,counts.vertices?&staged.vertices[0]:nullptr,counts.vertices,&counts);if(status)return status;
    staged.closure.source_edge=e.edge;staged.closure.degree=e.degree;staged.closure.curve_identity=e.curve_identity;
    uint32_t from=e.direction>0?0:e.degree,to=e.direction>0?e.degree:0;staged.closure.from_vertex=e.direction>0?e.vertex_a:e.vertex_b;staged.closure.to_vertex=e.direction>0?e.vertex_b:e.vertex_a;
    for(uint32_t axis=0;axis<2;axis++){staged.closure.from[axis]=e.controls[2*from+axis];staged.closure.to[axis]=e.controls[2*to+axis];}
    for(uint32_t patch_index=0;patch_index<staged.patches.size();patch_index++){
        auto&patch=staged.patches[patch_index];
        patch.winding*=e.direction;
        if(patch.mode==SA_ANALYTIC_SOLID)continue;
        if(patch.mode!=SA_ANALYTIC_QUADRATIC&&patch.mode!=SA_ANALYTIC_CUBIC){reason=boundary_klm_ray;return SA_INK_RANGE;}
        for(uint32_t i=0;i<patch.vertex_count;i+=3){BoundaryKLMAudit audit{};if(!boundary_conditioning::audit(c,e,patch,static_cast<const Vector<SAAnalyticVertex>&>(staged.vertices).begin()+patch.first_vertex+i,patch.first_vertex+i,o,staged.conditioning_cells,audit,reason))return ctx.status!=SA_INK_OK?ctx.status:reason==boundary_klm_capacity?SA_INK_CAPACITY:SA_INK_RANGE;staged.audits.push_back(audit);}
    }
    if(ctx.status!=SA_INK_OK)return ctx.status;output=static_cast<BoundaryKLMArc&&>(staged);return SA_INK_OK;
}
}
#endif
