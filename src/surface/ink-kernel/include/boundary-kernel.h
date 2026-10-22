#ifndef SHOWAI_BOUNDARY_KERNEL_H
#define SHOWAI_BOUNDARY_KERNEL_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif
#define SA_BOUNDARY_ABI_VERSION 1u
/* This is derived geometry, never a persisted ink model. A source key indexes
 * captured source; it is NOT proof that source contents have not changed. */
typedef struct { uint32_t words[4]; } SABoundarySourceKey;
typedef enum { SA_BOUNDARY_NONZERO=0,SA_BOUNDARY_EVENODD=1 } SABoundaryFill;
typedef enum { SA_BOUNDARY_PAINT=0,SA_BOUNDARY_CLIP=1 } SABoundaryPathRole;
/* Logical path0 is the paint. Later paths are actual clip membership tests.
 * Source blocks may contribute many independently closed contours to a path.
 * The dimension is arena-owned and budgeted, not a fixed clip-depth limit. */
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
/* Leases are owner-issued opaque references, scoped to one initialized state.
 * Every entry point checks the exact state binding, host epoch and live lease
 * record. These process-local handles never establish source/data equality. Active/inflight leases keep immutable source, curves,
 * pair certificates and output records alive. No writable source/arena view is
 * returned. The host owner keeps the caller-owned backing buffers private.
 * A generation/key shortcut cannot replace actual captured source comparison.
 */
typedef struct { uint64_t owner;uint32_t epoch,slot,generation,reserved; } SABoundaryLease;
typedef enum { SA_BOUNDARY_UPSERT_SOURCE=0,SA_BOUNDARY_REMOVE_SOURCE=1 } SABoundaryMutationOperation;
typedef struct {
    uint32_t operation,reserved[3];
    /* A removal contains only key; all remaining source bytes must be zero. */
    SABoundarySourceBlock source;
} SABoundarySourceMutation;
typedef enum { SA_BOUNDARY_IMPLICIT_CLOSE=1,SA_BOUNDARY_NET_COLLINEAR=2,SA_BOUNDARY_REVERSED_SOURCE=4 } SABoundaryEdgeFlag;
typedef struct {
    SABoundarySourceKey source;
    uint32_t command_index,degree,from_vertex,to_vertex;
    double origin[2];
    double controls[8]; /* binary64 local to origin; derived only */
    double parameter_bounds[4]; /* outward t0.lower/upper,t1.lower/upper */
    uint32_t parameter_certificate[2],flags;
    int32_t direction;
} SABoundaryEdge;
/* Keys address immutable derived records inside a validated lease. They never
 * prove source equality and never cross a host owner / WASM instance domain. */
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
/* State and its arena are private to one serial host owner. State starts zeroed.
 * owner_namespace is a nonzero host epoch. When reusing the same state storage
 * after destroy, the host uses a fresh epoch. A lease additionally binds the
 * exact state address within its Native process or WASM linear memory. The host
 * additionally binds leases to the actual WASM instance: independent instances
 * can have identical offsets/epochs and C cannot distinguish those domains.
 * The arena cannot alias any
 * input/output/state bytes and must remain stable until successful destroy.
 * All budgets include active, cached, prepared and externally retained leases.
 * prepare is synchronous, bounded and failure-atomic; base must be the owner's
 * actual latest complete lease (or null only on its first publication). */
uint32_t sa_boundary_state_bytes(void);
/* Cold admission/diagnostics: reports the allocator's actual usable power-of-two
 * capacity, not merely the supplied buffer length. Does not reset work/peaks. */
uint32_t sa_boundary_capacity(void*state,SABoundaryCapacity*output);
uint32_t sa_boundary_initialize(void*state,uint32_t state_bytes,uint32_t owner_namespace,void*arena,uint32_t arena_bytes,const SABoundaryBudget*budget);
uint32_t sa_boundary_prepare(void*state,const SABoundaryLease*base,const SABoundaryPath*paths,uint32_t path_count,const SABoundarySourceBlock*sources,uint32_t source_count,const SAInkPathCommand*commands,uint32_t command_count,SABoundaryLease*output);
/* Current captured fill rules/clip paths remain in force. Each source key
 * occurs once; packet order has no Boolean meaning. Actual old/new capture
 * determines affected support. Same key with changed bytes is not unchanged.
 * Full prepare handles changes to the logical path definitions themselves. */
uint32_t sa_boundary_update(void*state,const SABoundaryLease*base,const SABoundarySourceMutation*mutations,uint32_t mutation_count,const SAInkPathCommand*commands,uint32_t command_count,SABoundaryLease*output);
uint32_t sa_boundary_retain(void*state,SABoundaryLease lease);
uint32_t sa_boundary_release(void*state,SABoundaryLease lease);
uint32_t sa_boundary_snapshot(void*state,SABoundaryLease lease,SABoundarySnapshot*output);
uint32_t sa_boundary_copy_edges(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryEdge*output,uint32_t capacity);
/* Live consumers apply every delta against base_generation. reset denotes an
 * explicit complete preparation. A block with a zero key is absent. Changes
 * own their captured old/new keys; unchanged blocks keep actual immutable
 * records and their key. Camera updates need none of these copy operations.
 * The legacy complete edge export above is intentionally explicit work. */
uint32_t sa_boundary_blocks_snapshot(void*state,SABoundaryLease lease,SABoundaryBlocksSnapshot*output);
/* Explicit complete block enumeration for cold attachment/recovery. */
uint32_t sa_boundary_copy_blocks(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryBlock*output,uint32_t capacity);
uint32_t sa_boundary_copy_block_changes(void*state,SABoundaryLease lease,uint32_t first,uint32_t count,SABoundaryBlockChange*output,uint32_t capacity);
uint32_t sa_boundary_copy_block_edges(void*state,SABoundaryLease lease,SABoundaryBlockKey block,uint32_t first,uint32_t count,SABoundaryEdge*output,uint32_t capacity);
/* Certificates from block-copy are local to that exact immutable block key. */
uint32_t sa_boundary_copy_block_parameter(void*state,SABoundaryLease lease,SABoundaryBlockKey block,uint32_t certificate,uint32_t*output,uint32_t capacity,uint32_t*required);
/* Exact parameter certificate: [coefficient_count, Q..., lowerQ, upperQ]. Each
 * Q is [sign-as-int32,numerator_count,denominator_count,LE32 limbs...]. The
 * source polynomial and isolating interval remain authoritative. controls and
 * origin in SABoundaryEdge are outward-lower binary64 approximations of the
 * original (not flattened) canonical curve; interval endpoints are NOT silently
 * substituted into it. A renderer chooses an explicit quantization policy.
 * count-query: output may be null only when capacity is zero. */
uint32_t sa_boundary_copy_parameter(void*state,SABoundaryLease lease,uint32_t certificate,uint32_t*output,uint32_t capacity,uint32_t*required);
/* Bounded mathematical query/validation, not the render loop. Rectangles are
 * [left,bottom,right,top]; each output pair encloses the normalized Boolean
 * pixel area. No quadrature samples or flattened geometry establish validity.
 * Explicit budget/range failures leave the whole caller output unchanged. */
uint32_t sa_boundary_measure_coverage(void*state,SABoundaryLease lease,const double*rectangles,uint32_t count,double*output,uint32_t capacity);
/* Fails while any external lease remains. Does not invalidate live leases. */
uint32_t sa_boundary_destroy(void*state);
#ifdef __cplusplus
}
#endif
#endif
