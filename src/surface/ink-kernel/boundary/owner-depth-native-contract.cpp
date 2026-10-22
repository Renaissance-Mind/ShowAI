#include "../boundary-kernel.cpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cstring>
static void require(bool b,const char*message){if(!b){std::fprintf(stderr,"boundary depth failure %s\n",message);std::abort();}}
static void rectangle(SAInkPathCommand*out,double x0,double y0,double x1,double y1,bool reverse){
 SAInkPathCommand a[5]={{SA_INK_MOVE,0,{x0,y0}},{SA_INK_LINE,0,{x1,y0}},{SA_INK_LINE,0,{x1,y1}},{SA_INK_LINE,0,{x0,y1}},{SA_INK_CLOSE,0,{}}};
 if(reverse){a[1].values[0]=x0;a[1].values[1]=y1;a[3].values[0]=x1;a[3].values[1]=y0;}std::memcpy(out,a,sizeof a);
}
int main(int argc,char**argv){
 {using namespace showai_boundary;std::vector<uint64_t>memory(8192/8);Context c;require(c.initialize(memory.data(),8192,1000000),"weight private arena");{
  Weight old(c);old[128]=7;Weight draft=old;uint32_t held[256]{},n=0;while(!c.status&&n<256){uint32_t p=c.allocate(32);if(p!=no_block)held[n++]=p;}require(c.status==SA_INK_CAPACITY,"real arena exhausted");c.begin_work(1000000);draft[128]=9;require(c.status==SA_INK_CAPACITY&&static_cast<const Weight&>(old)[128]==7&&static_cast<const Weight&>(draft)[128]==7,"failed dynamic COW never edits retained values");for(uint32_t i=0;i<n;i++)c.release(held[i]);c.begin_work(1000000);draft[128]=9;require(!c.status&&static_cast<const Weight&>(old)[128]==7&&static_cast<const Weight&>(draft)[128]==9,"same failed weight intent retries after capacity released");
 }require(c.live_bytes==0,"all dynamic weight buffers released");}
 FILE*f=argc==2?std::fopen(argv[1],"wb"):nullptr;if(argc==2)require(f,"parity output");
 for(uint32_t count:{49u,65u,129u}){
 SABoundaryBudget b{};b.max_commands=800;b.max_curves=32;b.max_pairs=1000;b.max_cuts=2048;b.max_edges=2048;b.max_leases=4;b.max_sources=160;b.max_paths=160;b.max_polynomial_degree=64;b.max_stored_bits=16384;b.max_polynomial_operations=5000000;b.max_limb_operations=1000000000;b.retained_bytes=b.workspace_bytes=4*1024*1024;
 std::vector<uint64_t>state((sa_boundary_state_bytes()+7)/8),arena((b.retained_bytes+b.workspace_bytes)/8);require(sa_boundary_initialize(state.data(),uint32_t(state.size()*8),98,arena.data(),uint32_t(arena.size()*8),&b)==0,"dynamic budget initialized");
 std::vector<SABoundaryPath>paths(count);std::vector<SABoundarySourceBlock>sources(count);std::vector<SAInkPathCommand>commands(count*5);
 for(uint32_t p=0;p<count;p++){paths[p].role=p?SA_BOUNDARY_CLIP:SA_BOUNDARY_PAINT;paths[p].fill=p%2;sources[p].key.words[0]=p+1;sources[p].path_index=p;sources[p].first_command=p*5;sources[p].command_count=5;sources[p].affine[0]=sources[p].affine[3]=1;if(p%3==1){sources[p].affine[0]=-1;sources[p].affine[4]=4;}rectangle(commands.data()+p*5,0,0,4,4,p%2);}
 rectangle(commands.data()+(count-1)*5,1,1,3,3,false);SABoundaryLease a{},next{},sentinel{1,2,3,4,5};require(sa_boundary_prepare(state.data(),nullptr,paths.data(),count,sources.data(),count,commands.data(),count*5,&a)==0,"all actual clip dimensions consumed");
 double box[4]={0,0,4,4},area[2]={};require(sa_boundary_measure_coverage(state.data(),a,box,1,area,1)==0&&area[0]==0.25&&area[1]==0.25,"deepest clip actually limits Boolean area");
 SABoundarySnapshot before{},after{};require(sa_boundary_snapshot(state.data(),a,&before)==0&&before.exposed_edges==4,"deep graph metadata");SABoundarySourceMutation m{};m.source=sources.back();m.source.first_command=0;SAInkPathCommand changed[5];rectangle(changed,2,1,3,3,false);
 require(sa_boundary_update(state.data(),&a,&m,1,changed,5,&next)==0,"deepest clip source replaced COW");require(sa_boundary_measure_coverage(state.data(),next,box,1,area,1)==0&&area[0]==0.125&&area[1]==0.125,"changed last clip area");require(sa_boundary_measure_coverage(state.data(),a,box,1,area,1)==0&&area[0]==0.25&&area[1]==0.25,"old lease complete deep vector immutable");require(sa_boundary_snapshot(state.data(),next,&after)==0,"next snapshot");
 SABoundarySourceMutation remove{};remove.operation=SA_BOUNDARY_REMOVE_SOURCE;remove.source.key=sources.back().key;SABoundaryLease empty{};require(sa_boundary_update(state.data(),&next,&remove,1,nullptr,0,&empty)==0,"remove deepest clip membership");require(sa_boundary_measure_coverage(state.data(),empty,box,1,area,1)==0&&area[0]==0&&area[1]==0,"missing last clip is empty intersection");
 auto invalid=sentinel;require(sa_boundary_prepare(state.data(),&empty,paths.data(),161,sources.data(),count,commands.data(),count*5,&invalid)==SA_INK_INVALID&&!std::memcmp(&invalid,&sentinel,sizeof invalid),"explicit caller path budget rejection atomic");require(sa_boundary_measure_coverage(state.data(),a,box,1,area,1)==0&&area[0]==0.25&&area[1]==0.25,"invalid prepare preserves old source");
 SABoundaryEdge edges[4];require(sa_boundary_copy_edges(state.data(),a,0,4,edges,4)==0,"deep original edges copied");if(f){require(std::fwrite(&count,4,1,f)==1&&std::fwrite(&before,sizeof before,1,f)==1&&std::fwrite(&after,sizeof after,1,f)==1&&std::fwrite(edges,sizeof edges,1,f)==1,"write parity");}
 require(sa_boundary_release(state.data(),a)==0&&sa_boundary_release(state.data(),next)==0&&sa_boundary_release(state.data(),empty)==0&&sa_boundary_destroy(state.data())==0,"all dynamic vectors released");for(auto v:state)require(!v,"state zero");
 }
 if(f)std::fclose(f);std::printf("BOUNDARY_DYNAMIC_CLIP_DEPTH_OK paths=49,65,129\n");
}
