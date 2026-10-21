#ifndef SHOWAI_INK_INPUT_KERNEL_H
#define SHOWAI_INK_INPUT_KERNEL_H
#include "showai_ink.h"
#ifdef __cplusplus
extern "C" {
#endif

#define SA_INK_INPUT_VERSION 1u
#define SA_INK_INPUT_MAX_RAW 1048576u
#define SA_INK_INPUT_MAX_PREDICTED 128u
#define SA_INK_INPUT_FRAGMENT_SAMPLES 20000u
typedef enum { SA_INPUT_FIXED=0, SA_INPUT_PRESSURE=1, SA_INPUT_CALLIGRAPHY=2 } SAInkInputMode;
/* IDs are monotonically increasing actual-sample identities. Platform estimate
 * tokens are mapped to IDs by the input host. Predictions never own actual IDs.
 * expected_properties uses the host's three supported force/orientation bits. */
typedef struct {
    double x,y,time,force,azimuth,altitude;
    uint32_t id,expected_properties,estimation_index,flags;
} SAInkInputPoint;
typedef struct {
    double width,creation_zoom,fit_tolerance,flatten_tolerance;
    double position_window,jitter_window,force_backward,force_forward,force_time;
    double min_fraction,max_fraction,curve_blend,estimate_timeout;
    uint32_t mode,version;
} SAInkInputConfig;
typedef struct {
    double points[8];
    uint32_t first_raw,last_raw,sample_offset,steps;
    uint32_t flags,reserved;
} SAInkInputCurve;
typedef struct {
    uint32_t actual_count,predicted_count,curve_count,finalized_curves;
    uint32_t first_changed_curve,sample_count,fragment_count,finished;
    uint32_t filtered_points,fit_evaluations,generation,reserved;
} SAInkInputSnapshot;

uint32_t sa_input_sizeof_point(void);
uint32_t sa_input_sizeof_config(void);
uint32_t sa_input_sizeof_curve(void);
uint32_t sa_input_sizeof_snapshot(void);
uint32_t sa_input_state_bytes(uint32_t raw_capacity);
SAInkStatus sa_input_initialize(void *state,uint32_t bytes,uint32_t raw_capacity,const SAInkInputConfig *config);
/* Growth is explicit and infrequent; source remains usable and unchanged. */
SAInkStatus sa_input_relocate(const void *source,void *destination,uint32_t bytes,uint32_t capacity);
/* All arguments are checked before mutation. An empty predicted batch clears
 * the ephemeral tail. Actual points are never discarded by prediction updates. */
SAInkStatus sa_input_push(void *state,const SAInkInputPoint *actual,uint32_t actual_count,
                        const SAInkInputPoint *predicted,uint32_t predicted_count);
/* Corrections remain legal after finish. They explicitly revise an affected
 * suffix and can invalidate a previously finalized prefix. */
SAInkStatus sa_input_correct(void *state,const SAInkInputPoint *replacement);
SAInkStatus sa_input_finish(void *state);
SAInkStatus sa_input_snapshot(const void *state,SAInkInputSnapshot *snapshot);
SAInkStatus sa_input_copy_raw(const void *state,uint32_t start,uint32_t count,SAInkInputPoint *output,uint32_t capacity);
SAInkStatus sa_input_copy_curves(const void *state,uint32_t start,uint32_t count,SAInkInputCurve *output,uint32_t capacity);
SAInkStatus sa_input_copy_samples(const void *state,uint32_t start,uint32_t count,SAInkSample *output,uint32_t capacity);
/* Fragments overlap one endpoint and belong to ONE logical opacity composite.
 * The host must preserve that group; independently alpha-compositing fragments
 * is not an equivalent export. Predictions must be cleared with finish first. */
SAInkStatus sa_input_fragment_range(const void *state,uint32_t fragment,uint32_t *start,uint32_t *count);
#ifdef __cplusplus
}
#endif
#endif
