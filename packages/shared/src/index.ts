/**
 * Public surface of `@nullpoint/shared`.
 *
 * Imported by both the client and (from Phase 3) the server. Nothing here may
 * depend on Three.js, the DOM, or Node built-ins — see `ARCHITECTURE.md` §3.2.
 */

export * from "./math/index.ts";
export * from "./types/index.ts";
export * from "./constants/index.ts";
export * from "./sim/index.ts";
export * from "./util/logger.ts";
