#include "number-test-api.cpp"
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <cstring>
static void require(bool b,const char*message){if(!b){std::fprintf(stderr,"graph atomic failure %s\n",message);std::abort();}}
int main(){uint32_t ranges[2]={0,5};SAInkPathCommand commands[5]={{SA_INK_MOVE,0,{0,0}},{SA_INK_LINE,0,{1,0}},{SA_INK_LINE,0,{1,1}},{SA_INK_LINE,0,{0,1}},{SA_INK_CLOSE,0,{}}};SAInkPathCommand original[5];std::memcpy(original,commands,sizeof commands);double query[4]={0,0,1,1};std::vector<uint64_t>arena(1024*1024/8);uint32_t output[512];int32_t metadata[8];uint32_t failures=0;
 auto call=[&](uint32_t bytes,uint64_t work,uint32_t capacity){for(auto&v:output)v=0x5a5a5a5a;for(auto&v:metadata)v=0x5a5a5a5a;return sabt_graph(ranges,1,commands,5,query,1,arena.data(),bytes,work,output,capacity,metadata);};
 auto unchanged=[&]{for(auto v:output)require(v==0x5a5a5a5a,"no partial output");for(auto v:metadata)require(v==0x5a5a5a5a,"no partial receipt");require(!std::memcmp(commands,original,sizeof commands),"captured source unchanged");};
 for(uint32_t bytes=64;bytes<=32768;bytes*=2){auto status=call(bytes,1000000000,512);require(status==SA_INK_CAPACITY,"bounded arena capacity status");unchanged();failures++;}
 require(call(uint32_t(arena.size()*8),1,512)==SA_INK_CAPACITY,"limb budget status");unchanged();failures++;
 require(call(uint32_t(arena.size()*8),1000000000,1)==SA_INK_CAPACITY,"caller output capacity");unchanged();failures++;
 commands[1].operation=9;require(call(uint32_t(arena.size()*8),1000000000,512)==SA_INK_INVALID,"invalid source rejected");commands[1]=original[1];unchanged();failures++;
 require(call(uint32_t(arena.size()*8),1000000000,512)==SA_INK_OK,"retry after atomic failure");require(output[0]==4&&output[1]==4,"actual retained geometry");
 auto result=output[0];require(sabt_graph(ranges,1,commands,5,query,1,arena.data(),uint32_t(arena.size()*8),1000000000,(uint32_t*)commands,512,metadata)==SA_INK_INVALID,"source-output alias rejected");require(output[0]==result&&!std::memcmp(commands,original,sizeof commands),"alias rejection preserves source");
 std::printf("BOUNDARY_GRAPH_ATOMIC_OK failures=%u\n",failures);
}
