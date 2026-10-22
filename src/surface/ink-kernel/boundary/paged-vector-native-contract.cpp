#include "paged-vector.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static void require(bool b,const char*label){if(!b){std::fprintf(stderr,"paged source failure %s\n",label);std::abort();}}
int main(){std::vector<uint64_t>arena(4*1024*1024/8);Context c;c.initialize(arena.data(),uint32_t(arena.size()*8),1000000000);{
 PagedVector<uint32_t>source(c);for(uint32_t i=0;i<4096;i++)require(source.push_back(i*19),"actual retained source fill");const auto&original=source;uint64_t before=c.allocations;auto next=source;require(c.allocations==before,"fork retains one actual root");next[4001]=7;require(!c.status&&original[4001]==4001*19&&static_cast<const PagedVector<uint32_t>&>(next)[4001]==7,"point edit preserves captured original");uint64_t point=c.allocations-before;require(point<=5,"point edit clones only bounded radix path/page");
 std::vector<uint32_t>filled;while(!c.status){uint32_t p=c.allocate(64);if(p!=no_block)filled.push_back(p);}require(c.status==SA_INK_CAPACITY,"actual arena exhausted");c.begin_work(1000000000);auto failed=source;failed[1000]=1234;require(c.status==SA_INK_CAPACITY&&original[1000]==1000*19,"failed COW never changes captured source");for(uint32_t p:filled)c.release(p);c.begin_work(1000000000);failed[1000]=1234;require(!c.status&&static_cast<const PagedVector<uint32_t>&>(failed)[1000]==1234&&original[1000]==1000*19,"retry reuses intact old immutable tree");
 for(uint32_t i=0;i<4096;i++)require(original[i]==i*19,"full original unchanged after sparse fork/failure/retry");std::printf("BOUNDARY_PAGED_SOURCE_OK nodes_per_point=%llu\n",(unsigned long long)point);
 }require(c.live_bytes==0,"all retained page roots released");}
