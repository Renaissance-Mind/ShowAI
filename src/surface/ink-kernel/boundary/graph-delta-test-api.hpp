#ifndef SHOWAI_BOUNDARY_GRAPH_DELTA_TEST_API_HPP
#define SHOWAI_BOUNDARY_GRAPH_DELTA_TEST_API_HPP
#include "source-delta.hpp"
// Correctness transport only. Actual immutable source, retained delta and an
// independent full rebuild all evaluate original Bezier curves, not meshes.
extern "C" uint32_t sabt_graph_delta(const uint32_t*ranges,uint32_t path_count,const SAInkPathCommand*commands,uint32_t command_count,const double*queries,uint32_t query_count,void*memory,uint32_t bytes,uint64_t work_limit,uint32_t*output,uint32_t capacity,int32_t*metadata){
    if(!ranges||!path_count||path_count>8||!commands||command_count>512||!queries||query_count>128||!memory||!output||!metadata||((uintptr_t)ranges&3u)||((uintptr_t)commands&7u)||((uintptr_t)queries&7u)||((uintptr_t)output&3u)||((uintptr_t)metadata&3u))return SA_INK_INVALID;
    const void*objects[6]={ranges,commands,queries,memory,output,metadata};uint64_t sizes[6]={uint64_t(path_count)*8,uint64_t(command_count)*sizeof(SAInkPathCommand),uint64_t(query_count)*32,bytes,uint64_t(capacity)*4,32};for(uint32_t i=0;i<6;i++)for(uint32_t j=i+1;j<6;j++)if(overlap(objects[i],sizes[i],objects[j],sizes[j]))return SA_INK_INVALID;
    PolynomialContext c;if(!c.numbers.initialize(memory,bytes,work_limit))return c.numbers.status;c.polynomial.max_operations=50000000;SABoundaryPath paths[8]{};SABoundarySourceBlock sources[512]{};uint32_t offset=0,source_count=0;
    for(uint32_t p=0;p<path_count;p++){
        uint32_t count=ranges[p*2+1];if(ranges[p*2]>1||offset>command_count||count>command_count-offset)return SA_INK_INVALID;paths[p].fill=ranges[p*2];paths[p].role=p?1:0;uint32_t start=offset;bool open=false;
        auto emit=[&](uint32_t end){if(source_count>=512){c.numbers.fail(SA_INK_CAPACITY);return;}auto&s=sources[source_count];s.key.words[0]=source_count+1;s.key.words[1]=p;s.path_index=p;s.first_command=start;s.command_count=end-start;s.affine[0]=s.affine[3]=1;++source_count;};
        for(uint32_t i=offset;i<offset+count&&c.numbers.status==SA_INK_OK;i++){if(commands[i].operation==SA_INK_MOVE){if(open)emit(i);start=i;open=true;}if(commands[i].operation==SA_INK_CLOSE&&open){emit(i+1);open=false;}}if(open)emit(offset+count);offset+=count;
    }
    if(offset!=command_count||!source_count)return SA_INK_INVALID;if(c.numbers.status)return c.numbers.status;
    SABoundaryBudget b{};b.max_commands=2048;b.max_curves=2048;b.max_sources=512;b.max_paths=8;b.max_pairs=100000;b.max_cuts=65536;b.max_edges=65536;
    Graph old(c,b);capture(old,paths,path_count,sources,source_count,commands,command_count);construct(old);if(!old.good())return c.numbers.status;
    Graph delta=old;SABoundarySourceBlock change=sources[source_count-1];change.affine[4]=1.0/32;SourceDirty dirty(c.numbers);upsert_source(delta,change,commands,command_count,dirty);construct_delta(delta,dirty);if(!delta.good())return c.numbers.status;
    sources[source_count-1]=change;Graph fresh(c,b);capture(fresh,paths,path_count,sources,source_count,commands,command_count);construct(fresh);if(!fresh.good())return c.numbers.status;
    Vector<uint32_t>staged(c.numbers),tail(c.numbers);auto append64=[&](Vector<uint32_t>&words,uint64_t value){words.push_back(uint32_t(value));words.push_back(uint32_t(value>>32));};auto number=[&](Vector<uint32_t>&words,double value){uint64_t bits;copy_bytes(&bits,&value,8);append64(words,bits);};staged.push_back(delta.curves.size());staged.push_back(delta.edges.size());
    for(uint32_t i=0;i<query_count&&delta.good();i++){
        Q x0=Q::from_double(c.numbers,queries[i*4]),y0=Q::from_double(c.numbers,queries[i*4+1]),x1=Q::from_double(c.numbers,queries[i*4+2]),y1=Q::from_double(c.numbers,queries[i*4+3]);auto before=area(old,x0,y0,x1,y1),a=area(delta,x0,y0,x1,y1),z=area(fresh,x0,y0,x1,y1);
        if(a.lower>z.upper||a.upper<z.lower){c.numbers.fail(SA_INK_RANGE);return c.numbers.status;}
        number(staged,lower(before.lower));number(staged,upper(before.upper));number(tail,lower(a.lower));number(tail,upper(a.upper));number(tail,lower(z.lower));number(tail,upper(z.upper));
    }
    for(uint32_t y=0;y<9&&delta.good();y++)for(uint32_t x=0;x<9&&delta.good();x++){
        Point point{Q::from_signed(c.numbers,int64_t(x)*19+7)/Q(61),Q::from_signed(c.numbers,int64_t(y)*17+3)/Q(59)};int a=normalized_winding(delta,point),z=normalized_winding(fresh,point);if((a!=0&&a!=1)||a!=z||bool(a)!=filled(delta,winding(delta,point))){c.numbers.fail(SA_INK_RANGE);return c.numbers.status;}staged.push_back(uint32_t(a));
    }
    for(uint32_t word:tail)staged.push_back(word);append64(staged,delta.metrics.classifications);append64(staged,delta.metrics.classification_cache_hits);append64(staged,delta.metrics.pair_proofs);append64(staged,delta.metrics.pair_cache_hits);append64(staged,c.polynomial.operations);append64(staged,c.numbers.work);append64(staged,c.numbers.peak_bytes);
    if(!delta.good())return c.numbers.status;if(staged.size()>capacity)return SA_INK_CAPACITY;for(uint32_t i=0;i<staged.size();i++)output[i]=static_cast<const Vector<uint32_t>&>(staged)[i];metadata[0]=int32_t(staged.size());metadata[1]=int32_t(query_count);metadata[2]=81;for(uint32_t i=3;i<8;i++)metadata[i]=0;return SA_INK_OK;
}
#endif
