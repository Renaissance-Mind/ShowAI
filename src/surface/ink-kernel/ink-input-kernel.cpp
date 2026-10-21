#include "include/ink-input-kernel.h"

// Independently implemented, versioned streaming geometry. No platform/runtime,
// allocator or recovered implementation source is part of this module.
namespace {
constexpr uint32_t MAGIC=0x53414931, NEIGHBORS=256, CONTEXT=5, FIT_LIMIT=200;
constexpr double PI=3.1415926535897932384626433832795;
struct XY { double x,y; };
struct State {
    uint32_t magic,capacity,actual,predicted,curves,finalized,changed,finished;
    uint32_t filtered_work,fit_work,generation,reserved;
    SAInkInputConfig config;
};
static uint32_t aligned(uint32_t n){return (n+7u)&~7u;}
static bool finite(double n){return __builtin_isfinite(n);}
static double abs(double n){return n<0?-n:n;}
static double min(double a,double b){return a<b?a:b;}
static double max(double a,double b){return a>b?a:b;}
static double clamp(double n,double a,double b){return min(b,max(a,n));}
static double length(XY p){double x=abs(p.x),y=abs(p.y);if(x<y){double t=x;x=y;y=t;}if(!x)return 0;double r=y/x;return x*__builtin_sqrt(1+r*r);}
static XY add(XY a,XY b){return {a.x+b.x,a.y+b.y};}
static XY sub(XY a,XY b){return {a.x-b.x,a.y-b.y};}
static XY mul(XY p,double n){return {p.x*n,p.y*n};}
static double dot(XY a,XY b){return a.x*b.x+a.y*b.y;}
static XY unit(XY p){double n=length(p);return n?mul(p,1/n):XY{0,0};}
// Inputs are [0,pi/2]. Fixed-order Taylor arithmetic avoids native/Wasm libm
// differences. atan reduces to |z|<=tan(pi/8) before a convergent series.
static double cosine(double x){double z=x*x,term=1,result=1;for(uint32_t i=1;i<=14;i++){term*= -z/((2.0*i-1)*(2.0*i));result+=term;}return max(0,result);}
static double arctan(double z){bool reciprocal=z>1;if(reciprocal)z=1/z;bool shift=z>0.4142135623730950488;if(shift)z=(z-1)/(z+1);double zz=z*z,term=z,result=z;for(uint32_t i=1;i<32;i++){term*= -zz;result+=term/(2.0*i+1);}if(shift)result+=PI/4;return reciprocal?PI/2-result:result;}
static double angle(XY p){if(!p.x)return p.y>0?PI/2:p.y<0?-PI/2:0;double a=arctan(abs(p.y/p.x));if(p.x<0)a=PI-a;return p.y<0?-a:a;}
static SAInkInputPoint *raw(State *s){return (SAInkInputPoint*)((uint8_t*)s+aligned(sizeof(State)));}
static const SAInkInputPoint *raw(const State *s){return raw((State*)s);}
static XY *jitter(State *s){return (XY*)(raw(s)+s->capacity+SA_INK_INPUT_MAX_PREDICTED);}
static SAInkSample *filtered(State *s){return (SAInkSample*)(jitter(s)+s->capacity+SA_INK_INPUT_MAX_PREDICTED);}
static const SAInkSample *filtered(const State *s){return filtered((State*)s);}
static SAInkInputCurve *curves(State *s){return (SAInkInputCurve*)(filtered(s)+s->capacity+SA_INK_INPUT_MAX_PREDICTED);}
static const SAInkInputCurve *curves(const State *s){return curves((State*)s);}
static uint32_t total(const State *s){return s->actual+s->predicted;}
static const SAInkInputPoint &point(const State *s,uint32_t i){return raw(s)[i<s->actual?i:s->capacity+i-s->actual];}
static XY location(const SAInkInputPoint &p){return {p.x,p.y};}
static bool valid(const State *s){return s&&s->magic==MAGIC&&s->capacity&&s->capacity<=SA_INK_INPUT_MAX_RAW;}
static bool valid(const SAInkInputPoint &p){return finite(p.x)&&finite(p.y)&&abs(p.x)<=1e6&&abs(p.y)<=1e6&&finite(p.time)&&p.time>=0&&p.time<=1e6&&finite(p.force)&&p.force>=0&&p.force<=100&&finite(p.azimuth)&&abs(p.azimuth)<=100&&finite(p.altitude)&&abs(p.altitude)<=100&&p.expected_properties<=7&&p.flags<=1;}
static bool valid(const SAInkInputConfig &c){
    const double *v=&c.width;for(uint32_t i=0;i<13;i++)if(!finite(v[i]))return false;
    return c.version==SA_INK_INPUT_VERSION&&c.mode<=SA_INPUT_CALLIGRAPHY&&c.width>=.5&&c.width<=40&&c.creation_zoom>=.001&&c.creation_zoom<=1024&&c.fit_tolerance>=1e-6&&c.fit_tolerance<=1e4&&c.flatten_tolerance>=1e-6&&c.flatten_tolerance<=1e4&&c.position_window>=0&&c.position_window<=1&&c.jitter_window>=0&&c.jitter_window<=1&&c.force_backward>=0&&c.force_backward<=1e4&&c.force_forward>=0&&c.force_forward<=1e4&&c.force_time>=0&&c.force_time<=1&&c.min_fraction>=0&&c.min_fraction<=10&&c.max_fraction>=c.min_fraction&&c.max_fraction<=10&&c.curve_blend>=0&&c.curve_blend<=1&&c.estimate_timeout>=0&&c.estimate_timeout<=10;
}
static uint32_t affected(const State *s){
    if(!s->actual)return 0;
    if(s->config.mode==SA_INPUT_CALLIGRAPHY&&s->actual<=NEIGHBORS*2+CONTEXT)return 0;
    uint32_t i=s->actual-1,steps=0;double distance=0;
    double window=max(s->config.jitter_window,s->config.force_time);
    while(i&&steps<NEIGHBORS){
        double dt=point(s,s->actual-1).time-point(s,i-1).time;
        distance+=length(sub(location(point(s,i)),location(point(s,i-1))));
        if(dt>window&&distance>s->config.force_forward)break;
        --i;++steps;
    }
    return i;
}
static double referenceTime(const State *s,uint32_t i){return !i&&total(s)>1?max(point(s,0).time,point(s,1).time-1.0/60):point(s,i).time;}
static XY positionAverage(State *s,uint32_t i,double window,bool forward,bool useJitter){
    if(!(window>0))return useJitter?jitter(s)[i]:location(point(s,i));
    double ref=referenceTime(s,i),weight=0;XY result{0,0};uint32_t n=total(s);
    for(uint32_t k=0;k<=NEIGHBORS&&k<=i;k++){
        uint32_t j=i-k;double dt=ref-referenceTime(s,j);if(dt>window)break;
        double w=cosine(abs(dt)*PI/(2*window));XY p=useJitter?jitter(s)[j]:location(point(s,j));result=add(result,mul(p,w));weight+=w;
    }
    if(forward)for(uint32_t k=1;k<=NEIGHBORS&&i+k<n;k++){
        uint32_t j=i+k;double dt=point(s,j).time-ref;if(dt>window)break;
        double w=cosine(abs(dt)*PI/(2*window));XY p=useJitter?jitter(s)[j]:location(point(s,j));result=add(result,mul(p,w));weight+=w;
    }
    return weight>0?mul(result,1/weight):(useJitter?jitter(s)[i]:location(point(s,i)));
}
struct ForceCandidate{double distance,time,value,mass;XY direction;};
static double forceUncapped(const State *s,uint32_t i){
    ForceCandidate candidates[NEIGHBORS*2];uint32_t count=0,n=total(s);double ref=referenceTime(s,i);
    XY direction{0,0};if(i)direction=unit(sub(location(point(s,i)),location(point(s,i-1))));
    if(!length(direction)&&i+1<n)direction=unit(sub(location(point(s,i+1)),location(point(s,i))));
    for(uint32_t side=0;side<2;side++){
        double distance=0,window=side?s->config.force_forward:s->config.force_backward;
        for(uint32_t k=0;k<NEIGHBORS;k++){
            if((!side&&k>=i)||(side&&i+k+1>=n))break;
            uint32_t j=side?i+k+1:i-k;const auto &p=point(s,j);double dt=abs(p.time-ref);
            if(distance>window&&(!(s->config.force_time>0)||dt>s->config.force_time))break;
            XY delta=sub(location(p),location(point(s,j-1)));double mass=length(delta);
            if(mass){double value=p.force;if(s->config.mode==SA_INPUT_CALLIGRAPHY){double theta=angle(delta);value=clamp(min(theta,PI-theta)/(PI/2),0,1);}candidates[count++]={distance,dt,value,mass,mul(delta,1/mass)};}
            distance+=mass;
        }
    }
    if(!count)return 1;
    double dmax=0,tmax=0;for(uint32_t j=0;j<count;j++){dmax=max(dmax,candidates[j].distance);tmax=max(tmax,candidates[j].time);}
    if(!dmax&&!tmax){double sum=0;for(uint32_t j=0;j<count;j++)sum+=candidates[j].value;return sum/count;}
    double sum=0,weight=0;
    for(uint32_t j=0;j<count;j++){
        auto &c=candidates[j];double w=dmax>0?cosine(c.distance*PI/(2*dmax)):1;
        if(s->config.force_time>0&&tmax>0)w=min(w,cosine(c.time*PI/(2*tmax)));
        if(length(direction)){double d=dot(direction,c.direction);double a=d>=0?1:d<=-.85?.01:.01+.99*((d+.85)/.85)*((d+.85)/.85);w*=a;}
        w*=c.mass;sum+=w*c.value;weight+=w;
    }
    return weight>0?sum/weight:1;
}
static double calligraphyValue(const State *s,uint32_t i){
    double value=forceUncapped(s,i);uint32_t n=total(s);if(!s->config.force_forward||n<2)return value;
    // Bounded tip walks: unlike the reference's full-history boundary scan,
    // constant work is guaranteed for extremely dense stationary input.
    uint32_t left=1,right=n-2;double d=0;uint32_t k=0;
    for(;left<n-1&&k<NEIGHBORS;left++,k++){d+=length(sub(location(point(s,left)),location(point(s,left-1))));if(d>=s->config.force_forward)break;}
    d=0;k=0;for(;right>0&&k<NEIGHBORS;right--,k++){d+=length(sub(location(point(s,right+1)),location(point(s,right))));if(d>=s->config.force_forward)break;}
    if(i>=left&&i<=right)return value;
    uint32_t anchor=right<left?(n-1)/2:i<left?left:right;
    return min(value,forceUncapped(s,anchor));
}
static void filter(State *s,uint32_t first){
    for(uint32_t i=first;i<total(s);i++)jitter(s)[i]=positionAverage(s,i,s->config.jitter_window,true,false);
    for(uint32_t i=first;i<total(s);i++){
        const auto &r=point(s,i);XY p=positionAverage(s,i,s->config.position_window,false,true);double fraction=1;
        if(s->config.mode==SA_INPUT_PRESSURE)fraction=max(0,1+.67*(r.force-.7));
        else if(s->config.mode==SA_INPUT_CALLIGRAPHY){double f=calligraphyValue(s,i),c=s->config.curve_blend;fraction=s->config.min_fraction+(s->config.max_fraction-s->config.min_fraction)*clamp((1-c)*f+c*(3*f*f-2*f*f*f),0,1);}
        auto &v=filtered(s)[i].values;v[0]=p.x;v[1]=p.y;v[2]=r.time;v[3]=v[4]=min(1e4,s->config.width*fraction);v[5]=1;v[6]=r.force;v[7]=r.azimuth;v[8]=r.altitude;++s->filtered_work;
    }
}
static XY xy(const State *s,uint32_t i){auto &v=filtered(s)[i].values;return {v[0],v[1]};}
static XY evaluate(const SAInkInputCurve &c,double t){double u=1-t;return {u*u*u*c.points[0]+3*u*u*t*c.points[2]+3*u*t*t*c.points[4]+t*t*t*c.points[6],u*u*u*c.points[1]+3*u*u*t*c.points[3]+3*u*t*t*c.points[5]+t*t*t*c.points[7]};}
static bool solve(double a[3][4],uint32_t n,double *out){
    for(uint32_t col=0;col<n;col++){uint32_t pivot=col;for(uint32_t r=col+1;r<n;r++)if(abs(a[r][col])>abs(a[pivot][col]))pivot=r;
        if(abs(a[pivot][col])<1e-12)return false;
        if(pivot!=col)for(uint32_t k=col;k<=n;k++){double t=a[col][k];a[col][k]=a[pivot][k];a[pivot][k]=t;}
        double scale=a[col][col];for(uint32_t k=col;k<=n;k++)a[col][k]/=scale;
        for(uint32_t r=0;r<n;r++)if(r!=col){double f=a[r][col];for(uint32_t k=col;k<=n;k++)a[r][k]-=f*a[col][k];}
    }
    for(uint32_t i=0;i<n;i++)out[i]=a[i][n];return true;
}
static SAInkInputCurve fit(State *s,uint32_t first,uint32_t last,XY tangent){
    ++s->fit_work;SAInkInputCurve c{};c.first_raw=first;c.last_raw=last;XY p0=xy(s,first),p3=xy(s,last),delta=sub(p3,p0);XY p1=mul(delta,1.0/3),p2=mul(delta,2.0/3);tangent=unit(tangent);
    uint32_t begin=first>CONTEXT?first-CONTEXT:0,end=last+CONTEXT<total(s)?last+CONTEXT:total(s)-1;
    // Small coordinate-relative normal equations. A tangent constraint is part
    // of the solve and error test, rather than unchecked post-fit projection.
    double ax[3][4]{},ay[3][4]{};bool constrained=length(tangent)>0;
    for(uint32_t i=begin;i<=end;i++){
        double t=double(int64_t(i)-first)/(last-first),u=1-t,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t;XY q=sub(sub(xy(s,i),p0),mul(delta,b3));
        if(constrained){double bx[3]={b1*tangent.x,b2,0},by[3]={b1*tangent.y,0,b2};for(uint32_t r=0;r<3;r++){for(uint32_t k=0;k<3;k++)ax[r][k]+=bx[r]*bx[k]+by[r]*by[k];ax[r][3]+=bx[r]*q.x+by[r]*q.y;}}
        else {double b[2]={b1,b2};for(uint32_t r=0;r<2;r++){for(uint32_t k=0;k<2;k++){ax[r][k]+=b[r]*b[k];ay[r][k]+=b[r]*b[k];}ax[r][2]+=b[r]*q.x;ay[r][2]+=b[r]*q.y;}}
    }
    double x[3]{},y[3]{};
    if(constrained){if(solve(ax,3,x)){p1=mul(tangent,max(0,x[0]));p2={x[1],x[2]};}}
    else if(solve(ax,2,x)&&solve(ay,2,y)){p1={x[0],y[0]};p2={x[1],y[1]};}
    p1=add(p0,p1);p2=add(p0,p2);double v[8]={p0.x,p0.y,p1.x,p1.y,p2.x,p2.y,p3.x,p3.y};for(uint32_t i=0;i<8;i++)c.points[i]=v[i];
    return c;
}
static double error(const State *s,const SAInkInputCurve &c){double e=0;for(uint32_t i=c.first_raw;i<=c.last_raw;i++)e=max(e,length(sub(evaluate(c,double(i-c.first_raw)/(c.last_raw-c.first_raw)),xy(s,i))));return e;}
static uint32_t steps(const State *s,const SAInkInputCurve &c){
    XY a{c.points[0]-2*c.points[2]+c.points[4],c.points[1]-2*c.points[3]+c.points[5]},b{c.points[2]-2*c.points[4]+c.points[6],c.points[3]-2*c.points[5]+c.points[7]};
    double required=__builtin_sqrt(.75*max(length(a),length(b))/s->config.flatten_tolerance);uint32_t n=(uint32_t)required;if(n<required)++n;uint32_t span=c.last_raw-c.first_raw;n=n<span?span:n;
    return ((n+span-1)/span)*span;
}
static uint32_t curveForRaw(const State *s,uint32_t index){uint32_t lo=0,hi=s->curves;while(lo<hi){uint32_t m=lo+(hi-lo)/2;if(curves(s)[m].last_raw<index)lo=m+1;else hi=m;}return lo;}
static void rebuild(State *s,uint32_t dirty,bool finishing){
    s->filtered_work=s->fit_work=0;uint32_t n=total(s);if(!n){s->curves=s->finalized=s->changed=0;++s->generation;return;}
    filter(s,dirty);uint32_t dependency=dirty>CONTEXT?dirty-CONTEXT:0;uint32_t changed=s->curves?curveForRaw(s,dependency):0;
    if(changed>=s->curves&&s->curves)changed=s->curves-1;
    if(changed>s->curves)changed=s->curves;
    uint32_t first=changed<s->curves?curves(s)[changed].first_raw:0;s->curves=changed;s->changed=changed;if(s->finalized>changed)s->finalized=changed;
    XY tangent{0,0};if(changed){auto &p=curves(s)[changed-1];tangent={p.points[6]-p.points[4],p.points[7]-p.points[5]};}
    uint32_t offset=changed?curves(s)[changed-1].sample_offset+curves(s)[changed-1].steps:1;
    while(first+1<n){
        uint32_t last=min(n-1,first+FIT_LIMIT-1);SAInkInputCurve c=fit(s,first,last,tangent);
        if(error(s,c)>s->config.fit_tolerance){uint32_t lo=first+1,hi=last;SAInkInputCurve best=fit(s,first,lo,tangent);while(lo+1<hi){uint32_t mid=lo+(hi-lo)/2;auto q=fit(s,first,mid,tangent);if(error(s,q)<=s->config.fit_tolerance){lo=mid;best=q;}else hi=mid;}c=best;last=lo;}
        c.steps=steps(s,c);c.sample_offset=offset;c.flags=last>=s->actual?1:0;offset+=c.steps;curves(s)[s->curves++]=c;tangent={c.points[6]-c.points[4],c.points[7]-c.points[5]};first=last;
    }
    uint32_t stable=finishing?s->actual:affected(s);double now=point(s,n-1).time;
    while(s->finalized<s->curves){auto &c=curves(s)[s->finalized];if(c.last_raw>=s->actual||(!finishing&&c.last_raw+CONTEXT>=stable))break;bool ready=true;
        for(uint32_t i=c.first_raw;i<=c.last_raw;i++){auto &p=point(s,i);if(p.expected_properties&&!(p.flags&1)&&now-p.time<s->config.estimate_timeout){ready=false;break;}}
        if(!ready)break;++s->finalized;
    }
    ++s->generation;
}
static uint32_t sampleCount(const State *s){return !total(s)?0:s->curves?curves(s)[s->curves-1].sample_offset+curves(s)[s->curves-1].steps:1;}
}

