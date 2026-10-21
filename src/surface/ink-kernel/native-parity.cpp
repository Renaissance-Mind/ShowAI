// Executable regression harness; not part of the freestanding runtime target.
#include "include/showai_ink.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
static void read(void *p,size_t size,size_t count=1){if(std::fread(p,size,count,stdin)!=count)std::exit(90);}
static void write(const void *p,size_t size,size_t count=1){if(std::fwrite(p,size,count,stdout)!=count)std::exit(91);}
static void check(SAInkStatus status){if(status!=SA_INK_OK){uint32_t code=(uint32_t)status;write(&code,4);std::exit(1);}}
int main(){
    uint32_t header[6];read(header,4,6);uint32_t n=header[0],commands_count=header[3]==UINT32_MAX ? 0 : header[3],queries=header[4],segments=header[5];
    if(n>SA_INK_MAX_SAMPLES||commands_count>SA_INK_MAX_MASK_COMMANDS||queries>100000||segments>100000)return 92;
    SAInkStyle style={};style.brush=header[1];style.pressure=header[2];read(&style.source_width,8);read(&style.width,8);read(style.affine,8,6);
    std::vector<SAInkSample> samples(n),resolved(n);read(samples.data(),sizeof(SAInkSample),n);
    std::vector<SAInkPathCommand> commands(commands_count);read(commands.data(),sizeof(SAInkPathCommand),commands_count);
    std::vector<SAInkPoint> query(queries);read(query.data(),sizeof(SAInkPoint),queries);
    std::vector<double> segment(segments*5);read(segment.data(),8,segments*5);
    SAInkCounts counts,mask_counts;check(sa_ink_geometry_counts(samples.data(),n,0,n,&counts));check(sa_ink_mask_counts(commands.data(),commands_count,&mask_counts));
    std::vector<SAInkPoint> points(counts.points),mask_points(mask_counts.points);
    std::vector<SAInkContour> contours(counts.contours),mask_contours(mask_counts.contours+1);
    std::vector<SAInkVertex> vertices(counts.vertices);SAInkBounds bounds;
    check(sa_ink_resolve_samples(samples.data(),n,&style,resolved.data(),n));
    check(sa_ink_build(samples.data(),n,0,n,&style,points.data(),counts.points,contours.data(),counts.contours,vertices.data(),counts.vertices,&bounds));
    check(sa_ink_flatten_mask(commands.data(),commands_count,style.affine,mask_points.data(),mask_counts.points,mask_contours.data(),mask_counts.contours));
    // UINT32_MAX denotes absent mask; zero is an explicitly empty mask.
    const SAInkContour *mask=header[3]==UINT32_MAX ? nullptr : mask_contours.data();
    uint32_t output[6]={0,counts.points,counts.contours,counts.vertices,mask_counts.points,mask_counts.contours};write(output,4,6);
    write(&bounds,sizeof(bounds));write(resolved.data(),sizeof(SAInkSample),n);write(points.data(),sizeof(SAInkPoint),counts.points);
    write(contours.data(),sizeof(SAInkContour),counts.contours);write(vertices.data(),sizeof(SAInkVertex),counts.vertices);
    write(mask_points.data(),sizeof(SAInkPoint),mask_counts.points);write(mask_contours.data(),sizeof(SAInkContour),mask_counts.contours);
    for(SAInkPoint q:query){SAInkHit hit;check(sa_ink_hit(points.data(),counts.points,contours.data(),counts.contours,mask_points.data(),mask_counts.points,mask,mask_counts.contours,q.x,q.y,&hit));write(&hit,sizeof(hit));}
    for(uint32_t i=0;i<segments;++i){double *v=segment.data()+i*5;uint32_t required=0,hit=0;
        SAInkStatus status=sa_ink_segment_hit(points.data(),counts.points,contours.data(),counts.contours,mask_points.data(),mask_counts.points,mask,mask_counts.contours,v[0],v[1],v[2],v[3],v[4],nullptr,0,&required,&hit);
        if(status==SA_INK_CAPACITY){std::vector<double> scratch(required);status=sa_ink_segment_hit(points.data(),counts.points,contours.data(),counts.contours,mask_points.data(),mask_counts.points,mask,mask_counts.contours,v[0],v[1],v[2],v[3],v[4],scratch.data(),required,&required,&hit);}
        check(status);write(&hit,4);
    }
    return 0;
}
