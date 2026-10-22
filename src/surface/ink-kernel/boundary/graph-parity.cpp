#include "number-test-api.cpp"
#include <cstdio>
#include <vector>
#include <cstdlib>
#include <cstring>
static uint32_t read32(FILE*f){uint32_t v;if(std::fread(&v,4,1,f)!=1)std::abort();return v;}
static double read64(FILE*f){double v;if(std::fread(&v,8,1,f)!=1)std::abort();return v;}
static void write32(FILE*f,uint32_t value){if(std::fwrite(&value,4,1,f)!=1)std::abort();}
int main(int argc,char**argv){if(argc!=3&&argc!=4)return 1;bool delta=argc==4;if(delta&&std::strcmp(argv[3],"delta"))return 1;FILE*in=std::fopen(argv[1],"rb"),*out=std::fopen(argv[2],"wb");if(!in||!out||read32(in)!=0x53414731)return 2;uint32_t count=read32(in);write32(out,count);
 for(uint32_t index=0;index<count;index++){
  uint32_t nameBytes=read32(in);if(nameBytes>1024)return 3;for(uint32_t i=0;i<nameBytes;i++)if(std::fgetc(in)==EOF)return 3;
  uint32_t paths=read32(in);if(paths>8)return 4;std::vector<uint32_t>ranges(paths*2);std::vector<SAInkPathCommand>commands;
  for(uint32_t p=0;p<paths;p++){ranges[p*2]=read32(in);ranges[p*2+1]=read32(in);for(uint32_t j=0;j<ranges[p*2+1];j++){SAInkPathCommand command{};command.operation=read32(in);for(double&v:command.values)v=read64(in);commands.push_back(command);}}
  uint32_t queries=read32(in);std::vector<double>q(queries*4);for(uint32_t i=0;i<queries;i++){for(uint32_t j=0;j<4;j++)q[i*4+j]=read64(in);(void)read64(in);}
  std::vector<uint64_t>arena(64*1024*1024/8);std::vector<uint32_t>output(4096,0x5a5a5a5a);int32_t metadata[8];for(auto&v:metadata)v=0x5a5a5a5a;
  uint32_t status=(delta?sabt_graph_delta:sabt_graph)(ranges.data(),paths,commands.data(),uint32_t(commands.size()),q.data(),queries,arena.data(),uint32_t(arena.size()*8),10000000000ull,output.data(),uint32_t(output.size()),metadata);
  write32(out,status);for(auto value:metadata)write32(out,uint32_t(value));uint32_t words=status?0:uint32_t(metadata[0]);write32(out,words);for(uint32_t i=0;i<words;i++)write32(out,output[i]);
  if(status){for(auto v:metadata)if(v!=0x5a5a5a5a)return 5;for(auto v:output)if(v!=0x5a5a5a5a)return 6;}
 }
 std::fclose(in);std::fclose(out);
}
