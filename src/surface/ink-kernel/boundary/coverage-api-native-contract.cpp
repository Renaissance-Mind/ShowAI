#include "../include/coverage-kernel.h"
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cstring>
static void require(bool value,const char*message){if(!value){std::fprintf(stderr,"COVERAGE_API_FAILURE %s\n",message);std::abort();}}
struct Workspace {
    std::vector<uint64_t>state,arena;
    Workspace(uint32_t epoch):state((sa_coverage_state_bytes()+15)/8+2),arena(8*1024*1024/8){
        auto b=budget();require(sa_coverage_initialize(state.data(),uint32_t(state.size()*8),epoch,arena.data(),uint32_t(arena.size()*8),&b)==0,"actual workspace initialization");
    }
    static SACoverageBudget budget(){SACoverageBudget b{};b.maximum_polynomial_operations=5000000;b.maximum_limb_operations=100000000;
        b.retained_bytes=b.workspace_bytes=4*1024*1024;b.geometry={256,256,.02,100000,100000,100000,33333,16,0};return b;}
    ~Workspace(){require(sa_coverage_destroy(state.data())==0,"actual final workspace destruction");}
};
int main(){
    Workspace a(11),b(12);
    SAInkPathCommand rectangle[5]={{0,0,{0,0}},{1,0,{10,0}},{1,0,{10,10}},{1,0,{0,10}},{4,0,{}}};
    SACoverageReceipt first{},second{};require(sa_coverage_prepare(a.state.data(),rectangle,5,47,&first)==0,"real closed path build");
    SACoverageSummary summary{};require(sa_coverage_summary(a.state.data(),first,&summary)==0,"actual summary");
    require(summary.source_generation==47&&summary.vertices==6&&summary.draws==2&&summary.certificate.absolute_contribution_bound==2,"real typed hard fans");
    require(summary.has_bounds&&summary.bounds[0]==0&&summary.bounds[1]==0&&summary.bounds[2]==10&&summary.bounds[3]==10,"actual control hull");
    std::vector<SACoverageVertex>vertices(summary.vertices);std::vector<SACoverageDraw>draws(summary.draws);
    require(sa_coverage_copy_vertices(a.state.data(),first,vertices.data(),summary.vertices)==0&&sa_coverage_copy_draws(a.state.data(),first,draws.data(),summary.draws)==0,"actual typed mesh copy out");
    for(const auto&v:vertices)require(v.pad0==0&&v.pad1==0&&v.pad2==0&&v.k==0&&v.l==1&&v.m==1,"actual32B solid fields");
    auto before=vertices;std::memset(vertices.data(),0x5a,vertices.size()*sizeof(vertices[0]));
    require(sa_coverage_copy_vertices(a.state.data(),first,vertices.data(),summary.vertices-1)==2,"short output rejected");
    for(auto byte:std::vector<unsigned char>((unsigned char*)vertices.data(),(unsigned char*)vertices.data()+vertices.size()*sizeof(vertices[0])))require(byte==0x5a,"short output is atomic");
    require(sa_coverage_copy_vertices(a.state.data(),first,(SACoverageVertex*)a.arena.data(),summary.vertices)==1,"arena alias output refused");
    SACoverageSummary foreign{};require(sa_coverage_summary(b.state.data(),first,&foreign)==1,"actual foreign owner refused");
    auto broken=rectangle[1];rectangle[1].operation=99;SACoverageReceipt sentinel{0x5555,9,9},failure=sentinel;
    require(sa_coverage_prepare(a.state.data(),rectangle,5,48,&failure)==1&&!std::memcmp(&failure,&sentinel,sizeof failure),"failed build leaves output receipt intact");
    SACoverageSummary retained{};require(sa_coverage_summary(a.state.data(),first,&retained)==0&&!std::memcmp(&retained,&summary,sizeof summary),"failed build preserves old real summary");
    require(sa_coverage_copy_vertices(a.state.data(),first,vertices.data(),summary.vertices)==0&&!std::memcmp(vertices.data(),before.data(),before.size()*sizeof(before[0])),"failed build preserves old actual bytes");
    rectangle[1]=broken;rectangle[1].values[0]=20;rectangle[2].values[0]=20;
    require(sa_coverage_prepare(a.state.data(),rectangle,5,49,&second)==0,"actual rebuild after arithmetic/source failure");
    require(second.revision>first.revision&&sa_coverage_summary(a.state.data(),first,&retained)==1,"old workspace receipt cannot alias next result");
    require(sa_coverage_summary(a.state.data(),second,&summary)==0&&summary.bounds[2]==20,"actual second result");
    double identity[4]={1,0,0,1},outside[4]={1000,0,0,1000},singular[4]={1,0,0,0};
    require(sa_coverage_supports(&summary.certificate,identity)==1&&sa_coverage_supports(&summary.certificate,outside)==0&&sa_coverage_supports(&summary.certificate,singular)==0,"actual copied numeric certificate range");
    SACoverageDiagnostics diagnostic{};require(sa_coverage_diagnostics(a.state.data(),&diagnostic)==0&&diagnostic.last_status==0&&diagnostic.live_bytes>0&&diagnostic.backing_bytes==8388608&&diagnostic.usable_bytes==8388608,"actual arena diagnostics");
    std::puts("COVERAGE_ACTUAL_PUBLIC_API_OK");
}
