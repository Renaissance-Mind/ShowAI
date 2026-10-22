#include "../boundary-kernel.cpp"
#include "vertex-test-api.hpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
int main(int argc,char**argv){if(argc!=2)return 1;FILE*f=std::fopen(argv[1],"wb");if(!f)return 2;std::vector<uint64_t>memory((16*1024*1024+4096)/8);std::vector<uint32_t>out(4096);for(uint32_t fixture=0;fixture<3;fixture++){for(auto&v:out)v=0x5a5a5a5a;auto status=sabt_vertex(fixture,memory.data(),uint32_t(memory.size()*8),out.data(),uint32_t(out.size()));if(status){std::fprintf(stderr,"actual vertex case%u status%u\n",fixture,status);return 3;}uint32_t header[2]={fixture,status};if(std::fwrite(header,sizeof header,1,f)!=1||std::fwrite(out.data(),4,out.size(),f)!=out.size())return 4;}std::fclose(f);std::printf("BOUNDARY_VERTEX_ACTUAL_NATIVE_CASES_OK cases=3\n");}
