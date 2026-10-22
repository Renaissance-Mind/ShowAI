// Private test executable/module; no exports enter the product ABI.
#include "raw-coverage.hpp"
#ifdef SHOWAI_CHECKED_NATIVE_MAIN
#include <cstdio>
#include <type_traits>
static_assert(!std::is_copy_constructible<showai_analytic_internal::CheckedEmissionPlan>::value);
static_assert(!std::is_constructible<showai_analytic_internal::CheckedEmissionPlan,
    const SAInkPathCommand*,uint32_t,const double*,const SAAnalyticBudget*>::value);
#endif
using namespace showai_boundary;
using namespace showai_analytic_internal;
namespace {
alignas(16) unsigned char arena[8*1024*1024];
SAAnalyticPatch patches[256];
SAAnalyticVertex vertices[1024];
bool same(const void*a,const void*b,uint32_t n){auto*x=(const unsigned char*)a,*y=(const unsigned char*)b;for(uint32_t i=0;i<n;i++)if(x[i]!=y[i])return false;return true;}
}
extern "C" uint32_t checked_emission_contract(){
 SAInkPathCommand commands[]={{0,0,{-16,-8}},{2,0,{0,16,16,-8}},{4,0,{}}};
 const double matrix[6]={1,0,0,1,0,0};const SAAnalyticBudget budget{100000,100000,16,0};
 reset_walk_work();const RawAnalyticCapture captured(commands,3,matrix,&budget);
 if(captured.status()||walk_work().counts!=1||walk_work().emissions)return 1;
 auto required=captured.counts();if(!required.patches||!required.vertices)return 2;
 SAAnalyticCounts out{77,88,99,111},sentinel=out;
 SAAnalyticPatch oldPatch{};copy_bytes(&oldPatch,patches,sizeof oldPatch);
 if(captured.emit(patches,required.patches-1,vertices,1024,&out)!=SA_INK_CAPACITY||!same(&out,&sentinel,sizeof out)||!same(patches,&oldPatch,sizeof oldPatch)||walk_work().emissions)return 3;
 if(captured.emit(patches,256,vertices,required.vertices-1,&out)!=SA_INK_CAPACITY||!same(&out,&sentinel,sizeof out)||walk_work().emissions)return 4;
 // Actual original source/options and output-output alias checks occur before writes.
 if(captured.emit((SAAnalyticPatch*)commands,256,vertices,1024,&out)!=SA_INK_INVALID||walk_work().emissions)return 5;
 if(captured.emit((SAAnalyticPatch*)matrix,256,vertices,1024,&out)!=SA_INK_INVALID||walk_work().emissions)return 6;
 if(captured.emit((SAAnalyticPatch*)&budget,256,vertices,1024,&out)!=SA_INK_INVALID||walk_work().emissions)return 7;
 if(captured.emit(patches,256,(SAAnalyticVertex*)patches,1024,&out)!=SA_INK_INVALID||walk_work().emissions)return 8;
 if(captured.emit(patches,256,vertices,1024,(SAAnalyticCounts*)commands)!=SA_INK_INVALID||walk_work().emissions)return 9;
 if(captured.emit(patches,256,vertices,1024,(SAAnalyticCounts*)matrix)!=SA_INK_INVALID||walk_work().emissions)return 10;
 if(captured.emit(patches,256,vertices,1024,(SAAnalyticCounts*)&budget)!=SA_INK_INVALID||walk_work().emissions)return 11;
 if(captured.emit(patches,256,vertices,1024,(SAAnalyticCounts*)vertices)!=SA_INK_INVALID||walk_work().emissions)return 12;
 if(captured.emit(patches,256,vertices,1024,&out)||!same(&out,&required,sizeof out)||walk_work().counts!=1||walk_work().emissions!=1)return 13;
 SAAnalyticPatch expectedP[256];SAAnalyticVertex expectedV[1024];copy_bytes(expectedP,patches,required.patches*sizeof(*patches));copy_bytes(expectedV,vertices,required.vertices*sizeof(*vertices));
 reset_walk_work();if(sa_analytic_path_build(commands,3,matrix,&budget,patches,256,vertices,1024,&out)||walk_work().counts!=1||walk_work().emissions!=1||!same(expectedP,patches,required.patches*sizeof(*patches))||!same(expectedV,vertices,required.vertices*sizeof(*vertices)))return 14;
 // Reproduce the old raw-factory API sequence with the same actual source.
 reset_walk_work();if(sa_analytic_path_counts(commands,3,matrix,&budget,&out)||sa_analytic_path_build(commands,3,matrix,&budget,patches,256,vertices,1024,&out)||walk_work().counts!=2||walk_work().emissions!=1)return 20;
 // Public build still validates every independent source and complete budget.
 commands[1].reserved=1;reset_walk_work();if(sa_analytic_path_build(commands,3,matrix,&budget,patches,256,vertices,1024,&out)!=SA_INK_INVALID||walk_work().emissions)return 15;commands[1].reserved=0;
 SAAnalyticBudget limited=budget;limited.max_commands=2;reset_walk_work();if(sa_analytic_path_build(commands,3,matrix,&limited,patches,256,vertices,1024,&out)!=SA_INK_INVALID||walk_work().emissions)return 16;
 PolynomialContext context;if(!context.numbers.initialize(arena,sizeof arena,1000000000ull))return 17;
 {RawCoverageMesh result(context.numbers);BoundaryKLMReason reason;RawCoverageOptions options{256,256,.02,100000,100000,1000000,333333,16,0};reset_walk_work();if(build_raw_coverage_mesh(context,commands,3,42,options,result,reason)||walk_work().counts!=1||walk_work().emissions!=1)return 18;}
 if(context.numbers.live_bytes)return 19;
 return 0;
}
#ifdef SHOWAI_CHECKED_NATIVE_MAIN
int main(){auto result=checked_emission_contract();printf("CHECKED_EMISSION status=%u raw=count1+emit1 public=count1+emit1 oldFactory=count2+emit1\n",result);return result;}
#endif
