#include "conditioned-klm-test-api.cpp"
#include <vector>
#include <cstdio>
int main(int argc,char**argv){if(argc!=2)return 1;auto*f=std::fopen(argv[1],"wb");if(!f)return 2;
 for(uint32_t fixture=0;fixture<15;fixture++){
  std::vector<uint64_t>memory(8*1024*1024/8);std::vector<uint32_t>output(65536,0x5a5a5a5a);
  auto status=sack_fixture(fixture,memory.data(),uint32_t(memory.size()*8),output.data(),output.size());
  std::printf("CONDITIONING fixture=%u transport=%u result=%u reason=%u words=%u\n",fixture,status,output[1],output[2],output[0]);std::fflush(stdout);
  const uint32_t expected[]={0,0,0,3,3,3,0,3,1,2,1,3,0,2,3};
  const uint32_t reasons[]={0,0,0,5,2,5,0,5,1,6,1,5,0,6,4};
  if(status||output[1]!=expected[fixture]||output[2]!=reasons[fixture]){std::fclose(f);return 3;}if(std::fwrite(&fixture,4,1,f)!=1||std::fwrite(output.data(),4,output[0]+1,f)!=output[0]+1){std::fclose(f);return 4;}
 }
 std::fclose(f);return 0;
}
