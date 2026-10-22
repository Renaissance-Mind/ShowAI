#include "graph.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static void require(bool b,const char*label,PolynomialContext&c){if(!b||c.numbers.status){std::fprintf(stderr,"graph failure %s status%d poly%llu limb%llu\n",label,int(c.numbers.status),(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work);std::abort();}}
static SABoundaryBudget limits(){SABoundaryBudget b{};b.max_commands=2048;b.max_curves=2048;b.max_pairs=100000;b.max_cuts=16384;b.max_edges=16384;b.max_sources=512;b.max_paths=8;b.max_polynomial_degree=64;b.max_stored_bits=16384;b.max_polynomial_operations=5000000;b.max_limb_operations=1000000000;return b;}
int main(){std::vector<uint64_t>memory(64*1024*1024/8);PolynomialContext c;c.numbers.initialize(memory.data(),uint32_t(memory.size()*8),1000000000);{
 SABoundaryPath path{0,0,{0,0}};SABoundarySourceBlock source{};source.key.words[0]=1;source.command_count=5;source.affine[0]=source.affine[3]=1;
 SAInkPathCommand commands[5]={{SA_INK_MOVE,0,{0,0}},{SA_INK_LINE,0,{1,0}},{SA_INK_LINE,0,{1,1}},{SA_INK_LINE,0,{0,1}},{SA_INK_CLOSE,0,{}}};
 Graph graph(c,limits());require(capture(graph,&path,1,&source,1,commands,5),"capture immutable square",c);construct(graph);require(graph.edges.size()==4,"exposed square",c);
 Point p{Q::from_signed(c.numbers,1)/Q(2),Q::from_signed(c.numbers,1)/Q(2)};require(normalized_winding(graph,p)==1,"normalized square interior",c);
 auto value=area(graph,Q(0),Q(0),Q(1),Q(1));require(value.lower==Q(1)&&value.upper==Q(1),"exact square Green area",c);
 }
 require(c.numbers.live_bytes==0,"all graph owned values released",c);std::printf("BOUNDARY_GRAPH_EXACT_OK poly=%llu limbs=%llu peak=%llu\n",(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work,(unsigned long long)c.numbers.peak_bytes);}
