#include "include/ink-input-kernel.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
int main(){
    uint32_t header[4];SAInkInputConfig config;
    if(std::fread(header,sizeof(header),1,stdin)!=1||std::fread(&config,sizeof(config),1,stdin)!=1)return 2;
    uint32_t n=header[0],batch=header[1],predicted=header[2],correction=header[3];
    if(!n||n>SA_INK_INPUT_MAX_RAW||!batch||predicted>128)return 3;
    std::vector<SAInkInputPoint> points(n),predictions(predicted);SAInkInputPoint replacement{};
    if(std::fread(points.data(),sizeof(SAInkInputPoint),n,stdin)!=n)return 4;
    if(predicted&&std::fread(predictions.data(),sizeof(SAInkInputPoint),predicted,stdin)!=predicted)return 5;
    if(correction!=0xffffffff&&std::fread(&replacement,sizeof(replacement),1,stdin)!=1)return 6;
    uint32_t bytes=sa_input_state_bytes(n);void *state=std::malloc(bytes);if(!state)return 7;
    SAInkStatus status=sa_input_initialize(state,bytes,n,&config);
    for(uint32_t i=0;i<n&&status==SA_INK_OK;i+=batch){uint32_t count=n-i<batch?n-i:batch;bool last=i+count==n;status=sa_input_push(state,points.data()+i,count,last?predictions.data():nullptr,last?predicted:0);}
    if(status==SA_INK_OK)status=sa_input_finish(state);
    if(status==SA_INK_OK&&correction!=0xffffffff)status=sa_input_correct(state,&replacement);
    std::fwrite(&status,sizeof(status),1,stdout);if(status!=SA_INK_OK){std::free(state);return 0;}
    SAInkInputSnapshot snapshot{};sa_input_snapshot(state,&snapshot);
    std::vector<SAInkInputPoint> raw(snapshot.actual_count);std::vector<SAInkInputCurve> curves(snapshot.curve_count);std::vector<SAInkSample> samples(snapshot.sample_count);
    if(sa_input_copy_raw(state,0,snapshot.actual_count,raw.data(),snapshot.actual_count)!=SA_INK_OK||sa_input_copy_curves(state,0,snapshot.curve_count,curves.data(),snapshot.curve_count)!=SA_INK_OK||sa_input_copy_samples(state,0,snapshot.sample_count,samples.data(),snapshot.sample_count)!=SA_INK_OK)return 8;
    std::fwrite(&snapshot,sizeof(snapshot),1,stdout);std::fwrite(raw.data(),sizeof(SAInkInputPoint),raw.size(),stdout);std::fwrite(curves.data(),sizeof(SAInkInputCurve),curves.size(),stdout);std::fwrite(samples.data(),sizeof(SAInkSample),samples.size(),stdout);std::free(state);
}
