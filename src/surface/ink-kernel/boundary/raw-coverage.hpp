#ifndef SHOWAI_RAW_COVERAGE_HPP
#define SHOWAI_RAW_COVERAGE_HPP
#include "coverage-mesh.hpp"
#include "../analytic-path-checked.hpp"
namespace showai_boundary {
/* Factory-local const input/options/count binding. No source or caller count
 * can be supplied to emit, and this borrow never leaves the synchronous raw
 * factory. It adds no source copy or persistent arena/GPU lifetime. */
class RawAnalyticCapture final {
    const showai_analytic_internal::CheckedEmissionPlan plan_;
public:
    RawAnalyticCapture(const SAInkPathCommand *c, uint32_t n, const double *m,
                       const SAAnalyticBudget *b) : plan_(c, n, m, b) {}
    SAInkStatus status() const { return plan_.status_; }
    const SAAnalyticCounts &counts() const { return plan_.required_; }
    SAInkStatus emit(SAAnalyticPatch *p, uint32_t pc, SAAnalyticVertex *v,
                     uint32_t vc, SAAnalyticCounts *out) const {
        return plan_.emit(p, pc, v, vc, out);
    }
};
/* Original closed-path derivative, not a new source format or a caller proof.
 * Root's private C adapter must capture actual immutable commands. Generation
 * below is an echo, never an authority. Matrices use [a,b,c,d], x'=ax+cy.
 * The envelope certifies geometric regularization and Float32 position error.
 * Regular KLM follows the shared analytic factory and the observed vendor ramp;
 * it is NOT a residual/gradient, pixel-alpha or GPU interpolation certificate. */
struct RawCoverageOptions {
    double maximum_forward_norm=0; // ||A||1 = max(|a|+|b|,|c|+|d|)
    double maximum_inverse_norm=0; // ||A^-1||inf, bounds A^-T in L1
    double maximum_geometry_error_pixels=0;
    uint32_t maximum_commands=0,maximum_patches=0,maximum_vertices=0,maximum_draws=0;
    uint32_t maximum_analytic_depth=0,reserved=0;
};
struct RawCoverageCertificate {
    double maximum_forward_norm=0,maximum_inverse_norm=0;
    double maximum_geometry_error_pixels=0;
    double actual_position_error_source=0,actual_regularization_error_source=0;
    double maximum_field_value=0,maximum_field_derivative_source=0;
    uint64_t absolute_contribution_bound=0; // actual emitted triangle count, NOT winding
    uint32_t regularized_rays=0,degenerate_triangles=0;
};
struct RawCoverageMesh {
    BoundaryCoverageMesh mesh; RawCoverageCertificate certificate{};
    uint64_t source_generation=0;
    uint32_t regularized_curves=0; // regular analytic intervals proved flat, never labelled RAY
    uint32_t regularization_segments=0; // bounded exact source-restricted chord leaves
    double source_control_bounds[4]{}; // conservative minX,minY,maxX,maxY; not AA support
    explicit RawCoverageMesh(Context&c):mesh(c){}
};
/* Cheap matrix validation. Translation is deliberately absent. No Q/rebuild on
 * ordinary camera changes within the admitted object/pixelDensity envelope. */
inline bool raw_coverage_supports(const RawCoverageCertificate&,const double source_to_pixels[4]);
/* Atomic on error. No exact global Boolean graph, no original source mutation,
 * and no binary-RAY vertices are ever emitted. */
inline uint32_t build_raw_coverage_mesh(PolynomialContext&,const SAInkPathCommand*,uint32_t,
    uint64_t source_generation,const RawCoverageOptions&,RawCoverageMesh&,BoundaryKLMReason&);
namespace raw_coverage {
inline double abs(double x){return x<0?-x:x;}
inline double max(double a,double b){return a>b?a:b;}
inline double up(double x){if(!finite_double(x)||x<0)return x;uint64_t b;copy_bytes(&b,&x,8);if((b&0x7fffffffffffffffull)==0)b=0;++b;copy_bytes(&x,&b,8);return x;}
inline double sum(double a,double b){return up(a+b);}
inline double mul(double a,double b){return up(a*b);}
inline double half_ulp_double(double x){uint64_t b;copy_bytes(&b,&x,8);uint32_t e=uint32_t((b>>52)&2047);if(e<=53){uint64_t z=1;double d;copy_bytes(&d,&z,8);return d;}uint64_t z=uint64_t(e-53)<<52;double d;copy_bytes(&d,&z,8);return d;}
inline double difference_error(double actual,double origin,float encoded){double local=actual-origin;return sum(abs(double(encoded)-local),half_ulp_double(local));}
struct Command {double start[2]{},origin[2]{};};
inline bool matrix_norms(const double*m,double&forward,double&inverse){
 for(uint32_t i=0;i<4;i++)if(!finite_double(m[i]))return false;
 forward=max(sum(abs(m[0]),abs(m[1])),sum(abs(m[2]),abs(m[3])));
 double scale=max(max(abs(m[0]),abs(m[1])),max(abs(m[2]),abs(m[3])));if(!(scale>0))return false;
 // Outward interval for the scaled determinant. The scale division error is
 // included before subtraction; an uncertain singular map is rejected.
 double a=m[0]/scale,b=m[1]/scale,c=m[2]/scale,d=m[3]/scale;
 double det=a*d-b*c,err=mul(32*0x1p-52,sum(abs(a*d),abs(b*c)));
 double lower=abs(det)-err;if(!(lower>0)||!finite_double(lower))return false;
 inverse=up(max(sum(abs(d),abs(c)),sum(abs(b),abs(a)))/lower/scale);
 return finite_double(forward)&&finite_double(inverse);
}
/* Recover the factory's four-control convex hull before Float32 packing.
 * Matching rounded positions is insufficient: two distinct endpoint controls
 * can encode to the same Float32 pair. Use the actual numerical hull order,
 * and verify it against the factory output rather than guessing an anchor. */
inline uint32_t hull(const double*p,uint32_t*out){
 uint32_t sorted[4]={0,1,2,3};auto same=[&](uint32_t a,uint32_t b){return p[2*a]==p[2*b]&&p[2*a+1]==p[2*b+1];};
 auto turn=[&](uint32_t a,uint32_t b,uint32_t d){double x=p[2*b]-p[2*a],y=p[2*b+1]-p[2*a+1],z=p[2*d]-p[2*a],w=p[2*d+1]-p[2*a+1],scale=max(max(abs(x),abs(y)),max(abs(z),abs(w)));return scale?(x/scale)*(w/scale)-(y/scale)*(z/scale):0;};
 for(uint32_t i=1;i<4;i++){uint32_t v=sorted[i],j=i;while(j&&(p[2*v]<p[2*sorted[j-1]]||(p[2*v]==p[2*sorted[j-1]]&&p[2*v+1]<p[2*sorted[j-1]+1]))){sorted[j]=sorted[j-1];--j;}sorted[j]=v;}
 uint32_t h[8],n=0;for(uint32_t i=0;i<4;i++){if(i&&same(sorted[i],sorted[i-1]))continue;while(n>=2&&turn(h[n-2],h[n-1],sorted[i])<=0)--n;h[n++]=sorted[i];}uint32_t lower=n;
 for(int i=2;i>=0;i--){if(same(sorted[i],sorted[i+1]))continue;while(n>lower&&turn(h[n-2],h[n-1],sorted[i])<=0)--n;h[n++]=sorted[i];}if(n>1)--n;if(n>4)return 0;for(uint32_t i=0;i<n;i++)out[i]=h[i];return n;
}
inline bool field_range(const BoundaryCoverageVertex*v,const RawCoverageOptions&o,RawCoverageCertificate&cert){
 double dx1=double(v[1].x)-v[0].x,dy1=double(v[1].y)-v[0].y,dx2=double(v[2].x)-v[0].x,dy2=double(v[2].y)-v[0].y;
 double det=dx1*dy2-dx2*dy1;
 double error=mul(16*0x1p-52,sum(abs(dx1*dy2),abs(dx2*dy1)));
 double lower=abs(det)-error;if(!(lower>0))return false;
 double maximum=0,derivative=0,values[3]{},pixelDerivatives[3]{};
 for(uint32_t j=0;j<3;j++){
  double z[3],maximumJ=0;for(uint32_t i=0;i<3;i++){z[i]=j==0?v[i].k:j==1?v[i].l:v[i].m;maximumJ=max(maximumJ,abs(z[i]));}
  double f1=abs(z[1]-z[0]),f2=abs(z[2]-z[0]);
  double x=up(sum(mul(f1,abs(dy2)),mul(f2,abs(dy1)))/lower),y=up(sum(mul(f1,abs(dx2)),mul(f2,abs(dx1)))/lower);
  double sourceDerivative=sum(x,y);maximum=max(maximum,maximumJ);derivative=max(derivative,sourceDerivative);
  pixelDerivatives[j]=mul(sourceDerivative,o.maximum_inverse_norm);
  // Default center interpolation may lie outside a skinny MSAA-covered
  // triangle. Each functional needs its own extended helper bound; mixing
  // maxima across unrelated K/L/M can spuriously exceed Float32 range.
  values[j]=sum(maximumJ,mul(2,pixelDerivatives[j]));
 }
 cert.maximum_field_value=max(cert.maximum_field_value,maximum);cert.maximum_field_derivative_source=max(cert.maximum_field_derivative_source,derivative);
 double field=sum(mul(mul(values[0],values[0]),values[0]),mul(values[1],values[2]));
 double gradient=sum(mul(mul(3,mul(values[0],values[0])),pixelDerivatives[0]),
                     sum(mul(values[2],pixelDerivatives[1]),mul(values[1],pixelDerivatives[2])));
 // Explicit Float32 exponent headroom, not a denominator epsilon or an AA
 // accuracy promise. Zero gradients follow the witnessed finite shader branch.
 return finite_double(values[0])&&finite_double(values[1])&&finite_double(values[2])&&
        values[0]<0x1p120&&values[1]<0x1p120&&values[2]<0x1p120&&
        finite_double(field)&&finite_double(gradient)&&field<0x1p120&&mul(2,mul(gradient,gradient))<0x1p120;
}
/* The cubic implicit is homogeneous with weights (2,3,3):
 * (s^2 K)^3-(s^3 L)(s^3 M)=s^6 F. Its screen gradient has the
 * same positive factor, so the observed ramp F/length(gradient) is unchanged.
 * Power-of-two scaling must roundtrip each encoded scalar exactly. This
 * addresses finite exponent range; it never substitutes a binary RAY or
 * claims that an uncertain implicit/cusp has become geometrically correct. */
inline bool finite_fields(BoundaryCoverageVertex v[3],uint32_t kind,const RawCoverageOptions&o,RawCoverageCertificate&cert){
 RawCoverageCertificate candidate=cert;
 if(field_range(v,o,candidate)){cert=candidate;return true;}
 if(kind!=boundary_coverage_cubic&&kind!=boundary_coverage_embedded_quad)return false;
 for(uint32_t step=0;step<32;step++){
  if(kind==boundary_coverage_embedded_quad){
   // Preserve M==K for the audited quadratic embedding. K/M scale by1/4,
   // L by1/16, hence both F and its gradient scale exactly by1/64.
   for(uint32_t i=0;i<3;i++){
    float k=v[i].k*.25f,l=v[i].l*.0625f,m=v[i].m*.25f;
    if(k*4!=v[i].k||l*16!=v[i].l||m*4!=v[i].m)return false;
    v[i].k=k;v[i].l=l;v[i].m=m;
   }
   candidate=cert;if(field_range(v,o,candidate)){cert=candidate;return true;}continue;
  }
  // K'=K/4 fixes F'=F/64. Distribute the six remaining binary exponents
  // between L and M: a tiny functional need not underflow just because its
  // partner can safely carry more of the scaling. All scalar casts must
  // exact-roundtrip; this is an algebraic identity, not an epsilon edit.
  BoundaryCoverageVertex best[3]{};bool found=false;double bestMaximum=0;
  for(uint32_t exponent=0;exponent<=6;exponent++){
   float lScale=1,mScale=1;for(uint32_t k=0;k<exponent;k++)lScale*=.5f;for(uint32_t k=exponent;k<6;k++)mScale*=.5f;
   BoundaryCoverageVertex attempt[3];bool valid=true;double maximum=0;
   for(uint32_t i=0;i<3;i++){
    attempt[i]=v[i];float k=v[i].k*.25f,l=v[i].l*lScale,m=v[i].m*mScale;
    if(k*4!=v[i].k||l/lScale!=v[i].l||m/mScale!=v[i].m){valid=false;break;}
    attempt[i].k=k;attempt[i].l=l;attempt[i].m=m;maximum=max(maximum,max(abs(l),abs(m)));
   }
   if(valid&&(!found||maximum<bestMaximum)){found=true;bestMaximum=maximum;for(uint32_t i=0;i<3;i++)best[i]=attempt[i];}
  }
  if(!found)return false;for(uint32_t i=0;i<3;i++)v[i]=best[i];
  candidate=cert;if(field_range(v,o,candidate)){cert=candidate;return true;}
 }
 return false;
}
inline bool position_cast_error(const double*positions,uint32_t count,double ox,double oy,double&error){
 error=0;for(uint32_t i=0;i<count;i++){
  float x=float(positions[2*i]-ox),y=float(positions[2*i+1]-oy);if(!finite_double(x)||!finite_double(y))return false;
  error=max(error,sum(difference_error(positions[2*i],ox,x),difference_error(positions[2*i+1],oy,y)));
 }return true;
}
/* Keep the original representation whenever its actual cast meets the physical
 * budget. A long fan may need a nearer binary64 origin even though its source
 * is valid. Preflight and emission select the same origin for each triangle;
 * rebasing changes no authoritative command, KLM value or geometric budget. */
inline bool position_origin(const double*positions,const RawCoverageOptions&o,double&ox,double&oy,double&error){
 if(!position_cast_error(positions,3,ox,oy,error))return false;
 if(mul(o.maximum_forward_norm,error)<=o.maximum_geometry_error_pixels)return true;
 double low[2]={positions[0],positions[1]},high[2]={positions[0],positions[1]};
 for(uint32_t i=1;i<3;i++)for(uint32_t axis=0;axis<2;axis++){double v=positions[i*2+axis];if(v<low[axis])low[axis]=v;if(v>high[axis])high[axis]=v;}
 double x=low[0]*.5+high[0]*.5,y=low[1]*.5+high[1]*.5,candidate=0;
 if(position_cast_error(positions,3,x,y,candidate)&&candidate<error){ox=x;oy=y;error=candidate;}
 return true;
}
inline bool emit(PolynomialContext&c,RawCoverageMesh&out,const double*positions,BoundaryCoverageVertex v[3],int winding,
 double ox,double oy,uint32_t command,uint32_t kind,const RawCoverageOptions&o,BoundaryKLMReason&reason){
 if(out.mesh.vertices.size()>o.maximum_vertices-3||out.mesh.draws.size()>=o.maximum_draws){reason=boundary_klm_capacity;return false;}
 double error=0;if(!position_origin(positions,o,ox,oy,error)){reason=boundary_klm_invalid;return false;}
 for(uint32_t i=0;i<3;i++){
  v[i].x=float(positions[2*i]-ox);v[i].y=float(positions[2*i+1]-oy);
  if(!finite_double(v[i].x)||!finite_double(v[i].y)||!finite_double(v[i].k)||!finite_double(v[i].l)||!finite_double(v[i].m)){reason=boundary_klm_invalid;return false;}
 }
 auto&cert=out.certificate;cert.actual_position_error_source=max(cert.actual_position_error_source,error);
 if(mul(o.maximum_forward_norm,sum(error,cert.actual_regularization_error_source))>o.maximum_geometry_error_pixels){reason=boundary_klm_error_budget;return false;}
 double dx1=double(v[1].x)-v[0].x,dy1=double(v[1].y)-v[0].y,dx2=double(v[2].x)-v[0].x,dy2=double(v[2].y)-v[0].y;
 double determinant=dx1*dy2-dx2*dy1;
 // Exact Float32 coordinate rank/orientation predicate (rare ambiguous area).
 double areaError=mul(16*0x1p-52,sum(abs(dx1*dy2),abs(dx2*dy1)));int orientation=determinant>0?1:-1;
 if(abs(determinant)<=areaError){Q exact=boundary_coverage::cross(c,v[0],v[1],v[2]);if(c.numbers.status)return false;if(exact.zero()){
  // The actual Float32 triangle has exactly zero source area. The existing
  // encoded geometry has collapsed within the charged position-error cell;
  // there is no finite affine interpolant/coverage lens to submit. This is
  // counted derived collapse, never removal of authoritative source commands.
  ++cert.degenerate_triangles;return true;}orientation=exact.sign();}
 if(kind!=boundary_coverage_solid&&!finite_fields(v,kind,o,cert)){reason=boundary_klm_zero_gradient;return false;}
 if(orientation!=winding){auto z=v[1];v[1]=v[2];v[2]=z;}
 BoundaryCoverageDraw draw{};draw.origin[0]=ox;draw.origin[1]=oy;draw.first=out.mesh.vertices.size();draw.count=3;draw.source_edge=command;draw.kind=kind;draw.float_cast_error_pixels=mul(error,o.maximum_forward_norm);
 for(uint32_t i=0;i<3;i++)out.mesh.vertices.push_back(v[i]);out.mesh.draws.push_back(draw);++cert.absolute_contribution_bound;return !c.numbers.status;
}
inline bool restricted_cubic(PolynomialContext&c,const SAInkPathCommand&command,const Command&meta,const SAAnalyticPatch&p,Point restricted[4]){
 if(command.operation!=3||!(p.parameter_start>=0&&p.parameter_end<=1&&p.parameter_start<p.parameter_end))return false;
 auto&ctx=c.numbers;Point original[4];original[0]={Q::from_double(ctx,meta.start[0]),Q::from_double(ctx,meta.start[1])};for(uint32_t i=1;i<4;i++)original[i]={Q::from_double(ctx,command.values[2*i-2]),Q::from_double(ctx,command.values[2*i-1])};
 Q t[2]={Q::from_double(ctx,p.parameter_start),Q::from_double(ctx,p.parameter_end)};
 for(uint32_t i=0;i<4;i++){Point v[4];for(uint32_t j=0;j<4;j++)v[j]=original[j];for(uint32_t level=0;level<3;level++){Q x=t[level<3-i?0:1];for(uint32_t j=0;j<3-level;j++)v[j]={v[j].x*(Q(1)-x)+v[j+1].x*x,v[j].y*(Q(1)-x)+v[j+1].y*x};}restricted[i]=v[0];}
 return !ctx.status;
}
inline bool chord_error(PolynomialContext&c,const Point restricted[4],const double av[2],const double bv[2],double&error){
 auto&ctx=c.numbers;
 Point a{Q::from_double(ctx,av[0]),Q::from_double(ctx,av[1])},b{Q::from_double(ctx,bv[0]),Q::from_double(ctx,bv[1])};Q dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
 Q maximumX=Q::from_signed(ctx,0),maximumY=Q::from_signed(ctx,0),previous(0);bool monotone=true;
 for(uint32_t i=0;i<4;i++){
  Q projection=den.zero()?Q(0):((restricted[i].x-a.x)*dx+(restricted[i].y-a.y)*dy)/den;
  if(i==0)projection=Q(0);else if(i==3)projection=Q(1);else if(projection<Q(0)||projection>Q(1)||projection<previous)monotone=false;
  previous=projection;Q ex=(restricted[i].x-a.x-dx*projection).absolute(),ey=(restricted[i].y-a.y-dy*projection).absolute();if(ex>maximumX)maximumX=ex;if(ey>maximumY)maximumY=ey;
 }
 // If a rounding-scale tangent reverses, projection onto the chord cannot
 // certify a monotone reparameterization. Compare the original restricted
 // cubic directly with the linear chord parameter instead. This charges all
 // longitudinal/backtracking motion as well as transverse/endpoint error.
 if(!monotone){maximumX=Q::from_signed(ctx,0);maximumY=Q::from_signed(ctx,0);for(uint32_t i=0;i<4;i++){
  Q t=Q::from_signed(ctx,i)/Q(3),ex=(restricted[i].x-a.x-dx*t).absolute(),ey=(restricted[i].y-a.y-dy*t).absolute();
  if(ex>maximumX)maximumX=ex;if(ey>maximumY)maximumY=ey;
 }}
 return !ctx.status&&boundary_quantization::upper_bound(maximumX+maximumY,error);
}
/* Outward binary64 filter for the exact restricted Bernstein controls. Every
 * primitive encloses its real result, including subnormals. A proved chord
 * error replaces only the expensive proof, preserving the analytic factory's
 * actual vertices. Uncertain/over-budget bounds use the exact rational proof.
 * Final admission still charges endpoint rounding and Float32 position error
 * under the original transform envelope and geometric tolerance. */
struct Enclosure {double lo=0,hi=0;};
inline double adjacent(double x,bool positive){
 if(!finite_double(x))return x;uint64_t bits;copy_bytes(&bits,&x,8);
 if((bits&0x7fffffffffffffffull)==0)bits=positive?1:0x8000000000000001ull;
 else if((x>0)==positive)++bits;else --bits;
 copy_bytes(&x,&bits,8);return x;
}
inline Enclosure enclose(double x){return{x,x};}
inline Enclosure add(Enclosure a,Enclosure b){return{adjacent(a.lo+b.lo,false),adjacent(a.hi+b.hi,true)};}
inline Enclosure negate(Enclosure a){return{-a.hi,-a.lo};}
inline Enclosure subtract(Enclosure a,Enclosure b){return add(a,negate(b));}
inline Enclosure multiply(Enclosure a,Enclosure b){
 double v[4]={a.lo*b.lo,a.lo*b.hi,a.hi*b.lo,a.hi*b.hi},lo=v[0],hi=v[0];
 for(uint32_t i=1;i<4;i++){if(v[i]<lo)lo=v[i];if(v[i]>hi)hi=v[i];}
 return{adjacent(lo,false),adjacent(hi,true)};
}
inline double magnitude(Enclosure a){return max(abs(a.lo),abs(a.hi));}
inline bool valid(Enclosure a){return finite_double(a.lo)&&finite_double(a.hi)&&a.lo<=a.hi;}
inline bool chord_enclosure(const Enclosure controls[4][2],const double a[2],const double b[2],double&error){
 for(uint32_t i=0;i<4;i++)for(uint32_t axis=0;axis<2;axis++)if(!valid(controls[i][axis]))return false;
 Enclosure d[2]={subtract(enclose(b[0]),enclose(a[0])),subtract(enclose(b[1]),enclose(a[1]))};
 Enclosure den=add(multiply(d[0],d[0]),multiply(d[1],d[1]));
 if(!valid(d[0])||!valid(d[1])||!valid(den))return false;
 Enclosure n[2];double crossMax=0;
 for(uint32_t i=1;i<3;i++){
  Enclosure x=subtract(controls[i][0],enclose(a[0])),y=subtract(controls[i][1],enclose(a[1]));
  n[i-1]=add(multiply(x,d[0]),multiply(y,d[1]));
  Enclosure cross=subtract(multiply(x,d[1]),multiply(y,d[0]));if(!valid(n[i-1])||!valid(cross))return false;
  crossMax=max(crossMax,magnitude(cross));
 }
 double mx=0,my=0;
 if(valid(den)&&den.lo>0&&n[0].lo>=0&&n[1].hi<=den.lo&&n[0].hi<=n[1].lo){
  // A monotone projected Bernstein parameter maps [0,1] onto the chord.
  mx=max(magnitude(subtract(controls[0][0],enclose(a[0]))),magnitude(subtract(controls[3][0],enclose(b[0]))));
  my=max(magnitude(subtract(controls[0][1],enclose(a[1]))),magnitude(subtract(controls[3][1],enclose(b[1]))));
  mx=max(mx,up(mul(magnitude(d[1]),crossMax)/den.lo));
  my=max(my,up(mul(magnitude(d[0]),crossMax)/den.lo));
 }else{
  // Parameter-wise convex bound also covers reversals and zero-length chords.
  for(uint32_t i=0;i<4;i++){
   Enclosure t=i==0?enclose(0):i==3?enclose(1):Enclosure{adjacent(double(i)/3,false),adjacent(double(i)/3,true)};
   Enclosure ex=subtract(subtract(controls[i][0],enclose(a[0])),multiply(d[0],t)),ey=subtract(subtract(controls[i][1],enclose(a[1])),multiply(d[1],t));
   if(!valid(ex)||!valid(ey))return false;mx=max(mx,magnitude(ex));my=max(my,magnitude(ey));
  }
 }
 error=sum(mx,my);return finite_double(error);
}
inline bool restricted_enclosure(const SAInkPathCommand&command,const Command&meta,const SAAnalyticPatch&p,Enclosure restricted[4][2]){
 if(command.operation!=3||!(p.parameter_start>=0&&p.parameter_end<=1&&p.parameter_start<p.parameter_end))return false;
 Enclosure t[2]={enclose(p.parameter_start),enclose(p.parameter_end)};
 for(uint32_t i=0;i<4;i++)for(uint32_t axis=0;axis<2;axis++){
  Enclosure v[4];v[0]=enclose(meta.start[axis]);for(uint32_t j=1;j<4;j++)v[j]=enclose(command.values[2*j-2+axis]);
  for(uint32_t level=0;level<3;level++){
   Enclosure x=t[level<3-i?0:1],oneMinus=subtract(enclose(1),x);
   for(uint32_t j=0;j<3-level;j++)v[j]=add(multiply(v[j],oneMinus),multiply(v[j+1],x));
  }
  if(!valid(v[0]))return false;restricted[i][axis]=v[0];
 }
 return true;
}

inline bool chord(PolynomialContext&c,const SAInkPathCommand&command,const Command&meta,const SAAnalyticPatch&p,double&error,double filterLimit=0){
 double a[2]={p.controls[0],p.controls[1]},b[2]={p.controls[6],p.controls[7]};
 Enclosure bounds[4][2];double filtered=0;
 if(filterLimit>0&&restricted_enclosure(command,meta,p,bounds)&&chord_enclosure(bounds,a,b,filtered)&&filtered<=filterLimit){error=filtered;return true;}
 Point controls[4];return restricted_cubic(c,command,meta,p,controls)&&chord_error(c,controls,a,b,error);
}
/* Actual preflight of the original factory vertices. A newly admitted
 * polyline interval cannot consume headroom needed by a later original fan.
 * This is the same position-cast calculation as emit, not a larger tolerance. */
inline bool original_cast_error(const Vector<SAAnalyticPatch>&patches,const Vector<Command>&metadata,
 const SAInkPathCommand*commands,const RawCoverageOptions&o,double&error){
 error=0;
 for(const auto&p:patches){
  if(p.mode==SA_ANALYTIC_RAY)continue;const auto&meta=metadata[p.command_index];
  double positions[8]{};uint32_t count=0;
  if(p.mode==SA_ANALYTIC_SOLID){count=3;positions[0]=p.origin[0];positions[1]=p.origin[1];positions[2]=p.controls[0];positions[3]=p.controls[1];positions[4]=p.controls[6];positions[5]=p.controls[7];}
  else if(p.mode==SA_ANALYTIC_QUADRATIC){count=3;positions[0]=meta.start[0];positions[1]=meta.start[1];for(uint32_t j=0;j<4;j++)positions[j+2]=commands[p.command_index].values[j];}
  else if(p.mode==SA_ANALYTIC_CUBIC){uint32_t indices[4]{};count=hull(p.controls,indices);if(count<3)return false;for(uint32_t j=0;j<count;j++){positions[j*2]=p.controls[indices[j]*2];positions[j*2+1]=p.controls[indices[j]*2+1];}}
  else return false;
  for(uint32_t j=1;j+1<count;j++){
   double triangle[6]={positions[0],positions[1],positions[j*2],positions[j*2+1],positions[(j+1)*2],positions[(j+1)*2+1]};
   double ox=meta.origin[0],oy=meta.origin[1],cast=0;if(!position_origin(triangle,o,ox,oy,cast))return false;
   error=max(error,cast);
  }
 }
 return true;
}
inline double float_cell_error(double bound){
 float f=float(bound);if(!finite_double(f))return double(f);uint32_t bits;copy_bytes(&bits,&f,4);uint32_t e=(bits>>23)&255;
 uint64_t encoded=uint64_t(int(e?e:1)-127-24+1023)<<52;double half;copy_bytes(&half,&encoded,8);
 return sum(half,half_ulp_double(bound));
}
/* Replace only an actual unresolved interval by a certified polyline. The
 * factory's original chord fan remains; the added oriented fans have that
 * chord as their opposite boundary, so the signed sum follows the polyline.
 * Every shared split endpoint is rounded ONCE from the original exact cubic.
 * Each leaf charges the exact Bernstein/chord error plus all retained triangle
 * position casting under the unchanged physical metric envelope. */
inline uint32_t refine_ray(PolynomialContext&c,const SAInkPathCommand&command,const Command&meta,const SAAnalyticPatch&p,
 const RawCoverageOptions&o,RawCoverageMesh&out,double originalCast,uint32_t leafBudget,BoundaryKLMReason&reason){
 auto&ctx=c.numbers;
 struct Cell {Point controls[4];double a[2]{},b[2]{};uint32_t depth=0;};
 Cell first;if(!restricted_cubic(c,command,meta,p,first.controls)){reason=boundary_klm_ray;return ctx.status?ctx.status:SA_INK_RANGE;}
 first.a[0]=p.controls[0];first.a[1]=p.controls[1];first.b[0]=p.controls[6];first.b[1]=p.controls[7];
 // Convex bounds of the exact restricted curve plus the once-rounded shared
 // binary64 endpoint bound every later split anchor. The Float32 cell bound
 // reserves casting headroom BEFORE choosing any chord leaf, without storing
 // a full polyline or revising already admitted geometry after another leaf.
 // One binary64 endpoint is already the shared fan anchor. Rebase only
 // these derived RAY triangles to it. Whole-subpath MOVE distance can make
 // a conservative Float cell wider than the remaining error budget forever,
 // even after the actual chord error has converged. Both the future-cast
 // proof and emit use this exact same origin; original fans/preflight and
 // the accumulated geometric error policy remain unchanged.
 const double anchor[2]={first.a[0],first.a[1]};
 double futureCast[2]{};
 for(uint32_t axis=0;axis<2;axis++){
  Q local=Q::from_signed(ctx,0),world=local,origin=Q::from_double(ctx,anchor[axis]);
  for(uint32_t j=0;j<4;j++){const Q&value=axis?first.controls[j].y:first.controls[j].x;local=boundary_quantization::maximum(local,(value-origin).absolute());world=boundary_quantization::maximum(world,value.absolute());}
  for(uint32_t endpoint=0;endpoint<2;endpoint++){double value=endpoint?first.b[axis]:first.a[axis];Q exact=Q::from_double(ctx,value);local=boundary_quantization::maximum(local,(exact-origin).absolute());world=boundary_quantization::maximum(world,exact.absolute());}
  double localBound=0,worldBound=0;if(!boundary_quantization::upper_bound(local,localBound)||!boundary_quantization::upper_bound(world,worldBound))return ctx.status;
  futureCast[axis]=float_cell_error(sum(localBound,half_ulp_double(worldBound)));
 }
 const double castBound=max(originalCast,sum(futureCast[0],futureCast[1]));
 const Point qa{Q::from_double(ctx,anchor[0]),Q::from_double(ctx,anchor[1])};
 Vector<Cell,1>pending(ctx);pending.push_back(first);
 while(!pending.empty()&&!ctx.status){
  if(!ctx.step())return ctx.status;Cell cell=pending.back();pending.pop_back();double error=0;
  if(!chord_error(c,cell.controls,cell.a,cell.b,error)){reason=boundary_klm_ray;return ctx.status?ctx.status:SA_INK_RANGE;}
  auto&cert=out.certificate;
  // The emitted triangles must also satisfy this same combined budget;
  // admission here never widens the policy or bypasses their casting check.
  double previous=cert.actual_regularization_error_source;
  bool admitted=mul(o.maximum_forward_norm,sum(max(cert.actual_position_error_source,castBound),max(previous,error)))<=o.maximum_geometry_error_pixels;
  if(admitted){
   if(out.regularization_segments>=leafBudget){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}
   // The whole source factory and every added leaf share one patch cap.
   ++out.regularization_segments;cert.actual_regularization_error_source=max(previous,error);
   Point a{Q::from_double(ctx,cell.a[0]),Q::from_double(ctx,cell.a[1])},b{Q::from_double(ctx,cell.b[0]),Q::from_double(ctx,cell.b[1])};
   Q area=(a.x-qa.x)*(b.y-qa.y)-(a.y-qa.y)*(b.x-qa.x);if(ctx.status)return ctx.status;
   if(area.zero()){++cert.degenerate_triangles;continue;}
   BoundaryCoverageVertex tri[3]{};for(auto&v:tri)v.l=v.m=1;
   double positions[6]={anchor[0],anchor[1],cell.a[0],cell.a[1],cell.b[0],cell.b[1]};
   if(!emit(c,out,positions,tri,area.sign(),anchor[0],anchor[1],p.command_index,boundary_coverage_solid,o,reason))return ctx.status?ctx.status:reason==boundary_klm_capacity?SA_INK_CAPACITY:SA_INK_RANGE;
   continue;
  }
  if(cell.depth>=o.maximum_analytic_depth){reason=boundary_klm_error_budget;return SA_INK_RANGE;}
  Cell left,right;left.depth=right.depth=cell.depth+1;
  for(uint32_t axis=0;axis<2;axis++){left.a[axis]=cell.a[axis];right.b[axis]=cell.b[axis];}
  Point work[4];for(uint32_t i=0;i<4;i++)work[i]=cell.controls[i];
  left.controls[0]=work[0];right.controls[3]=work[3];
  for(uint32_t level=1;level<=3;level++){
   for(uint32_t i=0;i<4-level;i++)work[i]={(work[i].x+work[i+1].x)/Q(2),(work[i].y+work[i+1].y)/Q(2)};
   left.controls[level]=work[0];right.controls[3-level]=work[3-level];
  }
  double midpoint[2];if(!boundary_quantization::nearest_lower_tie(work[0].x,midpoint[0])||!boundary_quantization::nearest_lower_tie(work[0].y,midpoint[1]))return ctx.status;
  for(uint32_t axis=0;axis<2;axis++)left.b[axis]=right.a[axis]=midpoint[axis];
  // Depth first, in original source direction; the stack has depth+1 cells.
  pending.push_back(right);pending.push_back(left);
 }
 return ctx.status;
}
}
inline bool raw_coverage_supports(const RawCoverageCertificate&c,const double*m){
 double forward=0,inverse=0;return m&&c.maximum_forward_norm>0&&c.maximum_inverse_norm>0&&raw_coverage::matrix_norms(m,forward,inverse)&&forward<=c.maximum_forward_norm&&inverse<=c.maximum_inverse_norm;
}
inline uint32_t build_raw_coverage_mesh(PolynomialContext&c,const SAInkPathCommand*commands,uint32_t count,uint64_t generation,const RawCoverageOptions&o,RawCoverageMesh&output,BoundaryKLMReason&reason){
 using namespace raw_coverage;auto&ctx=c.numbers;reason=boundary_klm_none;
 if(ctx.status)return ctx.status;
 if((count&&!commands)||!o.maximum_commands||count>o.maximum_commands||o.maximum_commands>100000||!o.maximum_patches||o.maximum_patches>100000||o.maximum_vertices<3||o.maximum_vertices>1000000||!o.maximum_draws||o.maximum_draws>333333||!o.maximum_analytic_depth||o.maximum_analytic_depth>32||o.reserved||!finite_double(o.maximum_forward_norm)||!(o.maximum_forward_norm>0)||!finite_double(o.maximum_inverse_norm)||!(o.maximum_inverse_norm>0)||!finite_double(o.maximum_geometry_error_pixels)||!(o.maximum_geometry_error_pixels>0)||output.mesh.vertices.context()!=&ctx){reason=boundary_klm_invalid;return SA_INK_INVALID;}
 double identity[6]={1,0,0,1,0,0};SAAnalyticBudget budget{o.maximum_commands,o.maximum_patches,o.maximum_analytic_depth,0};const RawAnalyticCapture captured(commands,count,identity,&budget);auto status=captured.status();if(status)return status;SAAnalyticCounts counts=captured.counts();
 // Admission includes the actual source factory temporary output and final mesh.
 if(counts.vertices>o.maximum_vertices||counts.vertices/3>o.maximum_draws){reason=boundary_klm_capacity;return SA_INK_CAPACITY;}
 Vector<SAAnalyticPatch>patches(ctx);Vector<SAAnalyticVertex>vertices(ctx);patches.resize(counts.patches);vertices.resize(counts.vertices);Vector<Command>metadata(ctx);metadata.resize(count);
 if(ctx.status)return ctx.status;status=captured.emit(counts.patches?&patches[0]:nullptr,patches.size(),counts.vertices?&vertices[0]:nullptr,vertices.size(),&counts);if(status)return status;
 double current[2]{},origin[2]{};
 for(uint32_t i=0;i<count;i++){auto&meta=metadata[i];for(uint32_t axis=0;axis<2;axis++){meta.start[axis]=current[axis];if(commands[i].operation==0)origin[axis]=commands[i].values[axis];meta.origin[axis]=origin[axis];if(commands[i].operation<4)current[axis]=commands[i].values[2*commands[i].operation+axis-(commands[i].operation?2:0)];else current[axis]=origin[axis];}}
 RawCoverageMesh staged(ctx);staged.source_generation=generation;bool hasBounds=false;
 for(uint32_t i=0;i<count;i++)if(commands[i].operation<4){uint32_t points=commands[i].operation?commands[i].operation:1;for(uint32_t j=0;j<points;j++){double x=commands[i].values[2*j],y=commands[i].values[2*j+1];auto&b=staged.source_control_bounds;if(!hasBounds){b[0]=b[2]=x;b[1]=b[3]=y;hasBounds=true;}else{if(x<b[0])b[0]=x;if(y<b[1])b[1]=y;if(x>b[2])b[2]=x;if(y>b[3])b[3]=y;}}}
 double originalCast=0;if(counts.ray_patches&&!original_cast_error(patches,metadata,commands,o,originalCast)){reason=boundary_klm_invalid;return SA_INK_INVALID;}
 auto&cert=staged.certificate;cert.maximum_forward_norm=o.maximum_forward_norm;cert.maximum_inverse_norm=o.maximum_inverse_norm;cert.maximum_geometry_error_pixels=o.maximum_geometry_error_pixels;
 for(const auto&p:patches){if(!ctx.step())return ctx.status;if(p.command_index>=count){reason=boundary_klm_invalid;return SA_INK_INVALID;}const auto&meta=metadata[p.command_index];
  if(p.mode==SA_ANALYTIC_RAY){double error=0;if(!chord(c,commands[p.command_index],meta,p,error,o.maximum_geometry_error_pixels/o.maximum_forward_norm-max(cert.actual_position_error_source,originalCast))){reason=boundary_klm_ray;return ctx.status?ctx.status:SA_INK_RANGE;}
   if(mul(o.maximum_forward_norm,sum(max(cert.actual_position_error_source,originalCast),max(cert.actual_regularization_error_source,error)))<=o.maximum_geometry_error_pixels){cert.actual_regularization_error_source=max(cert.actual_regularization_error_source,error);}
   else{uint32_t refined=refine_ray(c,commands[p.command_index],meta,p,o,staged,originalCast,o.maximum_patches-counts.patches,reason);if(refined)return refined;}
   ++cert.regularized_rays;continue;}
  uint32_t hullIndices[4]{},hullCount=p.mode==SA_ANALYTIC_CUBIC?hull(p.controls,hullIndices):0;if(p.mode==SA_ANALYTIC_CUBIC&&(hullCount<3||(hullCount-2)*3!=p.vertex_count)){reason=boundary_klm_invalid;return SA_INK_INVALID;}
  const auto patchCertificate=cert;const uint32_t patchVertices=staged.mesh.vertices.size(),patchDraws=staged.mesh.draws.size();
  for(uint32_t i=0;i<p.vertex_count;i+=3){BoundaryCoverageVertex tri[3]{};double positions[6]{};uint32_t quadMask=0;
   for(uint32_t j=0;j<3;j++){const auto&v=vertices[p.first_vertex+i+j];double x=0,y=0;bool found=false;
    if(p.mode==SA_ANALYTIC_SOLID){uint32_t k=j==0?0:p.winding>0?j:3-j;double choices[6]={p.origin[0],p.origin[1],p.controls[0],p.controls[1],p.controls[6],p.controls[7]};x=choices[2*k];y=choices[2*k+1];found=float(x-p.origin[0])==v.x&&float(y-p.origin[1])==v.y;tri[j].l=tri[j].m=1;}
    else if(p.mode==SA_ANALYTIC_QUADRATIC){if(commands[p.command_index].operation!=2||p.sign!=-1){reason=boundary_klm_invalid;return SA_INK_INVALID;}uint32_t k=v.k==0&&v.l==0?0:v.k==.5f&&v.l==0?1:v.k==1&&v.l==1?2:3;if(k==3){reason=boundary_klm_invalid;return SA_INK_INVALID;}quadMask|=1u<<k;x=k==0?meta.start[0]:commands[p.command_index].values[2*(k-1)];y=k==0?meta.start[1]:commands[p.command_index].values[2*(k-1)+1];found=true;tri[j].k=tri[j].m=v.k;tri[j].l=v.l;}
    else if(p.mode==SA_ANALYTIC_CUBIC){uint32_t k=hullIndices[j==0?0:i/3+j];x=p.controls[2*k];y=p.controls[2*k+1];found=float(x-p.origin[0])==v.x&&float(y-p.origin[1])==v.y;float sign=-p.sign;tri[j].k=v.k*sign;tri[j].l=v.l*sign;tri[j].m=v.m;}
    else{reason=boundary_klm_invalid;return SA_INK_INVALID;}
    if(!found){reason=boundary_klm_invalid;return SA_INK_INVALID;}positions[2*j]=x;positions[2*j+1]=y;
   }
   if(p.mode==SA_ANALYTIC_QUADRATIC&&quadMask!=7){reason=boundary_klm_invalid;return SA_INK_INVALID;}
   uint32_t kind=p.mode==SA_ANALYTIC_SOLID?boundary_coverage_solid:p.mode==SA_ANALYTIC_QUADRATIC?boundary_coverage_embedded_quad:boundary_coverage_cubic;
   if(!emit(c,staged,positions,tri,p.winding,meta.origin[0],meta.origin[1],p.command_index,kind,o,reason)){
    // A valid but rounding-scale regular cubic can have a nonzero encoded
    // triangle whose extended-center functional cannot stay finite without
    // losing a coefficient. Do not weaken finite_fields or emit binary RAY.
    // The analytic factory already emitted this interval's oriented chord fan.
    // Prove the ORIGINAL restricted curve is within the same geometric budget
    // of that retained chord (including its binary64 endpoint rounding), then
    // remove the entire lens transaction, not merely its failing triangle.
    double error=0;
    if(!ctx.status&&reason==boundary_klm_zero_gradient&&p.mode==SA_ANALYTIC_CUBIC&&
       chord(c,commands[p.command_index],meta,p,error,o.maximum_geometry_error_pixels/o.maximum_forward_norm-patchCertificate.actual_position_error_source)&&
       mul(o.maximum_forward_norm,sum(patchCertificate.actual_position_error_source,
           max(patchCertificate.actual_regularization_error_source,error)))<=o.maximum_geometry_error_pixels){
     if(!staged.mesh.vertices.resize(patchVertices)||!staged.mesh.draws.resize(patchDraws))return ctx.status;
     cert=patchCertificate;cert.actual_regularization_error_source=max(cert.actual_regularization_error_source,error);
     ++staged.regularized_curves;reason=boundary_klm_none;break;
    }
    return ctx.status?ctx.status:reason==boundary_klm_capacity?SA_INK_CAPACITY:SA_INK_RANGE;
   }
  }
 }
 if(ctx.status)return ctx.status;staged.mesh.source_edges=count;staged.mesh.vertex_bytes=uint64_t(staged.mesh.vertices.size())*sizeof(BoundaryCoverageVertex);output=static_cast<RawCoverageMesh&&>(staged);return SA_INK_OK;
}
}
#endif
