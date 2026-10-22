/* Actual original-curve fixture transport. No expected mesh, image or mocked
 * geometry participates in the retained-vs-independent-full comparison. */
#include "source-delta.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
using namespace showai_boundary;
static uint32_t u32(FILE*f){uint32_t v;if(std::fread(&v,4,1,f)!=1)std::abort();return v;}
static double f64(FILE*f){double v;if(std::fread(&v,8,1,f)!=1)std::abort();return v;}
int main(int argc,char**argv){if(argc!=2)return 1;FILE*f=std::fopen(argv[1],"rb");if(!f||u32(f)!=0x53414731)return 2;uint32_t count=u32(f),passed=0,pixels=0,points=0;uint64_t classifications=0,reused=0;
 for(uint32_t test=0;test<count;test++){
  uint32_t len=u32(f);std::vector<char>name(len+1);if(std::fread(name.data(),1,len,f)!=len)return 3;
  uint32_t path_count=u32(f);std::vector<SABoundaryPath>paths(path_count);std::vector<SABoundarySourceBlock>sources;std::vector<SAInkPathCommand>commands;
  for(uint32_t p=0;p<path_count;p++){
   paths[p].fill=u32(f);paths[p].role=p?1:0;uint32_t n=u32(f),first=uint32_t(commands.size());
   for(uint32_t i=0;i<n;i++){SAInkPathCommand cmd{};cmd.operation=u32(f);for(double&v:cmd.values)v=f64(f);commands.push_back(cmd);}
   uint32_t start=first;bool open=false;auto emit=[&](uint32_t end){SABoundarySourceBlock s{};s.key.words[0]=uint32_t(sources.size()+1);s.key.words[1]=p;s.path_index=p;s.first_command=start;s.command_count=end-start;s.affine[0]=s.affine[3]=1;sources.push_back(s);};
   for(uint32_t i=first;i<first+n;i++){if(commands[i].operation==SA_INK_MOVE){if(open)emit(i);start=i;open=true;}if(commands[i].operation==SA_INK_CLOSE&&open){emit(i+1);open=false;}}
   if(open)emit(first+n);
  }
  uint32_t query_count=u32(f);std::vector<double>queries(query_count*5);for(double&v:queries)v=f64(f);
  std::vector<uint64_t>arena(128*1024*1024/8);PolynomialContext c;c.numbers.initialize(arena.data(),uint32_t(arena.size()*8),20000000000ull);c.polynomial.max_operations=50000000;{
   SABoundaryBudget b{};b.max_commands=4096;b.max_curves=4096;b.max_sources=1024;b.max_paths=8;b.max_pairs=100000;b.max_cuts=65536;b.max_edges=65536;
   Graph old(c,b);capture(old,paths.data(),path_count,sources.data(),uint32_t(sources.size()),commands.data(),uint32_t(commands.size()));construct(old);if(!old.good()){std::printf("DELTA %s status=%u stage=base\n",name.data(),c.numbers.status);return 4;}
   Graph delta=old;SABoundarySourceBlock change=sources.back();change.affine[4]=1.0/32;SourceDirty dirty(c.numbers);upsert_source(delta,change,commands.data(),uint32_t(commands.size()),dirty);construct_delta(delta,dirty);if(!delta.good()){std::printf("DELTA %s status=%u stage=incremental\n",name.data(),c.numbers.status);return 5;}
   sources.back()=change;Graph fresh(c,b);capture(fresh,paths.data(),path_count,sources.data(),uint32_t(sources.size()),commands.data(),uint32_t(commands.size()));construct(fresh);if(!fresh.good()){std::printf("DELTA %s status=%u stage=independent-full\n",name.data(),c.numbers.status);return 6;}
   for(uint32_t i=0;i<query_count;i++){
    Q x0=Q::from_double(c.numbers,queries[i*5]),y0=Q::from_double(c.numbers,queries[i*5+1]),x1=Q::from_double(c.numbers,queries[i*5+2]),y1=Q::from_double(c.numbers,queries[i*5+3]);auto before=area(old,x0,y0,x1,y1),a=area(delta,x0,y0,x1,y1),z=area(fresh,x0,y0,x1,y1);double expected=queries[i*5+4],lo=lower(a.lower),hi=upper(a.upper),zl=lower(z.lower),zh=upper(z.upper);
    if(!delta.good()||lower(before.lower)>expected+1e-12||upper(before.upper)<expected-1e-12||a.lower>z.upper||a.upper<z.lower||hi-lo>1e-12||zh-zl>1e-12){std::printf("DELTA %s status=%u stage=area query=%u retained=%.17g..%.17g full=%.17g..%.17g\n",name.data(),c.numbers.status,i,lo,hi,zl,zh);return 7;}pixels++;
   }
   for(uint32_t y=0;y<9;y++)for(uint32_t x=0;x<9;x++){
    Point point{Q::from_signed(c.numbers,int64_t(x)*19+7)/Q(61),Q::from_signed(c.numbers,int64_t(y)*17+3)/Q(59)};int a=normalized_winding(delta,point),z=normalized_winding(fresh,point);if(!delta.good()||(a!=0&&a!=1)||a!=z||bool(a)!=filled(delta,winding(delta,point))){std::printf("DELTA %s status=%u stage=membership x=%u y=%u retained=%d full=%d\n",name.data(),c.numbers.status,x,y,a,z);return 8;}points++;
   }
   classifications+=delta.metrics.classifications;reused+=delta.metrics.classification_cache_hits;
   std::printf("DELTA %s OK base_edges=%u new_edges=%u full_edges=%u classes=%llu reused=%llu sources=%u\n",name.data(),old.edges.size(),delta.edges.size(),fresh.edges.size(),(unsigned long long)delta.metrics.classifications,(unsigned long long)delta.metrics.classification_cache_hits,delta.active_sources);std::fflush(stdout);
  }
  if(c.numbers.live_bytes)return 9;passed++;
 }
 std::fclose(f);std::printf("BOUNDARY_RETAINED_FULL_PARITY_OK fixtures=%u pixels=%u memberships=%u classifications=%llu reused=%llu\n",passed,pixels,points,(unsigned long long)classifications,(unsigned long long)reused);
}
