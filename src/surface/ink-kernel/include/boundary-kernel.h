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
 * Source blocks may contribute many independently closed contours to a path. */
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
 * Callers cannot fabricate validity from these words: every entry point checks
 * the live lease record. Active/inflight leases keep immutable source, curves,
 * pair certificates and output records alive. No writable source/arena view is
 * returned. The host owner keeps the caller-owned backing buffers private.
 * A generation/key shortcut cannot replace actual captured source comparison.
 */
typedef struct { uint32_t owner,slot,generation,reserved; } SABoundaryLease;
typedef enum { SA_BOUNDARY_IMPLICIT_CLOSE=1,SA_BOUNDARY_NET_COLLINEAR=2,SA_BOUNDARY_REVERSED_SOURCE=4 } SABoundaryEdgeFlag;
typedef struct {
    SABoundarySourceKey source;
    uint32_t command_index,degree,from_vertex,to_vertex;
    double origin[2];
    double controls[8]; /* binary64 local to origin; derived only */
    double parameter_bounds[4]; /* outward t0.lower/upper,t1.lower/upper */
    uint32_t parameter_certificate[2],flags,reserved;
} SABoundaryEdge;
typedef struct {
    uint32_t source_commands,source_curves,exposed_edges,vertices;
    uint64_t polynomial_operations,limb_operations,pair_proofs,pair_cache_hits;
    uint64_t classifications,bvh_visits,retained_peak_bytes,workspace_peak_bytes;
} SABoundarySnapshot;
/* API declarations land with their complete implementation, validation and
 * Native/Wasm tests. The typed POD contract is intentionally additive to the
 * existing path ABI; no new wire/persistence identity or document format. */
#ifdef __cplusplus
}
#endif
#endif
