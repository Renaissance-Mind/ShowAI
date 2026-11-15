#ifndef SHOWAI_BOUNDARY_KERNEL_H
#define SHOWAI_BOUNDARY_KERNEL_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif
#define SA_BOUNDARY_ABI_VERSION 1u
typedef struct { uint32_t words[4]; } SABoundarySourceKey;
typedef enum { SA_BOUNDARY_NONZERO=0,SA_BOUNDARY_EVENODD=1 } SABoundaryFill;
typedef enum { SA_BOUNDARY_PAINT=0,SA_BOUNDARY_CLIP=1 } SABoundaryPathRole;
typedef struct { uint32_t fill,role,reserved[2]; } SABoundaryPath;
typedef struct {
    SABoundarySourceKey key;
    uint32_t path_index,first_command,command_count,reserved;
    double affine[6];
} SABoundarySourceBlock;
typedef struct {
    uint32_t max_commands,max_curves,max_pairs,max_cuts,max_edges,max_leases;
    uint32_t max_sources,max_paths,max_polynomial_degree,max_stored_bits;
    uint64_t max_polynomial_operations,max_limb_operations;
    uint32_t retained_bytes,workspace_bytes;
} SABoundaryBudget;
typedef struct { uint64_t owner;uint32_t epoch,slot,generation,reserved; } SABoundaryLease;
typedef enum { SA_BOUNDARY_UPSERT_SOURCE=0,SA_BOUNDARY_REMOVE_SOURCE=1 } SABoundaryMutationOperation;
typedef struct {
    uint32_t operation,reserved[3];
    SABoundarySourceBlock source;
} SABoundarySourceMutation;
typedef enum { SA_BOUNDARY_IMPLICIT_CLOSE=1,SA_BOUNDARY_NET_COLLINEAR=2,SA_BOUNDARY_REVERSED_SOURCE=4 } SABoundaryEdgeFlag;
typedef struct {
    SABoundarySourceKey source;
    uint32_t command_index,degree,from_vertex,to_vertex;
    double origin[2];
    double controls[8];
    double parameter_bounds[4];
    uint32_t parameter_certificate[2],flags;
    int32_t direction;
} SABoundaryEdge;
typedef struct {uint64_t epoch,curve,revision;uint32_t slot,reserved;} SABoundaryBlockKey;
typedef struct {SABoundaryBlockKey key;uint32_t edges,reserved;} SABoundaryBlock;
typedef struct {SABoundaryBlockKey before,after;uint32_t before_edges,after_edges;} SABoundaryBlockChange;
typedef struct {uint64_t retained_limit_bytes,workspace_limit_bytes,backing_bytes,arena_usable_bytes,live_bytes,peak_bytes;} SABoundaryCapacity;
typedef struct {uint32_t base_generation,reset,change_count,block_count;uint64_t assembled_arcs,flow_vertices,retained_blocks,output_tree_nodes,output_edges;} SABoundaryBlocksSnapshot;
typedef struct {
    uint32_t source_commands,source_curves,exposed_edges,vertices;
    uint64_t polynomial_operations,limb_operations,pair_proofs,pair_cache_hits;
    uint64_t classifications,bvh_visits,retained_peak_bytes,workspace_peak_bytes;
    uint64_t arena_peak_bytes,baseline_bytes,prepared_bytes;
} SABoundarySnapshot;
uint32_t sa_boundary_state_bytes(void);
uint32_t sa_boundary_capacity(void*state,SABoundaryCapacity*output);
uint32_t sa_boundary_initialize(void*state,uint32_t state_bytes,uint32_t owner_namespace,void*arena,uint32_t arena_bytes,const SABoundaryBudget*budget);
uint32_t sa_boundary_prepare(void*state,const SABoundaryLease*base,const SABoundaryPath*paths,uint32_t path_count,const SABoundarySourceBlock*sources,uint32_t source_count,const SAInkPathCommand*commands,uint32_t command_count,SABoundaryLease*output);
uint32_t sa_boundary_update(void*state,const SABoundaryLease*base,const SABoundarySourceMutation*mutations,uint32_t mutation_count,const SAInkPathCommand*commands,uint32_t command_count,SABoundaryLease*output);
uint32_t sa_boundary_retain(void*state,SABoundaryLease lease);
uint32_t sa_boundary_release(void*state,SABoundaryLease lease);
uint32_t sa_boundary_snapshot(void*state,SABoundaryLease lease,SABoundarySnapshot*output);
uint32_t sa_boundary_copy_edges(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryEdge*output,uint32_t capacity);
uint32_t sa_boundary_blocks_snapshot(void*state,SABoundaryLease lease,SABoundaryBlocksSnapshot*output);
uint32_t sa_boundary_copy_blocks(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryBlock*output,uint32_t capacity);
uint32_t sa_boundary_copy_block_changes(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryBlockChange*output,uint32_t capacity);
uint32_t sa_boundary_copy_block_edges(void*state,SABoundaryLease lease,SABoundaryBlockKey block,uint32_t first,uint32_t count,SABoundaryEdge*output,uint32_t capacity);
uint32_t sa_boundary_copy_block_parameter(void*state,SABoundaryLease lease,SABoundaryBlockKey block,uint32_t certificate,uint32_t*output,uint32_t capacity,uint32_t*required);
uint32_t sa_boundary_copy_parameter(void*state,SABoundaryLease lease,uint32_t certificate,uint32_t*output,uint32_t capacity,uint32_t*required);
uint32_t sa_boundary_measure_coverage(void*state,SABoundaryLease lease,const double*rectangles,uint32_t count,double*output,uint32_t capacity);
uint32_t sa_boundary_destroy(void*state);
#ifdef __cplusplus
}
#endif
#endif
