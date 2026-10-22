#include "chunk-tree.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static void require(bool ok,const char*name){if(!ok){std::fprintf(stderr,"chunk failure %s\n",name);std::abort();}}
int main(){std::vector<uint64_t>memory(8*1024*1024/8);Context c;require(c.initialize(memory.data(),uint32_t(memory.size()*8),1000000000),"arena");{
 ChunkTree<uint32_t>tree(c);for(uint32_t i=0;i<4096;i++){Vector<uint32_t,1>v(c);v.push_back(i*2);v.push_back(i*2+1);require(tree.set(i,uint64_t(i)+1,1,v),"capture immutable chunk");}auto old=tree;tree.reset_metrics();Vector<uint32_t,1>changed(c);changed.push_back(123456);require(tree.set(2000,2001,2,changed),"single retained replacement");require(tree.created_nodes()<=14&&tree.visits()<=14,"bounded logarithmic changed path");require(tree.size()==8191&&old.size()==8192&&old[4000]==4000&&tree[4000]==123456,"rank and retained original");uint32_t same=0;for(uint32_t i=0;i<4096;i++)if(tree.same_chunk(i,old))++same;require(same==4095,"all unchanged chunk identities retained");uint32_t n=0;for(uint32_t value:old)require(value==n++,"ordered full export");require(n==8192,"complete full export");
 for(uint32_t i=0;i<4096;i+=2)require(tree.erase(i),"remove half chunks");require(tree.chunk_count()==2048&&tree.size()==4096,"rank metadata after remove");for(uint32_t i=0;i<4096;i++)if(i%2)require(tree.same_chunk(i,old),"remove does not clone other payload");
 std::vector<uint32_t>held;while(!c.status){auto p=c.allocate(32);if(p!=no_block)held.push_back(p);}require(c.status==SA_INK_CAPACITY,"actual memory exhausted");c.begin_work(1000000000);auto before=tree;require(!tree.set(2001,2002,3,changed)&&c.status==SA_INK_CAPACITY&&tree.same_chunk(2001,before),"allocation failure preserves actual prior chunk");for(auto p:held)c.release(p);c.begin_work(1000000000);require(tree.set(2001,2002,3,changed)&&before.same_chunk(2001,old),"same intent succeeds after freeing capacity");require(!c.status,"valid context");
 }require(c.live_bytes==0,"complete release");std::printf("BOUNDARY_RETAINED_CHUNKS_OK chunks=4096 unchanged=4095 changed_nodes<=14\n");}
