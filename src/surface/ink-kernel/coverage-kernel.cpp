#include "include/coverage-kernel.h"
#include "boundary/raw-coverage.hpp"
namespace {
using namespace showai_boundary;
constexpr uint64_t magic=0x5341434f56455231ull;
struct alignas(16) State {
    uint64_t tag=magic;uint32_t epoch=0,revision=0;bool busy=false;
    SACoverageBudget budget{};PolynomialContext math;RawCoverageMesh mesh;
    double bounds[4]{};uint32_t has_bounds=0,last_status=0,last_reason=0;
    uint64_t backing_bytes=0;
    explicit State(uint32_t e,const SACoverageBudget&b):epoch(e),budget(b),mesh(math.numbers){}
};
static_assert(sizeof(SACoverageVertex)==32&&__builtin_offsetof(SACoverageVertex,k)==16,"typed vertex ABI");
static_assert(sizeof(SACoverageDraw)==sizeof(BoundaryCoverageDraw),"draw ABI");
static_assert(sizeof(SACoverageCertificate)==sizeof(RawCoverageCertificate),"certificate ABI");
static_assert(sizeof(SACoverageOptions)==48&&sizeof(SACoverageBudget)==72&&sizeof(SACoverageSummary)==160&&sizeof(SACoverageDiagnostics)==56,"portable summary ABI");
bool aligned(const void*p,uint32_t alignment){return p&&!((uintptr_t)p&(alignment-1));}
bool accessible(const void*p,uint64_t bytes,uint32_t alignment){
    if(!bytes)return true;if(!aligned(p,alignment)||bytes>UINTPTR_MAX-(uintptr_t)p)return false;
#if defined(__wasm__)
    const uint64_t size=uint64_t(__builtin_wasm_memory_size(0))*65536;
    if((uintptr_t)p>size||bytes>size-(uintptr_t)p)return false;
#endif
    return true;
}
bool overlaps(const void*a,uint64_t an,const void*b,uint64_t bn){
    if(!an||!bn)return false;uint64_t A=(uintptr_t)a,B=(uintptr_t)b;
    return an>UINTPTR_MAX-A||bn>UINTPTR_MAX-B||(A<B+bn&&B<A+an);
}
State*state(void*p){if(!accessible(p,sizeof(State),16))return nullptr;auto*s=(State*)p;return s->tag==magic&&s->epoch?s:nullptr;}
bool outside(const State&s,const void*p,uint64_t bytes,uint32_t alignment){
    return accessible(p,bytes,alignment)&&!overlaps(p,bytes,&s,sizeof s)&&
        !overlaps(p,bytes,s.math.numbers.memory,s.backing_bytes);
}
bool valid(const State&s,SACoverageReceipt r){return !s.busy&&s.revision&&r.owner==(uint64_t)(uintptr_t)&s&&r.epoch==s.epoch&&r.revision==s.revision;}
SACoverageReceipt receipt(const State&s){return{(uint64_t)(uintptr_t)&s,s.epoch,s.revision};}
RawCoverageOptions options(const SACoverageOptions&o){
    RawCoverageOptions r;r.maximum_forward_norm=o.maximum_forward_norm;r.maximum_inverse_norm=o.maximum_inverse_norm;
    r.maximum_geometry_error_pixels=o.maximum_geometry_error_pixels;r.maximum_commands=o.maximum_commands;
    r.maximum_patches=o.maximum_patches;r.maximum_vertices=o.maximum_vertices;r.maximum_draws=o.maximum_draws;
    r.maximum_analytic_depth=o.maximum_analytic_depth;r.reserved=o.reserved;return r;
}
bool budget_valid(const SACoverageBudget&b,uint32_t bytes){
    const auto&o=b.geometry;
    return b.maximum_polynomial_operations&&b.maximum_limb_operations&&b.retained_bytes>=4096&&b.workspace_bytes>=4096&&
        uint64_t(b.retained_bytes)+b.workspace_bytes<=bytes&&finite_double(o.maximum_forward_norm)&&o.maximum_forward_norm>0&&
        finite_double(o.maximum_inverse_norm)&&o.maximum_inverse_norm>0&&finite_double(o.maximum_geometry_error_pixels)&&o.maximum_geometry_error_pixels>0&&
        o.maximum_commands&&o.maximum_commands<=100000&&o.maximum_patches&&o.maximum_patches<=100000&&
        o.maximum_vertices>=3&&o.maximum_vertices<=1000000&&o.maximum_draws&&o.maximum_draws<=333333&&
        o.maximum_analytic_depth&&o.maximum_analytic_depth<=32&&!o.reserved;
}
void command_bounds(const SAInkPathCommand*commands,uint32_t count,double out[4],uint32_t&has){
    has=0;for(uint32_t i=0;i<count;i++){
        uint32_t pairs=commands[i].operation==SA_INK_CLOSE?0:commands[i].operation==SA_INK_CUBIC?3:commands[i].operation==SA_INK_QUAD?2:1;
        for(uint32_t j=0;j<pairs;j++){double x=commands[i].values[j*2],y=commands[i].values[j*2+1];
            if(!has){out[0]=out[2]=x;out[1]=out[3]=y;has=1;}
            else{if(x<out[0])out[0]=x;if(y<out[1])out[1]=y;if(x>out[2])out[2]=x;if(y>out[3])out[3]=y;}
        }
    }
}
}
extern "C" {
uint32_t sa_coverage_state_bytes(){return sizeof(State);}
uint32_t sa_coverage_initialize(void*p,uint32_t state_bytes,uint32_t epoch,void*arena,uint32_t bytes,const SACoverageBudget*limits){
    if(!accessible(p,sizeof(State),16)||state_bytes<sizeof(State)||!epoch||!accessible(arena,bytes,16)||!accessible(limits,sizeof(*limits),8)||
       bytes<8192||bytes>0x40000000u||(bytes&(bytes-1))||overlaps(p,sizeof(State),arena,bytes)||
       overlaps(limits,sizeof(*limits),p,sizeof(State))||overlaps(limits,sizeof(*limits),arena,bytes))return SA_INK_INVALID;
    const auto captured=*limits;if(!budget_valid(captured,bytes)||((State*)p)->tag==magic)return SA_INK_INVALID;
    auto*s=::new(p)State(epoch,captured);s->backing_bytes=bytes;
    if(!s->math.numbers.initialize(arena,bytes,captured.maximum_limb_operations)){s->~State();for(uint32_t i=0;i<sizeof(State);i++)((uint8_t*)p)[i]=0;return SA_INK_INVALID;}
    s->math.polynomial.max_operations=captured.maximum_polynomial_operations;return SA_INK_OK;
}
uint32_t sa_coverage_prepare(void*p,const SAInkPathCommand*commands,uint32_t count,uint64_t generation,SACoverageReceipt*out){
    auto*s=state(p);if(!s||s->busy||!outside(*s,out,sizeof(*out),8)||!outside(*s,commands,uint64_t(count)*sizeof(*commands),8)||
       overlaps(out,sizeof(*out),commands,uint64_t(count)*sizeof(*commands))||count>s->budget.geometry.maximum_commands)return SA_INK_INVALID;
    if(s->revision==UINT32_MAX)return SA_INK_CAPACITY;
    s->busy=true;s->math.numbers.begin_work(s->budget.maximum_limb_operations);s->math.polynomial.operations=0;
    auto&ctx=s->math.numbers;const uint64_t baseline=ctx.live_bytes;ctx.peak_bytes=baseline;
    uint32_t result=SA_INK_OK;BoundaryKLMReason reason=boundary_klm_none;
    {
        RawCoverageMesh next(ctx);
        result=build_raw_coverage_mesh(s->math,commands,count,generation,options(s->budget.geometry),next,reason);
        if(!result&&ctx.status)result=ctx.status;
        if(!result&&(ctx.live_bytes-baseline>s->budget.retained_bytes||ctx.peak_bytes-ctx.live_bytes>s->budget.workspace_bytes))result=SA_INK_CAPACITY;
        if(!result){
            double bounds[4]{};uint32_t has=0;command_bounds(commands,count,bounds,has);
            s->mesh=static_cast<RawCoverageMesh&&>(next);for(uint32_t i=0;i<4;i++)s->bounds[i]=bounds[i];s->has_bounds=has;
            ++s->revision;*out=receipt(*s);
        }
    }
    s->last_status=result;s->last_reason=reason;s->busy=false;return result;
}
uint32_t sa_coverage_summary(void*p,SACoverageReceipt r,SACoverageSummary*out){
    auto*s=state(p);if(!s||!valid(*s,r)||!outside(*s,out,sizeof(*out),8))return SA_INK_INVALID;
    SACoverageSummary result{};result.receipt=r;result.source_generation=s->mesh.source_generation;
    result.vertices=s->mesh.mesh.vertices.size();result.draws=s->mesh.mesh.draws.size();result.has_bounds=s->has_bounds;
    for(uint32_t i=0;i<2;i++)result.common_origin[i]=s->mesh.mesh.common_origin[i];for(uint32_t i=0;i<4;i++)result.bounds[i]=s->bounds[i];
    copy_bytes(&result.certificate,&s->mesh.certificate,sizeof(result.certificate));*out=result;return SA_INK_OK;
}
uint32_t sa_coverage_copy_vertices(void*p,SACoverageReceipt r,SACoverageVertex*out,uint32_t capacity){
    auto*s=state(p);if(!s||!valid(*s,r)||!outside(*s,out,uint64_t(capacity)*sizeof(*out),4))return SA_INK_INVALID;
    const auto&values=static_cast<const RawCoverageMesh&>(s->mesh).mesh.vertices;if(capacity<values.size())return SA_INK_CAPACITY;
    for(uint32_t i=0;i<values.size();i++)copy_bytes(out+i,&values[i],sizeof(*out));return SA_INK_OK;
}
uint32_t sa_coverage_copy_draws(void*p,SACoverageReceipt r,SACoverageDraw*out,uint32_t capacity){
    auto*s=state(p);if(!s||!valid(*s,r)||!outside(*s,out,uint64_t(capacity)*sizeof(*out),8))return SA_INK_INVALID;
    const auto&values=static_cast<const RawCoverageMesh&>(s->mesh).mesh.draws;if(capacity<values.size())return SA_INK_CAPACITY;
    for(uint32_t i=0;i<values.size();i++)copy_bytes(out+i,&values[i],sizeof(*out));return SA_INK_OK;
}
uint32_t sa_coverage_diagnostics(void*p,SACoverageDiagnostics*out){
    auto*s=state(p);if(!s||s->busy||!outside(*s,out,sizeof(*out),8))return SA_INK_INVALID;
    *out={s->last_status,s->last_reason,s->math.polynomial.operations,s->math.numbers.work,s->math.numbers.live_bytes,s->math.numbers.peak_bytes,s->backing_bytes,s->math.numbers.bytes};return SA_INK_OK;
}
uint32_t sa_coverage_supports(const SACoverageCertificate*c,const double matrix[4]){
    if(!accessible(c,sizeof(*c),8)||!accessible(matrix,sizeof(double)*4,8))return 0;RawCoverageCertificate captured;copy_bytes(&captured,c,sizeof captured);return raw_coverage_supports(captured,matrix)?1u:0u;
}
uint32_t sa_coverage_destroy(void*p){
    auto*s=state(p);if(!s||s->busy)return SA_INK_INVALID;s->~State();for(uint32_t i=0;i<sizeof(State);i++)((uint8_t*)p)[i]=0;return SA_INK_OK;
}
}
