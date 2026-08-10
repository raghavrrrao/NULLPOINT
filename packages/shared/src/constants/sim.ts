/**
 * Simulation timing. One source of truth — a rate that appears in two files is
 * a bug (`ARCHITECTURE.md` §3.3).
 *
 * These are the Phase 0 engineering defaults. `PROJECT_STATUS.md` schedules the
 * tuning pass against measured behaviour for the networking phase.
 */

/** Fixed simulation rate, Hz. */
export const SIM_HZ = 60;

/** Fixed simulation timestep, seconds. Movement never integrates frame time. */
export const SIM_DT = 1 / SIM_HZ;

/**
 * Upper bound on catch-up steps in one frame. Without it, a long stall (tab in
 * the background, a breakpoint) produces a burst of steps that stalls again —
 * the "spiral of death".
 */
export const MAX_STEPS_PER_FRAME = 5;

/** Frame deltas above this are treated as a stall and clamped, seconds. */
export const MAX_FRAME_DELTA = 0.25;
