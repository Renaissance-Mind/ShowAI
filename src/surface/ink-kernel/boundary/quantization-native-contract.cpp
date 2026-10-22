#include "quantization-test-api.cpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cstring>
int main(int argc,char**argv){if(argc!=2)return 1;FILE*f=std::fopen(argv[1],"wb");if(!f)return 2;uint32_t total=0;
 for(uint32_t fixture=0;fixture<=12;fixture++){
  std::vector<uint64_t>memory(64*1024*1024/8);std::vector<uint32_t>output(65536,0x5a5a5a5a);double tol=(fixture==6||fixture==9)?1e-26:1e-9;
  uint32_t status=saqt_fixture(fixture,tol,10000,512,512,1000000000ull,memory.data(),uint32_t(memory.size()*8),output.data(),uint32_t(output.size()));
  std::printf("quantization fixture=%u status=%u words=%u stage=%u\n",fixture,status,status?0:output[0],saqt_stage());std::fflush(stdout);if(fixture==6||fixture>=10){if(status!=(fixture==12?SA_INK_CAPACITY:SA_INK_RANGE)||saqt_stage()!=(fixture==6?1u:3u)){std::fclose(f);return 3;}uint32_t header[3]={fixture,status,0};if(std::fwrite(header,sizeof(header),1,f)!=1)return 4;continue;}if(status){std::fclose(f);return 3;}
  uint32_t header[3]={fixture,status,output[0]+1};if(std::fwrite(header,sizeof(header),1,f)!=1||std::fwrite(output.data(),4,output[0]+1,f)!=output[0]+1)return 4;++total;
 }
 uint64_t nan_bits=0x7ff8000000000000ull;double nan;std::memcpy(&nan,&nan_bits,8);
 struct Failure{uint32_t fixture;double tolerance;uint32_t refinements,vertices,edges;uint64_t work;uint32_t status;};
 const Failure failures[]={{1,1e-30,0,512,512,1000000000ull,3},{1,1e-9,10000,1,512,1000000000ull,2},{1,1e-9,10000,512,1,1000000000ull,2},{1,1e-9,10000,512,512,10,2},{0,nan,10000,512,512,1000000000ull,1},{0,0,10000,512,512,1000000000ull,1}};
 for(uint32_t index=0;index<6;index++){
  const auto&test=failures[index];std::vector<uint64_t>memory(64*1024*1024/8);std::vector<uint32_t>output(65536,0x5a5a5a5a);
  uint32_t status=saqt_fixture(test.fixture,test.tolerance,test.refinements,test.vertices,test.edges,test.work,memory.data(),uint32_t(memory.size()*8),output.data(),uint32_t(output.size()));
  if(status!=test.status)return 5;for(uint32_t word:output)if(word!=0x5a5a5a5a)return 6;
  uint32_t header[3]={100+index,status,0};if(std::fwrite(header,sizeof(header),1,f)!=1)return 4;
 }
 {
  std::vector<uint64_t>memory(64*1024*1024/8,0x5a5a5a5a5a5a5a5aull);auto*alias=(uint32_t*)((uint8_t*)memory.data()+128);
  uint32_t status=saqt_fixture(0,1e-9,10000,512,512,1000000000ull,memory.data(),uint32_t(memory.size()*8),alias,65536);
  if(status!=SA_INK_INVALID)return 7;for(uint64_t word:memory)if(word!=0x5a5a5a5a5a5a5a5aull)return 8;uint32_t header[3]={106,status,0};if(std::fwrite(header,sizeof(header),1,f)!=1)return 4;
 }
 {
  std::vector<uint64_t>memory(64*1024*1024/8);std::vector<uint32_t>output(65536,0x5a5a5a5a);
  uint32_t status=saqt_fixture(0,1e-9,10000,512,512,1000000000ull,memory.data(),uint32_t(memory.size()*8),output.data(),1);
  if(status!=SA_INK_CAPACITY)return 9;for(uint32_t word:output)if(word!=0x5a5a5a5a)return 10;uint32_t header[3]={107,status,0};if(std::fwrite(header,sizeof(header),1,f)!=1)return 4;
 }
 {std::vector<uint64_t>memory(16*1024*1024/8);uint32_t output[8]{};if(saqt_source_pins(memory.data(),uint32_t(memory.size()*8),output,8)||output[0]!=12)return 12;uint32_t header[3]={108,0,8};if(std::fwrite(header,sizeof(header),1,f)!=1||std::fwrite(output,sizeof(output),1,f)!=1)return 13;}
 std::fclose(f);std::printf("BOUNDARY_QUANTIZATION_NATIVE_OK positive=%u atomicFailures=11\n",total);return 0;
}
