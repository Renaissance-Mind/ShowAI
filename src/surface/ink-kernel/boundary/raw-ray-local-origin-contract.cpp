#include "../include/coverage-kernel.h"
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <new>
#include <vector>

// Public ABI consumer; Native and WASM must return the same complete mesh.
int main(int argc,char**argv) {
 if(argc!=3)return 1;
 std::ifstream input(argv[1],std::ios::binary);uint32_t count=0;
 if(!input.read(reinterpret_cast<char*>(&count),4)||count>100000)return 2;
 std::vector<SAInkPathCommand>commands(count);
 if(!input.read(reinterpret_cast<char*>(commands.data()),count*sizeof(SAInkPathCommand)))return 3;
 const uint32_t stateBytes=sa_coverage_state_bytes(),arenaBytes=8*1024*1024;
 void*state=::operator new(stateBytes,std::align_val_t(16));
 void*arena=::operator new(arenaBytes,std::align_val_t(16));
 std::memset(state,0,stateBytes);
 SACoverageBudget budget{5000000,100000000,4194304,4194304,{256,256,.02,100000,100000,1000000,333333,16,0}};
 if(sa_coverage_initialize(state,stateBytes,1,arena,arenaBytes,&budget))return 4;
 SACoverageReceipt receipt{};const uint32_t status=sa_coverage_prepare(state,commands.data(),count,81,&receipt);
 SACoverageDiagnostics diagnostics{};if(sa_coverage_diagnostics(state,&diagnostics))return 5;
 std::ofstream output(argv[2],std::ios::binary);uint32_t header[2]={status,diagnostics.last_reason};
 output.write(reinterpret_cast<const char*>(header),sizeof header);
 if(status==0){
  SACoverageSummary summary{};if(sa_coverage_summary(state,receipt,&summary))return 6;
  std::vector<SACoverageVertex>vertices(summary.vertices);std::vector<SACoverageDraw>draws(summary.draws);
  if(sa_coverage_copy_vertices(state,receipt,vertices.data(),summary.vertices)||sa_coverage_copy_draws(state,receipt,draws.data(),summary.draws))return 7;
  // The address of the actual serial workspace is platform-specific.
  summary.receipt.owner=0;
  output.write(reinterpret_cast<const char*>(&summary),sizeof summary);
  output.write(reinterpret_cast<const char*>(vertices.data()),vertices.size()*sizeof(SACoverageVertex));
  output.write(reinterpret_cast<const char*>(draws.data()),draws.size()*sizeof(SACoverageDraw));
 }
 if(sa_coverage_destroy(state))return 8;
 ::operator delete(state,std::align_val_t(16));::operator delete(arena,std::align_val_t(16));
 return output?0:9;
}
