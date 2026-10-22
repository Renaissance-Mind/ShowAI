#include "correspondence-test-api.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
static void require(bool b,const char*label){if(!b){std::fprintf(stderr,"correspondence failure %s\n",label);std::abort();}}
int main(int argc,char**argv){FILE*f=argc==2?std::fopen(argv[1],"wb"):nullptr;if(argc==2)require(f,"output file");std::vector<uint64_t>arena(16*1024*1024/8);std::vector<uint32_t>output(4096);
 for(uint32_t fixture=0;fixture<9;fixture++){for(auto&x:output)x=0x5a5a5a5a;uint32_t status=sabt_correspondence(fixture,arena.data(),uint32_t(arena.size()*8),output.data(),uint32_t(output.size()));require(status==(fixture==8?SA_INK_RANGE:SA_INK_OK),"actual exact RUR root correspondence or explicit unchanged budget");if(fixture==8){for(auto x:output)require(x==0x5a5a5a5a,"unresolved root match produces no partial output");}else require(output[0]==(fixture==4?1u:fixture==5?0u:2u),"root cardinality preserved");if(f){require(std::fwrite(&fixture,4,1,f)==1&&std::fwrite(&status,4,1,f)==1&&std::fwrite(output.data(),4,output.size(),f)==output.size(),"actual certificate output");}}
 if(f)std::fclose(f);std::printf("BOUNDARY_RUR_ENDPOINT_REFINEMENT_OK fixtures=8 unresolved=1\n");}
