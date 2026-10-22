#ifndef SHOWAI_BOUNDARY_GRAPH_TEST_API_HPP
#define SHOWAI_BOUNDARY_GRAPH_TEST_API_HPP
#include "graph.hpp"
// Tests only. The production owner/lease API does not accept this transport.
extern "C" uint32_t sabt_graph(const uint32_t*ranges,uint32_t path_count,const SAInkPathCommand*commands,uint32_t command_count,const double*queries,uint32_t query_count,void*memory,uint32_t bytes,uint64_t work_limit,uint32_t*output,uint32_t capacity,int32_t*metadata){
    if(!ranges||!path_count||path_count>8||!commands||command_count>2048||!queries||query_count>128||!output||!metadata||!memory||((uintptr_t)ranges&3u)||((uintptr_t)commands&7u)||((uintptr_t)queries&7u)||((uintptr_t)output&3u)||((uintptr_t)metadata&3u))return SA_INK_INVALID;
    const void*objects[6]={ranges,commands,queries,memory,output,metadata};uint64_t sizes[6]={uint64_t(path_count)*8,uint64_t(command_count)*sizeof(SAInkPathCommand),uint64_t(query_count)*32,bytes,uint64_t(capacity)*4,32};
    for(uint32_t i=0;i<6;i++)for(uint32_t j=i+1;j<6;j++)if(overlap(objects[i],sizes[i],objects[j],sizes[j]))return SA_INK_INVALID;
    PolynomialContext c;if(!c.numbers.initialize(memory,bytes,work_limit))return c.numbers.status;c.polynomial.max_operations=50000000;
    Vector<SABoundaryPath>paths(c.numbers);Vector<SABoundarySourceBlock>sources(c.numbers);uint32_t offset=0;
    for(uint32_t i=0;i<path_count;i++){uint32_t count=ranges[i*2+1];if(ranges[i*2]>1||offset>command_count||count>command_count-offset)return SA_INK_INVALID;paths.push_back({ranges[i*2],i?1u:0u,{0,0}});SABoundarySourceBlock source{};source.key.words[0]=i+1;source.path_index=i;source.first_command=offset;source.command_count=count;source.affine[0]=source.affine[3]=1;sources.push_back(source);offset+=count;}
    if(offset!=command_count)return SA_INK_INVALID;
    SABoundaryBudget b{};b.max_commands=2048;b.max_curves=2048;b.max_pairs=100000;b.max_cuts=16384;b.max_edges=16384;b.max_sources=512;b.max_paths=8;
    Graph g(c,b);capture(g,paths.begin(),paths.size(),sources.begin(),sources.size(),commands,command_count);construct(g);
    if(!g.good())return c.numbers.status;Vector<uint32_t>staged(c.numbers);
    auto word64=[&](uint64_t value){staged.push_back(uint32_t(value));staged.push_back(uint32_t(value>>32));};
    auto number=[&](double value){uint64_t bits;copy_bytes(&bits,&value,8);word64(bits);};
    staged.push_back(g.curves.size());staged.push_back(g.edges.size());
    for(uint32_t i=0;i<query_count&&g.good();i++){auto v=area(g,Q::from_double(c.numbers,queries[i*4]),Q::from_double(c.numbers,queries[i*4+1]),Q::from_double(c.numbers,queries[i*4+2]),Q::from_double(c.numbers,queries[i*4+3]));number(lower(v.lower));number(upper(v.upper));}
    for(uint32_t y=0;y<9&&g.good();y++)for(uint32_t x=0;x<9&&g.good();x++){
        Point p{Q::from_signed(c.numbers,int64_t(x)*19+7)/Q(61),Q::from_signed(c.numbers,int64_t(y)*17+3)/Q(59)};
        int original=filled(g,winding(g,p)),normalized=normalized_winding(g,p);
        if(normalized!=original){c.numbers.fail(SA_INK_RANGE);break;}staged.push_back(uint32_t(normalized));
    }
    word64(c.polynomial.operations);word64(c.numbers.work);word64(c.numbers.peak_bytes);
    if(!g.good())return c.numbers.status;if(staged.size()>capacity)return SA_INK_CAPACITY;
    for(uint32_t i=0;i<staged.size();i++)output[i]=static_cast<const Vector<uint32_t>&>(staged)[i];metadata[0]=int32_t(staged.size());metadata[1]=int32_t(query_count);metadata[2]=81;for(uint32_t i=3;i<8;i++)metadata[i]=0;return SA_INK_OK;
}
#endif
