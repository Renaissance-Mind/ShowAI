#include "../boundary-kernel.cpp"
#include "quantization-state-test-api.cpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
int main(int argc,char**argv){if(argc<2)return 1;uint32_t count=argc>2?uint32_t(std::strtoul(argv[2],nullptr,10)):32;
 uint32_t bytes=(count>128?272u:80u)*1024*1024;std::vector<uint64_t>memory(bytes/8);std::vector<uint64_t>output(1024+count*4*50);
 uint32_t mode=argc>3?uint32_t(std::strtoul(argv[3],nullptr,10)):0;auto status=mode==2?saqt_curve_state(memory.data(),bytes,output.data(),uint32_t(output.size())):saqt_state(count,memory.data(),bytes,output.data(),uint32_t(output.size()),mode);if(status||output[0]!=(mode==2?3:11)){std::fprintf(stderr,"QUANT_STATE_FAIL status=%u checks=%llu line=%u\n",status,(unsigned long long)output[0],saqt_state_error_line());return 2;}
 FILE*f=std::fopen(argv[1],"wb");if(!f)return 3;uint32_t header[3]={status,count,mode};if(std::fwrite(header,sizeof(header),1,f)!=1||std::fwrite(output.data(),8,24+output[15],f)!=24+output[15])return 4;std::fclose(f);
 std::printf("QUANT_STATE_NATIVE_OK sources=%u checks=%llu retained=%llu blocks=%llu arcs=%llu anchorNodes=%llu visits=%llu\n",count,(unsigned long long)output[0],(unsigned long long)output[2],(unsigned long long)output[4],(unsigned long long)output[5],(unsigned long long)output[6],(unsigned long long)output[7]);
}
