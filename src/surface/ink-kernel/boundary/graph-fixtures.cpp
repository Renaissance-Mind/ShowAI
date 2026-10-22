/* Host-only file transport for the actual source-curve fixture suite. No JSON
 * parser, oracle library or allocator enters the freestanding kernel. */
#include "graph.hpp"
#include <cstdio>
#include <vector>
#include <cstdlib>
#include <cmath>
using namespace showai_boundary;
static uint32_t u32(FILE*f){uint32_t v;if(std::fread(&v,4,1,f)!=1)std::abort();return v;}
static double f64(FILE*f){double v;if(std::fread(&v,8,1,f)!=1)std::abort();return v;}
int main(int argc,char**argv){if(argc!=2)return 1;FILE*f=std::fopen(argv[1],"rb");if(!f)return 2;if(u32(f)!=0x53414731)return 3;uint32_t n=u32(f),passed=0,pixels=0,memberships=0;for(uint32_t test=0;test<n;test++){
 uint32_t length=u32(f);std::vector<char>name(length+1);if(std::fread(name.data(),1,length,f)!=length)return 4;
 uint32_t pc=u32(f);std::vector<SABoundaryPath>paths(pc);std::vector<SABoundarySourceBlock>sources(pc);std::vector<SAInkPathCommand>commands;
 for(uint32_t i=0;i<pc;i++){paths[i].fill=u32(f);paths[i].role=i?1:0;auto&s=sources[i];s.key.words[0]=i+1;s.path_index=i;s.first_command=uint32_t(commands.size());s.command_count=u32(f);s.affine[0]=s.affine[3]=1;for(uint32_t j=0;j<s.command_count;j++){SAInkPathCommand cmd{};cmd.operation=u32(f);for(double&v:cmd.values)v=f64(f);commands.push_back(cmd);}}
 uint32_t queries=u32(f);std::vector<double>q(queries*5);for(double&v:q)v=f64(f);
 std::vector<uint64_t>memory(64*1024*1024/8);PolynomialContext c;c.numbers.initialize(memory.data(),uint32_t(memory.size()*8),10000000000ull);c.polynomial.max_operations=50000000;{
 SABoundaryBudget b{};b.max_commands=2048;b.max_curves=2048;b.max_pairs=100000;b.max_cuts=16384;b.max_edges=16384;b.max_sources=512;b.max_paths=8;
 Graph g(c,b);capture(g,paths.data(),pc,sources.data(),pc,commands.data(),uint32_t(commands.size()));construct(g);
 if(!g.good()){std::printf("FIXTURE %s status=%u stage=construct poly=%llu limb=%llu peak=%llu\n",name.data(),c.numbers.status,(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work,(unsigned long long)c.numbers.peak_bytes);return 5;}
 for(uint32_t i=0;i<queries;i++){auto v=area(g,Q::from_double(c.numbers,q[5*i]),Q::from_double(c.numbers,q[5*i+1]),Q::from_double(c.numbers,q[5*i+2]),Q::from_double(c.numbers,q[5*i+3]));double lo=lower(v.lower),hi=upper(v.upper),expected=q[5*i+4];if(!g.good()||lo>expected+1e-12||hi<expected-1e-12||hi-lo>1e-12){std::printf("FIXTURE %s status=%u stage=area query=%u range=%.17g %.17g expected=%.17g poly=%llu limb=%llu\n",name.data(),c.numbers.status,i,lo,hi,expected,(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work);return 6;}pixels++;}
 for(uint32_t y=0;y<9&&g.good();y++)for(uint32_t x=0;x<9&&g.good();x++){
  Point point{Q::from_signed(c.numbers,int64_t(x)*19+7)/Q(61),Q::from_signed(c.numbers,int64_t(y)*17+3)/Q(59)};
  bool original=filled(g,winding(g,point));int normalized=normalized_winding(g,point);
  if(normalized==-999)continue;
  if(!g.good()||normalized!=int(original)){std::printf("FIXTURE %s membership failure %u,%u actual=%d expected=%d status=%u\n",name.data(),x,y,normalized,int(original),c.numbers.status);return 8;}memberships++;
 }
 std::printf("FIXTURE %s OK curves=%u edges=%u pixels=%u poly=%llu limb=%llu peak=%llu\n",name.data(),g.curves.size(),g.edges.size(),queries,(unsigned long long)c.polynomial.operations,(unsigned long long)c.numbers.work,(unsigned long long)c.numbers.peak_bytes);std::fflush(stdout);
 }
 if(c.numbers.live_bytes)return 7;passed++;
 }std::fclose(f);std::printf("BOUNDARY_ORIGINAL_CURVE_FIXTURES_OK fixtures=%u pixels=%u memberships=%u\n",passed,pixels,memberships);}