extern "C" {
uint32_t sa_input_sizeof_point(){return sizeof(SAInkInputPoint);}uint32_t sa_input_sizeof_config(){return sizeof(SAInkInputConfig);}uint32_t sa_input_sizeof_curve(){return sizeof(SAInkInputCurve);}uint32_t sa_input_sizeof_snapshot(){return sizeof(SAInkInputSnapshot);}
uint32_t sa_input_state_bytes(uint32_t capacity){if(!capacity||capacity>SA_INK_INPUT_MAX_RAW)return 0;return aligned(sizeof(State))+(capacity+SA_INK_INPUT_MAX_PREDICTED)*(sizeof(SAInkInputPoint)+sizeof(XY)+sizeof(SAInkSample)+sizeof(SAInkInputCurve));}
SAInkStatus sa_input_initialize(void *p,uint32_t bytes,uint32_t capacity,const SAInkInputConfig *config){if(!p||((uintptr_t)p&7)||!config||!valid(*config))return SA_INK_INVALID;uint32_t needed=sa_input_state_bytes(capacity);if(!needed||bytes<needed)return SA_INK_CAPACITY;State *s=(State*)p;*s={};s->magic=MAGIC;s->capacity=capacity;s->config=*config;return SA_INK_OK;}
SAInkStatus sa_input_relocate(const void *p,void *q,uint32_t bytes,uint32_t capacity){auto *s=(const State*)p;if(!valid(s)||!q||p==q||capacity<s->actual||capacity<s->capacity)return SA_INK_INVALID;SAInkStatus status=sa_input_initialize(q,bytes,capacity,&s->config);if(status!=SA_INK_OK)return status;auto *d=(State*)q;*d=*s;d->capacity=capacity;for(uint32_t i=0;i<s->actual;i++)raw(d)[i]=raw(s)[i];for(uint32_t i=0;i<s->predicted;i++)raw(d)[capacity+i]=raw(s)[s->capacity+i];for(uint32_t i=0;i<total(s);i++){jitter(d)[i]=jitter((State*)s)[i];filtered(d)[i]=filtered(s)[i];}for(uint32_t i=0;i<s->curves;i++)curves(d)[i]=curves(s)[i];return SA_INK_OK;}
SAInkStatus sa_input_push(void *p,const SAInkInputPoint *a,uint32_t count,const SAInkInputPoint *prediction,uint32_t predicted){auto *s=(State*)p;if(!valid(s)||(count&&!a)||(predicted&&!prediction)||s->finished)return SA_INK_INVALID;if(count>s->capacity-s->actual||predicted>SA_INK_INPUT_MAX_PREDICTED)return SA_INK_CAPACITY;
    double time=s->actual?point(s,s->actual-1).time:0;uint32_t id=s->actual?point(s,s->actual-1).id:0;
    for(uint32_t i=0;i<count;i++){if(!valid(a[i])||a[i].time<time||a[i].id<=id)return SA_INK_INVALID;time=a[i].time;id=a[i].id;}
    for(uint32_t i=0;i<predicted;i++){if(!valid(prediction[i])||prediction[i].time<time)return SA_INK_INVALID;time=prediction[i].time;}
    uint32_t dirty=affected(s);for(uint32_t i=0;i<count;i++)raw(s)[s->actual+i]=a[i];s->actual+=count;for(uint32_t i=0;i<predicted;i++)raw(s)[s->capacity+i]=prediction[i];s->predicted=predicted;rebuild(s,dirty,false);return SA_INK_OK;
}
SAInkStatus sa_input_correct(void *p,const SAInkInputPoint *replacement){auto *s=(State*)p;if(!valid(s)||!replacement||!valid(*replacement))return SA_INK_INVALID;uint32_t lo=0,hi=s->actual;while(lo<hi){uint32_t m=lo+(hi-lo)/2;if(point(s,m).id<replacement->id)lo=m+1;else hi=m;}if(lo==s->actual||point(s,lo).id!=replacement->id)return SA_INK_RANGE;if(replacement->time!=point(s,lo).time)return SA_INK_INVALID;raw(s)[lo]=*replacement;rebuild(s,lo>NEIGHBORS*2?lo-NEIGHBORS*2:0,s->finished);return SA_INK_OK;}
SAInkStatus sa_input_finish(void *p){auto *s=(State*)p;if(!valid(s)||!s->actual)return SA_INK_INVALID;uint32_t dirty=affected(s);s->predicted=0;s->finished=1;rebuild(s,dirty,true);return SA_INK_OK;}
SAInkStatus sa_input_snapshot(const void *p,SAInkInputSnapshot *out){auto *s=(const State*)p;if(!valid(s)||!out)return SA_INK_INVALID;uint32_t count=sampleCount(s);*out={s->actual,s->predicted,s->curves,s->finalized,s->changed,count,count<2?count:1+(count-2)/(SA_INK_INPUT_FRAGMENT_SAMPLES-1),s->finished,s->filtered_work,s->fit_work,s->generation,0};return SA_INK_OK;}
SAInkStatus sa_input_copy_raw(const void *p,uint32_t start,uint32_t count,SAInkInputPoint *out,uint32_t capacity){auto *s=(const State*)p;if(!valid(s)||start>s->actual||count>s->actual-start||(count&&!out))return SA_INK_INVALID;if(capacity<count)return SA_INK_CAPACITY;for(uint32_t i=0;i<count;i++)out[i]=point(s,start+i);return SA_INK_OK;}
SAInkStatus sa_input_copy_curves(const void *p,uint32_t start,uint32_t count,SAInkInputCurve *out,uint32_t capacity){auto *s=(const State*)p;if(!valid(s)||start>s->curves||count>s->curves-start||(count&&!out))return SA_INK_INVALID;if(capacity<count)return SA_INK_CAPACITY;for(uint32_t i=0;i<count;i++)out[i]=curves(s)[start+i];return SA_INK_OK;}
SAInkStatus sa_input_copy_samples(const void *p,uint32_t start,uint32_t count,SAInkSample *out,uint32_t capacity){auto *s=(const State*)p;if(!valid(s)||start>sampleCount(s)||count>sampleCount(s)-start||(count&&!out))return SA_INK_INVALID;if(capacity<count)return SA_INK_CAPACITY;
    uint32_t curve=0;if(start&&s->curves){uint32_t lo=0,hi=s->curves;while(lo<hi){uint32_t m=lo+(hi-lo)/2;if(curves(s)[m].sample_offset+curves(s)[m].steps<=start)lo=m+1;else hi=m;}curve=lo;}
    for(uint32_t i=0;i<count;i++){uint32_t index=start+i;if(!index){out[i]=filtered(s)[0];continue;}while(curve+1<s->curves&&index>=curves(s)[curve].sample_offset+curves(s)[curve].steps)++curve;auto &c=curves(s)[curve];double t=double(index-c.sample_offset+1)/c.steps;XY pos=evaluate(c,t);double at=c.first_raw+t*(c.last_raw-c.first_raw);uint32_t a=(uint32_t)at;if(a>c.last_raw)a=c.last_raw;uint32_t b=a<c.last_raw?a+1:a;double f=at-a;for(uint32_t k=0;k<9;k++)out[i].values[k]=filtered(s)[a].values[k]+(filtered(s)[b].values[k]-filtered(s)[a].values[k])*f;out[i].values[0]=pos.x;out[i].values[1]=pos.y;}
    return SA_INK_OK;
}
SAInkStatus sa_input_fragment_range(const void *p,uint32_t fragment,uint32_t *start,uint32_t *count){auto *s=(const State*)p;if(!valid(s)||!start||!count||!s->finished)return SA_INK_INVALID;uint32_t n=sampleCount(s),fragments=n<2?n:1+(n-2)/(SA_INK_INPUT_FRAGMENT_SAMPLES-1);if(fragment>=fragments)return SA_INK_RANGE;uint32_t offset=fragment*(SA_INK_INPUT_FRAGMENT_SAMPLES-1);*start=offset;*count=n-offset>SA_INK_INPUT_FRAGMENT_SAMPLES?SA_INK_INPUT_FRAGMENT_SAMPLES:n-offset;return SA_INK_OK;}
}
