// Test-only ABI; never included in a shipped module/provenance.
#include "conditioned-klm.hpp"
using namespace showai_boundary;
extern "C" uint32_t sack_fixture(uint32_t fixture,void*memory,uint32_t bytes,uint32_t*output,uint32_t capacity){
    if(fixture>14||!memory||!output||!capacity||((uintptr_t)memory&15)||((uintptr_t)output&3))return SA_INK_INVALID;
    PolynomialContext c;if(!c.numbers.initialize(memory,bytes,1000000000ull))return c.numbers.status;
    uint32_t status=0;
    {
        BoundaryQuantizedEdge e{};e.degree=3;e.direction=fixture==6?-1:1;e.vertex_a=4;e.vertex_b=7;e.edge=3;e.curve_identity=123;
        const double cases[][8]={{0,0,1,1,0,0,0,0},{-1,0,0,1,1,0,0,0},{0,0,0,1,1,1,1,0},{0,0,0,0,1,0,3,1},{0,0,1,1e-30,2,-1e-30,3,0},{4,1.5,-4.0/3,31.0/6,-4.0/3,5.0/6,4,4.5}};
        uint32_t selected=fixture<=5?fixture:2;e.degree=selected==0?1:selected==1?2:3;
        for(uint32_t i=0;i<8;i++)e.controls[i]=cases[selected][i];
        BoundaryKLMOptions options{};options.maximum_residual_over_gradient_pixels=1e-3;options.maximum_patches=256;options.maximum_vertices=1024;options.maximum_depth=12;options.maximum_conditioning_cells=4096;options.maximum_conditioning_depth=12;
        if(fixture==6){options.source_to_pixels[0]=-2;options.source_to_pixels[1]=.5;options.source_to_pixels[2]=1.25;options.source_to_pixels[3]=3;}
        if(fixture==7){options.source_to_pixels[0]=1e30;options.source_to_pixels[3]=1e-30;}
        if(fixture==8)options.maximum_residual_over_gradient_pixels=0;
        if(fixture==9)options.maximum_vertices=1;
        if(fixture==10){uint64_t bits=0x7ff8000000000000ull;copy_bytes(&e.controls[0],&bits,8);}
        if(fixture==11)e.error_l1=1;
        if(fixture==13)options.maximum_conditioning_cells=1;
        if(fixture==14){e.vertex_b=e.vertex_a;const double closed[8]={0,0,-1,1,1,1,0,0};for(uint32_t i=0;i<8;i++)e.controls[i]=closed[i];}
        if(fixture==12){
            const SAInkPathCommand source_commands[]={{0,0,{0,0}},{3,0,{0,1,1,1,1,0}},{4,0,{}}};
            const SABoundaryPath path{0,0,{0,0}};SABoundarySourceBlock source{};source.key.words[0]=17;source.command_count=3;source.affine[0]=source.affine[3]=1;
            SABoundaryBudget budget{};budget.max_commands=3;budget.max_curves=8;budget.max_pairs=64;budget.max_cuts=64;budget.max_edges=32;budget.max_sources=1;budget.max_paths=1;
            Graph graph(c,budget);capture(graph,&path,1,&source,1,source_commands,3);construct(graph);if(!graph.good())return c.numbers.status;
            BoundaryQuantizationOptions quantization{};quantization.maximum_error_l1=1e-9;quantization.maximum_refinements=1000;quantization.maximum_vertices=32;quantization.maximum_edges=32;
            BoundaryQuantizedGraph q(c.numbers);auto result=quantize_boundary_graph(graph,quantization,q);if(result)return result;bool found=false;
            for(const auto&arc:q.edges)if(arc.degree==3){e=arc;found=true;break;}if(!found)return SA_INK_INVALID;
        }
        BoundaryKLMArc out(c.numbers);out.closure.source_edge=0x5a5a5a5a;BoundaryKLMReason reason=boundary_klm_none;
        status=condition_quantized_boundary_arc(c,e,options,out,reason);
        if(status&&out.closure.source_edge!=0x5a5a5a5a)return SA_INK_INVALID;
        Vector<uint32_t>staged(c.numbers);staged.push_back(status);staged.push_back(reason);
        auto u64=[&](uint64_t v){staged.push_back(uint32_t(v));staged.push_back(uint32_t(v>>32));};auto number=[&](double v){uint64_t bits;copy_bytes(&bits,&v,8);u64(bits);};auto single=[&](float v){uint32_t bits;copy_bytes(&bits,&v,4);staged.push_back(bits);};
        if(!status){
            staged.push_back(e.degree);staged.push_back(uint32_t(e.direction));for(double value:e.controls)number(value);
            staged.push_back(out.closure.from_vertex);staged.push_back(out.closure.to_vertex);for(double v:out.closure.from)number(v);for(double v:out.closure.to)number(v);
            staged.push_back(out.conditioning_cells);staged.push_back(out.patches.size());staged.push_back(out.vertices.size());staged.push_back(out.audits.size());
            for(const auto&p:out.patches){staged.push_back(p.mode);staged.push_back(uint32_t(p.winding));single(p.sign);staged.push_back(p.first_vertex);staged.push_back(p.vertex_count);for(double x:p.origin)number(x);}
            for(const auto&v:out.vertices){single(v.x);single(v.y);single(v.k);single(v.l);single(v.m);}
            for(const auto&a:out.audits){staged.push_back(a.first_vertex);staged.push_back(a.mode);number(a.residual_upper);number(a.gradient_lower_source);number(a.gradient_lower_pixels);number(a.residual_over_gradient_pixels);number(a.source_quantization_pixels);}
        }
        if(c.numbers.status)return c.numbers.status;if(staged.size()+1>capacity)return SA_INK_CAPACITY;
        output[0]=staged.size();for(uint32_t i=0;i<staged.size();i++)output[i+1]=static_cast<const Vector<uint32_t>&>(staged)[i];
    }
    return c.numbers.live_bytes?SA_INK_INVALID:SA_INK_OK;
}
#include "wasm-runtime.cpp"
