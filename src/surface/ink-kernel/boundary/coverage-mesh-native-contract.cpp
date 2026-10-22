#include "coverage-mesh-test-api.cpp"
#include <vector>
#include <cstdio>
int main(int argc,char**argv){if(argc!=2)return 1;auto*f=std::fopen(argv[1],"wb");if(!f)return 2;
 for(uint32_t fixture=0;fixture<13;fixture++){std::vector<uint64_t>memory(32*1024*1024/8);std::vector<uint32_t>out(262144,0x5a5a5a5a);auto s=sacm_fixture(fixture,memory.data(),memory.size()*8,out.data(),out.size());std::printf("ACTUAL_COVERAGE_MESH fixture=%u transport=%u result=%u reason=%u words=%u\n",fixture,s,out[1],out[2],out[0]);std::fflush(stdout);if(s)return 3;if(std::fwrite(&fixture,4,1,f)!=1||std::fwrite(out.data(),4,out[0]+1,f)!=out[0]+1)return 4;}
 std::fclose(f);return 0;
}
