#include "graph.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static void require(bool b,const char*label,PolynomialContext&c){if(!b||c.numbers.status){std::fprintf(stderr,"closed block failure %s status=%u poly=%llu limb=%llu\n",label,c.numbers.status,(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work);std::abort();}}
int main(){constexpr uint32_t count=4096;std::vector<uint64_t>arena(128*1024*1024/8);PolynomialContext c;c.numbers.initialize(arena.data(),uint32_t(arena.size()*8),10000000000ull);c.polynomial.max_operations=50000000;{
 SABoundaryBudget budget{};budget.max_commands=count*5;budget.max_curves=count*4;budget.max_sources=count;budget.max_paths=1;budget.max_cuts=100000;budget.max_edges=100000;SABoundaryPath path{0,0,{0,0}};
 std::vector<SAInkPathCommand>commands;std::vector<SABoundarySourceBlock>sources(count);
 for(uint32_t i=0;i<count;i++){double x=double(i)*3;auto&s=sources[i];s.key.words[0]=(i+1)*2654435761u;s.command_count=5;s.first_command=i*5;s.affine[0]=s.affine[3]=1;commands.push_back({SA_INK_MOVE,0,{x,0}});commands.push_back({SA_INK_LINE,0,{x+1,0}});commands.push_back({SA_INK_LINE,0,{x+1,1}});commands.push_back({SA_INK_LINE,0,{x,1}});commands.push_back({SA_INK_CLOSE,0,{}});}
 Graph graph(c,budget);require(capture(graph,&path,1,sources.data(),count,commands.data(),uint32_t(commands.size())),"actual 4096 independently closed sources",c);
 auto query=[&](uint32_t index){Point p{Q::from_signed(c.numbers,int64_t(index)*6+1)/Q(2),Q::from_signed(c.numbers,1)/Q(2)};uint64_t before=graph.metrics.bvh_visits;auto result=winding(graph,p);require(result[0]==1,"original closed-chain exact winding",c);uint64_t visits=graph.metrics.bvh_visits-before;require(visits<=32,"spatial index avoids unrelated hash-interleaved blocks",c);return visits;};
 uint64_t visits=query(count-2);auto old=graph.block_tree;uint64_t allocations=c.numbers.allocations;graph.block_tree=set_block(c.numbers,graph.block_tree,sources[count-2].key,count-2,static_cast<const Graph&>(graph).blocks[count-2].bounds);require(graph.block_tree.valid(),"actual persistent source index fork",c);uint64_t path_nodes=c.numbers.allocations-allocations;require(path_nodes<=14,"bounded source-index branch clones",c);require(old.get()!=graph.block_tree.get(),"old root independent immutable branch",c);query(count-2);graph.block_tree=old;query(0);
 std::printf("BOUNDARY_CLOSED_BLOCK_4096_OK query_visits=%llu source_path_nodes=%llu curves=%u\n",(unsigned long long)visits,(unsigned long long)path_nodes,graph.curves.size());
 }require(c.numbers.live_bytes==0,"all actual captured source and spatial nodes released",c);}
