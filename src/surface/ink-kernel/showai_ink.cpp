#include "include/showai_ink.h"

// This implementation is freestanding: no allocator, exceptions, C++ runtime,
// storage or platform APIs. Native and WebAssembly compile this same source.
static const double PI = 3.14159265358979323846264338327950288;
// Owned deterministic elementary math. Portable samples limit azimuth to
// [-100,100], so reduction never loses a quadrant. Split pi/2 and fixed-order
// Taylor polynomials avoid host libm differences between Apple, Windows and
// JavaScript. IEEE sqrt is a hardware/Wasm primitive. Contraction is disabled.
static void trig(double x, double &s, double &c) {
    const double half = 1.57079632679489661923132169163975144;
    const double high = 0x1.921fb54400000p0;
    const double low = half - high;
    int quadrant = (int)(x / half + (x < 0 ? -0.5 : 0.5));
    // The final split correction is the exact mathematical pi/2 residual beyond
    // the nearest binary64 half constant, retained as a separate operation.
    double r = ((x - quadrant * high) - quadrant * low) - quadrant * 6.12323399573676603587e-17;
    double z = r * r;
    double sp = -1.0/121645100408832000.0;
    sp = 1.0/355687428096000.0 + z*sp;
    sp = -1.0/1307674368000.0 + z*sp;
    sp = 1.0/6227020800.0 + z*sp;
    sp = -1.0/39916800.0 + z*sp;
    sp = 1.0/362880.0 + z*sp;
    sp = -1.0/5040.0 + z*sp;
    sp = 1.0/120.0 + z*sp;
    sp = -1.0/6.0 + z*sp;
    double cp = 1.0/2432902008176640000.0;
    cp = -1.0/6402373705728000.0 + z*cp;
    cp = 1.0/20922789888000.0 + z*cp;
    cp = -1.0/87178291200.0 + z*cp;
    cp = 1.0/479001600.0 + z*cp;
    cp = -1.0/3628800.0 + z*cp;
    cp = 1.0/40320.0 + z*cp;
    cp = -1.0/720.0 + z*cp;
    cp = 1.0/24.0 + z*cp;
    cp = -1.0/2.0 + z*cp;
    double sr = r + r*z*sp, cr = 1 + z*cp;
    switch ((quadrant % 4 + 4) % 4) {
        case 0: s=sr;c=cr;break;case 1: s=cr;c=-sr;break;
        case 2: s=-sr;c=-cr;break;default: s=-cr;c=sr;break;
    }
}
static double hypot(double x,double y) {
    x=x<0?-x:x;y=y<0?-y:y;if(x<y){double t=x;x=y;y=t;}if(!x)return 0;
    double ratio=y/x;return x*__builtin_sqrt(1+ratio*ratio);
}
static const double INF = __builtin_inf();
static bool finite(double n) { return __builtin_isfinite(n); }
static double min(double a, double b) { return a < b ? a : b; }
static double max(double a, double b) { return a > b ? a : b; }
static double abs(double a) { return a < 0 ? -a : a; }
static SAInkPoint map(const double *m, SAInkPoint p) { return {m[0]*p.x+m[2]*p.y+m[4], m[1]*p.x+m[3]*p.y+m[5]}; }
static bool affine_valid(const double *m) {
    if (!m) return false;
    for (uint32_t i=0; i<6; ++i) if (!finite(m[i]) || abs(m[i])>1e6) return false;
    return abs(m[0]*m[3]-m[1]*m[2])>=1e-12;
}
static bool style_valid(const SAInkStyle *s) {
    return s && finite(s->source_width) && s->source_width>=0.5 && s->source_width<=40 &&
           finite(s->width) && s->width>=0.5 && s->width<=40 && s->brush<=SA_INK_MONOLINE && s->pressure<=1 && affine_valid(s->affine);
}
static bool sample_valid(const SAInkSample &p) {
    const double *v=p.values;
    for(uint32_t i=0;i<9;++i) if(!finite(v[i])) return false;
    return abs(v[0])<=1e6 && abs(v[1])<=1e6 && v[2]>=0 && v[2]<=1e6 &&
        v[3]>=0 && v[3]<=1e4 && v[4]>=0 && v[4]<=1e4 && v[5]>=0 && v[5]<=1 &&
        v[6]>=0 && v[6]<=100 && abs(v[7])<=100 && abs(v[8])<=100;
}
static bool range_valid(const SAInkSample *p,uint32_t n,uint32_t start,uint32_t length) {
    if(!p || !n || n>SA_INK_MAX_SAMPLES || start>n || length>n-start) return false;
    uint32_t first=start ? start-1 : start;
    for(uint32_t i=first;i<start+length;++i) {
        if(!sample_valid(p[i]) || (i>first && p[i].values[2]<p[i-1].values[2])) return false;
    }
    return true;
}
static SAInkSample resolved(const SAInkSample &p,const SAInkStyle &s) {
    SAInkSample q=p;
    double nib=s.pressure ? (s.brush==SA_INK_MONOLINE ? s.source_width*(0.2+0.8*min(1,p.values[6])) : p.values[3]) : s.source_width;
    q.values[3]=(nib*s.width)/s.source_width;
    q.values[4]=(nib*(p.values[3]>0 ? p.values[4]/p.values[3] : 1)*s.width)/s.source_width;
    return q;
}
static void ellipse(const SAInkSample &p,SAInkPoint *out) {
    const double *v=p.values; double c,s;trig(v[7],s,c);double rx=v[3]/2,ry=v[4]/2;
    for(uint32_t i=0;i<16;++i) {
        double t=(i*PI)/8,ct,st;trig(t,st,ct);double x=rx*ct,y=ry*st;
        out[i]={v[0]+x*c-y*s,v[1]+x*s+y*c};
    }
}
static SAInkPoint support(const SAInkSample &p,double nx,double ny) {
    const double *v=p.values;double c,s;trig(v[7],s,c);double x=nx*c+ny*s,y=-nx*s+ny*c,rx=v[3]/2,ry=v[4]/2;
    double d=hypot(rx*x,ry*y);if(!d)d=1;
    double ex=(rx*rx*x)/d,ey=(ry*ry*y)/d;
    return {ex*c-ey*s,ex*s+ey*c};
}
static void include(SAInkPoint p,double &left,double &top,double &right,double &bottom) {
    left=min(left,p.x);top=min(top,p.y);right=max(right,p.x);bottom=max(bottom,p.y);
}
static bool same_position(const SAInkSample &a,const SAInkSample &b) { return a.values[0]==b.values[0] && a.values[1]==b.values[1]; }
static bool contours_valid(const SAInkPoint *points,uint32_t count,const SAInkContour *contours,uint32_t contour_count) {
    if((count && !points) || (contour_count && !contours))return false;
    for(uint32_t i=0;i<count;++i) if(!finite(points[i].x)||!finite(points[i].y))return false;
    for(uint32_t i=0;i<contour_count;++i) if(contours[i].offset>count || contours[i].count>count-contours[i].offset)return false;
    return true;
}
static double cross(SAInkPoint a,SAInkPoint b,SAInkPoint c) {return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
static bool polygon_contains(const SAInkPoint *p,uint32_t n,SAInkPoint q) {
    bool inside=false;if(!n)return false;
    for(uint32_t i=0,j=n-1;i<n;j=i++)if((p[i].y>q.y)!=(p[j].y>q.y) && q.x<((p[j].x-p[i].x)*(q.y-p[i].y))/(p[j].y-p[i].y)+p[i].x)inside=!inside;
    return inside;
}
static bool mask_contains(const SAInkPoint *p,const SAInkContour *contours,uint32_t n,SAInkPoint q) {
    if(!contours)return true;
    int winding=0;
    for(uint32_t c=0;c<n;++c) {
        const SAInkPoint *poly=p+contours[c].offset;uint32_t size=contours[c].count;
        for(uint32_t i=0;i<size;++i) {
            SAInkPoint a=poly[i],b=poly[(i+1)%size];double k=cross(a,b,q);
            if(a.y<=q.y && b.y>q.y && k>0)++winding;
            else if(a.y>q.y && b.y<=q.y && k<0)--winding;
        }
    }
    return winding!=0;
}
static double point_distance(SAInkPoint p,SAInkPoint a,SAInkPoint b) {
    double dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;
    double t=max(0,min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(d ? d : 1)));
    return hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
static bool segment_crossing(SAInkPoint a,SAInkPoint b,SAInkPoint c,SAInkPoint d,double *t) {
    double ax=b.x-a.x,ay=b.y-a.y,bx=d.x-c.x,by=d.y-c.y,den=ax*by-ay*bx;
    if(!den)return false;
    double cx=c.x-a.x,cy=c.y-a.y,u=(cx*by-cy*bx)/den,v=(cx*ay-cy*ax)/den;
    if(u<0||u>1||v<0||v>1)return false;
    if(t)*t=u;return true;
}
static double segment_distance(SAInkPoint a,SAInkPoint b,SAInkPoint c,SAInkPoint d) {
    if(segment_crossing(a,b,c,d,nullptr))return 0;
    return min(min(point_distance(a,c,d),point_distance(b,c,d)),min(point_distance(c,a,b),point_distance(d,a,b)));
}

extern "C" {
uint32_t sa_ink_abi_version(void){return SA_INK_ABI_VERSION;}
uint32_t sa_ink_sizeof_sample(void){return sizeof(SAInkSample);}
uint32_t sa_ink_sizeof_style(void){return sizeof(SAInkStyle);}
uint32_t sa_ink_sizeof_command(void){return sizeof(SAInkPathCommand);}
uint32_t sa_ink_sizeof_hit(void){return sizeof(SAInkHit);}
SAInkStatus sa_ink_geometry_counts(const SAInkSample *samples,uint32_t n,uint32_t start,uint32_t length,SAInkCounts *counts) {
    if(!counts || !range_valid(samples,n,start,length))return SA_INK_INVALID;
    uint32_t segments=0;
    for(uint32_t i=start;i<start+length;++i)if(i&&!same_position(samples[i],samples[i-1]))++segments;
    *counts={length*16+segments*4,length+segments,length*42+segments*6};return SA_INK_OK;
}
SAInkStatus sa_ink_resolve_samples(const SAInkSample *samples,uint32_t n,const SAInkStyle *style,SAInkSample *output,uint32_t capacity) {
    if(!style_valid(style)||!range_valid(samples,n,0,n))return SA_INK_INVALID;
    if(capacity<n)return SA_INK_CAPACITY;if(!output)return SA_INK_INVALID;
    for(uint32_t i=0;i<n;++i)output[i]=resolved(samples[i],*style);return SA_INK_OK;
}
SAInkStatus sa_ink_build(const SAInkSample *samples,uint32_t n,uint32_t start,uint32_t length,const SAInkStyle *style,
                        SAInkPoint *points,uint32_t point_capacity,SAInkContour *contours,uint32_t contour_capacity,
                        SAInkVertex *vertices,uint32_t vertex_capacity,SAInkBounds *bounds) {
    SAInkCounts required;SAInkStatus status=sa_ink_geometry_counts(samples,n,start,length,&required);
    if(status!=SA_INK_OK||!style_valid(style)||!bounds)return SA_INK_INVALID;
    if(point_capacity<required.points||contour_capacity<required.contours||vertex_capacity<required.vertices)return SA_INK_CAPACITY;
    if((required.points&&!points)||(required.contours&&!contours)||(required.vertices&&!vertices))return SA_INK_INVALID;
    uint32_t point_index=0,contour_index=0,vertex_index=0;
    double left=INF,top=INF,right=-INF,bottom=-INF;
    for(uint32_t i=start;i<start+length;++i) {
        SAInkSample current=resolved(samples[i],*style);SAInkPoint poly[16];ellipse(current,poly);
        for(uint32_t p=0;p<16;++p){poly[p]=map(style->affine,poly[p]);points[point_index+p]=poly[p];include(poly[p],left,top,right,bottom);}
        contours[contour_index++]={point_index,16};point_index+=16;
        for(uint32_t p=1;p<15;++p)for(uint32_t k=0;k<3;++k){SAInkPoint v=poly[k==0 ? 0 : k==1 ? p : p+1];vertices[vertex_index++]={(float)v.x,(float)v.y};}
        if(i&&!same_position(samples[i],samples[i-1])) {
            SAInkSample previous=resolved(samples[i-1],*style);double dx=current.values[0]-previous.values[0],dy=current.values[1]-previous.values[1],l=hypot(dx,dy);
            SAInkPoint a=support(previous,-dy/l,dx/l),b=support(current,-dy/l,dx/l);
            SAInkPoint quad[4]={{previous.values[0]+a.x,previous.values[1]+a.y},{previous.values[0]-a.x,previous.values[1]-a.y},
                                {current.values[0]-b.x,current.values[1]-b.y},{current.values[0]+b.x,current.values[1]+b.y}};
            for(uint32_t p=0;p<4;++p){quad[p]=map(style->affine,quad[p]);points[point_index+p]=quad[p];}
            contours[contour_index++]={point_index,4};point_index+=4;
            for(uint32_t p=1;p<3;++p)for(uint32_t k=0;k<3;++k){SAInkPoint v=quad[k==0 ? 0 : k==1 ? p : p+1];vertices[vertex_index++]={(float)v.x,(float)v.y};}
        }
    }
    *bounds=length ? SAInkBounds{left,top,max(1,right-left),max(1,bottom-top)} : SAInkBounds{0,0,0,0};return SA_INK_OK;
}
SAInkStatus sa_ink_bounds(const SAInkSample *samples,uint32_t n,const SAInkStyle *style,SAInkBounds *bounds) {
    if(!style_valid(style)||!bounds||!range_valid(samples,n,0,n))return SA_INK_INVALID;
    double left=INF,top=INF,right=-INF,bottom=-INF;
    for(uint32_t i=0;i<n;++i){SAInkPoint poly[16];ellipse(resolved(samples[i],*style),poly);for(uint32_t p=0;p<16;++p)include(map(style->affine,poly[p]),left,top,right,bottom);}
    *bounds={left,top,max(1,right-left),max(1,bottom-top)};return SA_INK_OK;
}
SAInkStatus sa_ink_mask_counts(const SAInkPathCommand *commands,uint32_t n,SAInkCounts *counts) {
    if(!counts || n>SA_INK_MAX_MASK_COMMANDS || (n&&!commands))return SA_INK_INVALID;
    uint32_t points=0,contours=0,current=0;
    for(uint32_t i=0;i<n;++i) {
        const SAInkPathCommand &c=commands[i];if(c.operation>SA_INK_CLOSE)return SA_INK_INVALID;
        uint32_t size=c.operation==SA_INK_CLOSE ? 0 : c.operation==SA_INK_CUBIC ? 6 : c.operation==SA_INK_QUAD ? 4 : 2;
        for(uint32_t k=0;k<size;++k)if(!finite(c.values[k])||abs(c.values[k])>1e6)return SA_INK_INVALID;
        if(c.operation==SA_INK_MOVE){if(current)++contours;current=1;++points;}
        else if(c.operation==SA_INK_CLOSE){if(current){++contours;current=0;}}
        else {uint32_t add=c.operation==SA_INK_LINE ? 1 : 32;points+=add;current+=add;}
    }
    if(current)++contours;*counts={points,contours,0};return SA_INK_OK;
}
SAInkStatus sa_ink_flatten_mask(const SAInkPathCommand *commands,uint32_t n,const double *affine,
                               SAInkPoint *points,uint32_t point_capacity,SAInkContour *contours,uint32_t contour_capacity) {
    SAInkCounts required;SAInkStatus status=sa_ink_mask_counts(commands,n,&required);
    if(status!=SA_INK_OK||!affine_valid(affine))return SA_INK_INVALID;
    if(point_capacity<required.points||contour_capacity<required.contours)return SA_INK_CAPACITY;
    if((required.points&&!points)||(required.contours&&!contours))return SA_INK_INVALID;
    uint32_t p=0,c=0,start=0;SAInkPoint last={0,0};
    for(uint32_t i=0;i<n;++i) {
        const SAInkPathCommand &command=commands[i];const double *v=command.values;
        if(command.operation==SA_INK_MOVE) {
            if(p>start)contours[c++]={start,p-start};start=p;last={v[0],v[1]};points[p++]=map(affine,last);
        }else if(command.operation==SA_INK_LINE){last={v[0],v[1]};points[p++]=map(affine,last);}
        else if(command.operation==SA_INK_QUAD||command.operation==SA_INK_CUBIC) {
            bool cubic=command.operation==SA_INK_CUBIC;SAInkPoint a=last,end={v[cubic?4:2],v[cubic?5:3]};
            for(uint32_t step=1;step<=32;++step) {
                double t=step/32.0,u=1-t;SAInkPoint q;
                if(cubic)q={u*u*u*a.x+3*u*u*t*v[0]+3*u*t*t*v[2]+t*t*t*end.x,u*u*u*a.y+3*u*u*t*v[1]+3*u*t*t*v[3]+t*t*t*end.y};
                else q={u*u*a.x+2*u*t*v[0]+t*t*end.x,u*u*a.y+2*u*t*v[1]+t*t*end.y};
                points[p++]=map(affine,q);
            }
            last=end;
        } else if(p>start){contours[c++]={start,p-start};start=p;}
    }
    if(p>start)contours[c++]={start,p-start};return SA_INK_OK;
}
SAInkStatus sa_ink_hit(const SAInkPoint *points,uint32_t point_count,const SAInkContour *contours,uint32_t contour_count,
                     const SAInkPoint *mask_points,uint32_t mask_point_count,const SAInkContour *mask_contours,uint32_t mask_contour_count,
                     double x,double y,SAInkHit *hit) {
    if(!hit||!finite(x)||!finite(y)||!contours_valid(points,point_count,contours,contour_count)||
       !contours_valid(mask_points,mask_point_count,mask_contours,mask_contour_count))return SA_INK_INVALID;
    SAInkPoint point={x,y};hit->inside=0;hit->reserved=0;hit->distance=INF;
    if(!mask_contains(mask_points,mask_contours,mask_contour_count,point))return SA_INK_OK;
    for(uint32_t c=0;c<contour_count;++c) {
        const SAInkPoint *poly=points+contours[c].offset;uint32_t n=contours[c].count;
        if(polygon_contains(poly,n,point)){hit->inside=1;hit->distance=0;return SA_INK_OK;}
        for(uint32_t i=0;i<n;++i)hit->distance=min(hit->distance,point_distance(point,poly[i],poly[(i+1)%n]));
    }
    return SA_INK_OK;
}
} // extern C

static void sort(double *values,uint32_t n) {
    // In-place heapsort bounds worst-case work for highly intersecting masks.
    for(uint32_t start=n/2;start>0;--start) {
        uint32_t root=start-1;
        while(root*2+1<n){uint32_t child=root*2+1;if(child+1<n&&values[child]<values[child+1])++child;
            if(values[root]>=values[child])break;double t=values[root];values[root]=values[child];values[child]=t;root=child;}
    }
    for(uint32_t end=n;end>1;--end) {
        double t=values[0];values[0]=values[end-1];values[end-1]=t;uint32_t root=0;
        while(root*2+1<end-1){uint32_t child=root*2+1;if(child+1<end-1&&values[child]<values[child+1])++child;
            if(values[root]>=values[child])break;t=values[root];values[root]=values[child];values[child]=t;root=child;}
    }
}
static SAInkPoint along(SAInkPoint a,SAInkPoint b,double t){return {a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t};}
static uint32_t crossings(SAInkPoint a,SAInkPoint b,const SAInkPoint *p,const SAInkContour *contours,uint32_t n,double *out) {
    uint32_t count=0;out[count++]=0;out[count++]=1;
    for(uint32_t c=0;c<n;++c){const SAInkPoint *poly=p+contours[c].offset;uint32_t size=contours[c].count;
        for(uint32_t i=0;i<size;++i){double t;if(segment_crossing(a,b,poly[i],poly[(i+1)%size],&t))out[count++]=t;}}
    sort(out,count);return count;
}
extern "C" SAInkStatus sa_ink_segment_hit(const SAInkPoint *points,uint32_t point_count,const SAInkContour *contours,uint32_t contour_count,
    const SAInkPoint *mask_points,uint32_t mask_point_count,const SAInkContour *mask_contours,uint32_t mask_contour_count,
    double x0,double y0,double x1,double y1,double radius,double *scratch,uint32_t scratch_capacity,uint32_t *required_scratch,uint32_t *hit) {
    if(!hit||!required_scratch||!finite(x0)||!finite(y0)||!finite(x1)||!finite(y1)||!finite(radius)||radius<0||
       !contours_valid(points,point_count,contours,contour_count)||!contours_valid(mask_points,mask_point_count,mask_contours,mask_contour_count))return SA_INK_INVALID;
    uint32_t largest=0;for(uint32_t c=0;c<contour_count;++c)if(contours[c].count>largest)largest=contours[c].count;
    *required_scratch=mask_contours ? (mask_point_count>largest ? mask_point_count : largest)+2 : 0;
    if(scratch_capacity<*required_scratch)return SA_INK_CAPACITY;
    if(*required_scratch&&!scratch)return SA_INK_INVALID;
    *hit=0;SAInkPoint a={x0,y0},b={x1,y1};
    if(mask_contours&&!mask_contour_count)return SA_INK_OK;
    for(uint32_t c=0;c<contour_count;++c) {
        const SAInkPoint *poly=points+contours[c].offset;uint32_t n=contours[c].count;
        if(!n)continue;
        if((polygon_contains(poly,n,a)&&mask_contains(mask_points,mask_contours,mask_contour_count,a))||
           (polygon_contains(poly,n,b)&&mask_contains(mask_points,mask_contours,mask_contour_count,b))){*hit=1;return SA_INK_OK;}
        for(uint32_t i=0;i<n;++i) {
            SAInkPoint p=poly[i],q=poly[(i+1)%n];
            if(!mask_contours){if(segment_distance(a,b,p,q)<=radius){*hit=1;return SA_INK_OK;}continue;}
            uint32_t count=crossings(p,q,mask_points,mask_contours,mask_contour_count,scratch);
            for(uint32_t k=1;k<count;++k) {
                if(scratch[k]<=scratch[k-1])continue;
                SAInkPoint middle=along(p,q,(scratch[k]+scratch[k-1])/2);
                if(mask_contains(mask_points,mask_contours,mask_contour_count,middle)&&
                   segment_distance(a,b,along(p,q,scratch[k-1]),along(p,q,scratch[k]))<=radius){*hit=1;return SA_INK_OK;}
            }
        }
        // Mask boundaries inside paint also bound the clipped visible region.
        for(uint32_t m=0;m<mask_contour_count;++m) {
            const SAInkPoint *mask=mask_points+mask_contours[m].offset;uint32_t size=mask_contours[m].count;
            SAInkContour single={0,n};
            for(uint32_t i=0;i<size;++i) {
                SAInkPoint p=mask[i],q=mask[(i+1)%size];uint32_t count=crossings(p,q,poly,&single,1,scratch);
                for(uint32_t k=1;k<count;++k) {
                    if(scratch[k]<=scratch[k-1])continue;
                    SAInkPoint middle=along(p,q,(scratch[k]+scratch[k-1])/2);
                    if(!polygon_contains(poly,n,middle))continue;
                    double dx=q.x-p.x,dy=q.y-p.y,length=hypot(dx,dy);if(!length)continue;
                    double epsilon=max(1, max(abs(middle.x),abs(middle.y)))*1e-10;
                    SAInkPoint left={middle.x-dy/length*epsilon,middle.y+dx/length*epsilon},right={middle.x+dy/length*epsilon,middle.y-dx/length*epsilon};
                    if(!mask_contains(mask_points,mask_contours,mask_contour_count,left)&&!mask_contains(mask_points,mask_contours,mask_contour_count,right))continue;
                    if(segment_distance(a,b,along(p,q,scratch[k-1]),along(p,q,scratch[k]))<=radius){*hit=1;return SA_INK_OK;}
                }
            }
        }
    }
    return SA_INK_OK;
}
