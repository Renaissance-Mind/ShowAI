// Test-only transport. No this-file ABI is exposed by the production kernel.
#include "quantization-block.hpp"
using namespace showai_boundary;
static uint32_t quantization_test_stage=0;
extern "C" uint32_t saqt_stage(){return quantization_test_stage;}
namespace {
inline void encode_q(Vector<uint32_t>&out,const Q&q){out.push_back(uint32_t(q.sign()));out.push_back(q.numerator().size());out.push_back(q.denominator().size());for(uint32_t i=0;i<q.numerator().size();i++)out.push_back(q.numerator().data()[i]);for(uint32_t i=0;i<q.denominator().size();i++)out.push_back(q.denominator().data()[i]);}
inline void encode_root(Vector<uint32_t>&out,const Root&r){out.push_back(r.definition().coefficients.size());for(const auto&q:r.definition().coefficients)encode_q(out,q);encode_q(out,r.lower);encode_q(out,r.upper);}
inline uint64_t source_hash(const Graph&g){uint64_t h=1469598103934665603ull;for(const auto&e:g.edges){h=hash_curve(g.curves[e.source].geometry)^h;h=hash_integer(h,e.a.lower.numerator());h=hash_integer(h,e.a.lower.denominator());h=hash_integer(h,e.a.upper.numerator());h=hash_integer(h,e.a.upper.denominator());h=hash_integer(h,e.b.lower.numerator());h=hash_integer(h,e.b.lower.denominator());h=hash_integer(h,e.b.upper.numerator());h=hash_integer(h,e.b.upper.denominator());h=hash_polynomial(h,e.a.definition());h=hash_polynomial(h,e.b.definition());}return h;}
inline bool verify_actual_blocks(const Graph&g,const BoundaryQuantizedGraph&cold,const BoundaryQuantizationOptions&o){
    auto&c=*g.context();Vector<Record<BoundaryQuantizedVertex>,1>records(c);
    for(const auto&v:cold.vertices)records.push_back(Record<BoundaryQuantizedVertex>::create(c,v));
    uint32_t processed=0;bool okay=true;
    for(const auto&v:cold.vertices){
        const auto&e=g.edges[v.representative_edge];const auto&curve=g.curves[e.source].geometry;const Root&parameter=v.endpoint?e.b:e.a;
        if(parameter.exact()){
            const Point point=at(curve,parameter.lower);BoundaryQuantizationMetrics metrics{};BoundaryQuantizedVertex derived{};
            if(!boundary_quantization::anchor_exact_point(point,v.vertex,v.representative_edge,v.endpoint,o,metrics,derived)||metrics.root_refinements||metrics.vertex_attempts!=1||derived.position[0]!=v.position[0]||derived.position[1]!=v.position[1]||derived.error_l1!=v.error_l1)return false;
        }
    }
    g.edges.each_chunk([&](uint32_t slot,const ChunkTree<Edge>::Chunk&chunk){
        if(!okay||!g.good())return;Vector<BoundaryQuantizedAnchorPair,1>pairs(c);
        for(const auto&e:chunk.values){BoundaryQuantizedAnchorPair pair;const uint32_t ids[2]={boundary_quantization::vertex_root(g,e.va),boundary_quantization::vertex_root(g,e.vb)};
            for(const auto&r:records){if(r.get()->vertex==ids[0])pair.a=r;if(r.get()->vertex==ids[1])pair.b=r;}pair.vertex_a=ids[0];pair.vertex_b=ids[1];pairs.push_back(pair);}
        SABoundaryBlockKey key{g.output_epoch,chunk.identity,chunk.revision,slot,0};BoundaryQuantizedBlock derived(c);
        if(quantize_boundary_block(g,key,pairs,o,derived)||derived.arcs.size()!=chunk.values.size()){okay=false;return;}
        for(uint32_t i=0;i<derived.arcs.size();i++){
            const auto&arc=derived.arcs[i];const auto&e=arc.edge;const BoundaryQuantizedEdge*expected=nullptr;
            for(const auto&candidate:cold.edges)if(&g.edges[candidate.edge]==&chunk.values[i]){expected=&candidate;break;}
            if(!expected||arc.a.get()!=pairs[i].a.get()||arc.b.get()!=pairs[i].b.get()||e.edge!=i||e.certificate_a!=2*i||e.certificate_b!=2*i+1){okay=false;break;}
            if(e.degree!=expected->degree||e.error_l1!=expected->error_l1||e.parameter_error_l1!=expected->parameter_error_l1||e.control_error_l1!=expected->control_error_l1){okay=false;break;}
            for(uint32_t j=0;j<8;j++)if(e.controls[j]!=expected->controls[j])okay=false;++processed;
        }
        // Representative metadata is not current endpoint topology. A proved
        // alias can preserve anchor bits/record metadata while the current graph
        // uses a different canonical index; this math stage checks that topology
        // against the actual source and includes endpoint adjustment in its bound.
        if(!pairs.empty()){
            BoundaryQuantizedVertex representative=*pairs[0].a.get();representative.vertex=0x7ffffffeu;
            pairs[0].a=Record<BoundaryQuantizedVertex>::create(c,representative);
            BoundaryQuantizedBlock metadata(c);
            if(quantize_boundary_block(g,key,pairs,o,metadata)||metadata.arcs[0].a.get()!=pairs[0].a.get()||metadata.arcs[0].edge.vertex_a!=pairs[0].vertex_a||metadata.arcs[0].a.get()->vertex!=0x7ffffffeu){okay=false;return;}
            for(uint32_t j=0;j<8;j++)if(metadata.arcs[0].edge.controls[j]!=derived.arcs[0].edge.controls[j])okay=false;
        }
        // Actual changed/retired keys are rejected, without replacing old bytes.
        const auto*old=derived.arcs.empty()?nullptr:&derived.arcs[0];key.revision++;
        if(quantize_boundary_block(g,key,pairs,o,derived)!=SA_INK_INVALID||(!derived.arcs.empty()&&old!=&derived.arcs[0]))okay=false;
        key.revision--;Vector<BoundaryQuantizedAnchorPair,1>missing(c);
        if(quantize_boundary_block(g,key,missing,o,derived)!=SA_INK_INVALID||old!=&derived.arcs[0])okay=false;
        if(chunk.values.size()>1){auto limited=o;limited.maximum_edges=chunk.values.size()-1;
            if(quantize_boundary_block(g,key,pairs,limited,derived)!=SA_INK_CAPACITY||old!=&derived.arcs[0])okay=false;}
        // A failure after earlier arcs were staged cannot publish a partial block.
        pairs[pairs.size()-1].vertex_b=0x7fffffffu;
        const uint64_t work_limit=c.max_work;
        if(quantize_boundary_block(g,key,pairs,o,derived)!=SA_INK_INVALID||old!=&derived.arcs[0])okay=false;
        c.begin_work(work_limit);
    });
    return okay&&g.good()&&processed==cold.edges.size();
}
inline bool overlap_memory(const void*a,uint64_t na,const void*b,uint64_t nb){return na&&nb&&uint64_t((uintptr_t)a)<uint64_t((uintptr_t)b)+nb&&uint64_t((uintptr_t)b)<uint64_t((uintptr_t)a)+na;}
}
extern "C" uint32_t saqt_fixture(uint32_t fixture,double tolerance,uint32_t refinements,uint32_t max_vertices,uint32_t max_edges,uint64_t work_limit,void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
    quantization_test_stage=0;
    if(fixture>12||!memory||((uintptr_t)memory&15u)||!output||((uintptr_t)output&3u)||!capacity||overlap_memory(memory,bytes,output,uint64_t(capacity)*4))return SA_INK_INVALID;
    PolynomialContext c;if(!c.numbers.initialize(memory,bytes,10000000000ull))return c.numbers.status;c.polynomial.max_operations=50000000;
    uint32_t result=SA_INK_OK;
    {
        Vector<SAInkPathCommand>commands(c.numbers);Vector<SABoundaryPath>paths(c.numbers);Vector<SABoundarySourceBlock>sources(c.numbers);
        auto cmd=[&](uint32_t op,double a=0,double b=0,double d=0,double e=0,double f=0,double g=0){commands.push_back({op,0,{a,b,d,e,f,g}});};
        auto path=[&](uint32_t first,uint32_t fill=0){uint32_t index=paths.size();paths.push_back({fill,index?1u:0u,{0,0}});SABoundarySourceBlock source{};source.key.words[0]=index+1;source.path_index=index;source.first_command=first;source.command_count=commands.size()-first;source.affine[0]=source.affine[3]=1;sources.push_back(source);};
        BoundaryQuantizationOptions options{};options.maximum_error_l1=tolerance;options.maximum_refinements=refinements;options.maximum_vertices=max_vertices;options.maximum_edges=max_edges;
        if(fixture==0||fixture==3||fixture>=10){cmd(0,0,0);cmd(1,1,0);cmd(1,1,1);cmd(1,0,1);cmd(4);if(fixture==3){cmd(0,.25,.75);cmd(1,.75,.75);cmd(1,.75,.25);cmd(1,.25,.25);cmd(4);}path(0);}
        else if(fixture==1||fixture==4||fixture==5||fixture==7){cmd(0,0,0);cmd(2,.5,1,1,0);cmd(4);path(0);uint32_t first=commands.size();double y=fixture==4?.5:fixture==5?.5-0x1p-48:.25;cmd(0,-1,y);cmd(1,2,y);cmd(1,2,2);cmd(1,-1,2);cmd(4);path(first);}
        else if(fixture==2){cmd(0,4,1.5);cmd(3,-4.0/3.0,31.0/6.0,-4.0/3.0,5.0/6.0,4,4.5);cmd(4);path(0);}
        else if(fixture==6||fixture==9){cmd(0,0,1e-40);cmd(2,.5,-1e-40,1,1e-40);cmd(4);path(0);uint32_t first=commands.size();cmd(0,-1,-1);cmd(1,2,-1);cmd(1,2,1e-80);cmd(1,-1,1e-80);cmd(4);path(first);options.origin[0]=.5;}
        else if(fixture==8){cmd(0,0,0);cmd(3,0,0,0,1,1,1);cmd(4);path(0);}
        if(fixture==7){for(uint32_t i=0;i<sources.size();i++){sources[i].affine[0]=-2;sources[i].affine[1]=.5;sources[i].affine[2]=1.25;sources[i].affine[3]=3;sources[i].affine[4]=1e12;sources[i].affine[5]=-1e12;}options.origin[0]=1e12;options.origin[1]=-1e12;}
        SABoundaryBudget budget{};budget.max_commands=100;budget.max_curves=64;budget.max_pairs=1000;budget.max_cuts=512;budget.max_edges=512;budget.max_sources=8;budget.max_paths=2;
        quantization_test_stage=1;Graph graph(c,budget);capture(graph,paths.begin(),paths.size(),sources.begin(),sources.size(),commands.begin(),commands.size());
        if(fixture==9){
            // Independent analytic near-root lens. The generic RUR graph path
            // currently returns RANGE for this input (fixture6); this separate
            // test constructs its two certified arcs by the known x=t / y=eps
            // relation, using the real captured curves and Sturm certificates.
            const uint32_t quadratic=static_cast<const Graph&>(graph).blocks[0].curves[0].curve,line=static_cast<const Graph&>(graph).blocks[1].curves[2].curve;
            const auto&curve=static_cast<const Graph&>(graph).curves[quadratic].geometry;
            auto endpoints=roots(curve.y-Polynomial(c,Q::from_double(c.numbers,1e-80)));
            if(endpoints.size()!=2||!graph.good())return SA_INK_RANGE;
            const uint32_t a=vertex(graph),b=vertex(graph);Edge lower{};lower.source=quadratic;lower.va=a;lower.vb=b;lower.a=endpoints[0];lower.b=endpoints[1];lower.direction=1;append_edge(graph,lower);
            Edge upper{};upper.source=line;upper.va=a;upper.vb=b;upper.a=affine_root(endpoints[0],Q(1)/Q(3),Q(1)/Q(3));upper.b=affine_root(endpoints[1],Q(1)/Q(3),Q(1)/Q(3));upper.direction=-1;append_edge(graph,upper);
        }else construct(graph);if(!graph.good())return c.numbers.status;
        if(fixture==10||fixture==11){
            Edge changed=static_cast<const Graph&>(graph).edges[0];
            if(fixture==10)changed.b=changed.a;else{Root old=changed.a;changed.a=changed.b;changed.b=old;}
            Vector<Edge,1>replacement(c.numbers);replacement.push_back(changed);
            graph.edges.set(changed.source,graph.curves[changed.source].identity,graph.next_output_revision++,replacement);
        }
        quantization_test_stage=2;const uint64_t before=source_hash(graph);
        c.numbers.begin_work(work_limit);c.polynomial.operations=0;c.numbers.peak_bytes=c.numbers.live_bytes;if(fixture==12)c.polynomial.max_operations=1;
        BoundaryQuantizedGraph quantized(c.numbers);quantized.options.origin[0]=123;BoundaryQuantizedVertex sentinel{};sentinel.vertex=0x5a5a5a5a;quantized.vertices.push_back(sentinel);
        quantization_test_stage=3;result=quantize_boundary_graph(graph,options,quantized);
        if(result){if(quantized.options.origin[0]!=123||quantized.vertices.size()!=1||static_cast<const Vector<BoundaryQuantizedVertex>&>(quantized.vertices)[0].vertex!=0x5a5a5a5a)return SA_INK_INVALID;return result;}
        if(before!=source_hash(graph)||!verify_actual_blocks(graph,quantized,options)||before!=source_hash(graph))return SA_INK_INVALID;
        quantization_test_stage=4;Vector<uint32_t>staged(c.numbers);staged.push_back(0x53415131);staged.push_back(fixture);staged.push_back(quantized.vertices.size());staged.push_back(quantized.edges.size());
        auto word64=[&](uint64_t v){staged.push_back(uint32_t(v));staged.push_back(uint32_t(v>>32));};auto number=[&](double v){uint64_t bits;copy_bytes(&bits,&v,8);word64(bits);};
        number(options.origin[0]);number(options.origin[1]);number(options.maximum_error_l1);
        word64(quantized.metrics.root_refinements);word64(quantized.metrics.vertex_attempts);word64(quantized.metrics.edge_attempts);word64(quantized.metrics.polynomial_operations);word64(quantized.metrics.limb_operations);word64(quantized.metrics.arena_peak_bytes);
        for(const auto&v:quantized.vertices){staged.push_back(v.vertex);staged.push_back(v.representative_edge);staged.push_back(v.endpoint);number(v.position[0]);number(v.position[1]);number(v.error_l1);}
        for(const auto&e:quantized.edges){for(auto word:e.source.words)staged.push_back(word);staged.push_back(e.command_index);staged.push_back(e.source_flags);staged.push_back(e.edge);staged.push_back(e.curve);word64(e.curve_identity);staged.push_back(e.degree);staged.push_back(e.vertex_a);staged.push_back(e.vertex_b);staged.push_back(uint32_t(e.direction));staged.push_back(e.certificate_a);staged.push_back(e.certificate_b);for(double p:e.controls)number(p);number(e.error_l1);number(e.parameter_error_l1);number(e.control_error_l1);
            const auto&original=static_cast<const Graph&>(graph).edges[e.edge];const auto&curve=static_cast<const Graph&>(graph).curves[original.source].geometry;staged.push_back(curve.controls.size());for(const auto&p:curve.controls){encode_q(staged,p.x);encode_q(staged,p.y);}encode_root(staged,original.a);encode_root(staged,original.b);
        }
        if(!graph.good())return c.numbers.status;if(staged.size()+1>capacity)return SA_INK_CAPACITY;output[0]=staged.size();for(uint32_t i=0;i<staged.size();i++)output[i+1]=static_cast<const Vector<uint32_t>&>(staged)[i];
    }
    if(c.numbers.live_bytes)return SA_INK_INVALID;return result;
}
#include "../boundary-kernel.cpp"
#include "quantization-lifetime-test-api.cpp"
#include "quantization-state-test-api.cpp"
#include "wasm-runtime.cpp"
