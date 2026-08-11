/**
 * Wire constants for protocol v1.
 *
 * Every value here is transcribed from `NETWORK_PROTOCOL.md`, which is the
 * source of truth. If the two disagree the document wins and this file is wrong.
 */

/** Bumped for **any** change to a payload layout, field width or id. */
export const PROTOCOL_VERSION = 1;

/**
 * Snapshot broadcast rate, Hz.
 *
 * `SIM_HZ` deliberately is **not** redeclared here — it already exists in
 * `constants/sim.ts` and the simulation and the wire format must never be able
 * to disagree about the tick rate.
 */
export const SNAPSHOT_HZ = 20;
/** Client input send rate, Hz. */
export const INPUT_HZ = 60;

/** Frames larger than this are refused before anything is parsed. */
export const MAX_FRAME_BYTES = 8192;

/** Client → server message ids. */
export const ClientMessageType = {
  Hello: 0x01,
  Input: 0x02,
  Ping: 0x03,
  Leave: 0x04,
} as const;
export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Server → client message ids. */
export const ServerMessageType = {
  Welcome: 0x81,
  Reject: 0x82,
  Snapshot: 0x83,
  Pong: 0x84,
  PlayerJoin: 0x85,
  PlayerLeave: 0x86,
} as const;
export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/**
 * Ids allocated but not implemented in v1.
 *
 * Listed so that "reserved" and "unknown" stay distinguishable in the code: both
 * disconnect, but only one of them is a client bug rather than a future feature.
 */
export const RESERVED_CLIENT_IDS: readonly number[] = [0x05];
export const RESERVED_SERVER_IDS: readonly number[] = [0x87, 0x88];

export const ReasonCode = {
  Normal: 0,
  ProtocolError: 1,
  VersionMismatch: 2,
  UnknownMessage: 3,
  BadLength: 4,
  InvalidField: 5,
  MessageTooLarge: 6,
  RateLimited: 7,
  AuthFailed: 8,
  HandshakeTimeout: 9,
  Timeout: 10,
  RoomFull: 11,
  ServerShutdown: 12,
  Kicked: 13,
  InternalError: 14,
} as const;
export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode];

/** WebSocket close code for a reason, inside the 4000–4999 application range. */
export function closeCodeFor(reason: ReasonCode): number {
  return 4000 + reason;
}

/** `InputCommand.buttons` bitfield. */
export const Button = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Sprint: 1 << 6,
  /** Reserved until Phase 5 — carried on the wire, not yet acted on. */
  Fire: 1 << 7,
  /** Reserved until Phase 5. */
  Aim: 1 << 8,
} as const;
export type Button = (typeof Button)[keyof typeof Button];

/** Bits 9–15 must be zero; anything set there is a protocol violation. */
export const BUTTON_RESERVED_MASK = 0xfe00;

/** `EntityState.fieldMask` bits, serialised in ascending bit order. */
export const EntityField = {
  Position: 1 << 0,
  Velocity: 1 << 1,
  Yaw: 1 << 2,
  Pitch: 1 << 3,
  StateFlags: 1 << 4,
  /** Reserved in v1 — allocated, never written. */
  Health: 1 << 5,
} as const;
export type EntityField = (typeof EntityField)[keyof typeof EntityField];

/** Fields v1 actually implements. A `FULL` snapshot sets exactly these. */
export const IMPLEMENTED_ENTITY_FIELDS =
  EntityField.Position | EntityField.Velocity | EntityField.Yaw | EntityField.Pitch | EntityField.StateFlags;

/** Bits 6–15 of `fieldMask` must be zero. Bit 5 is reserved in v1. */
export const ENTITY_FIELD_RESERVED_MASK = 0xffc0;

/** `EntityState.stateFlags` bits. */
export const StateFlag = {
  Grounded: 1 << 0,
  Crouched: 1 << 1,
  Sprinting: 1 << 2,
} as const;
export type StateFlag = (typeof StateFlag)[keyof typeof StateFlag];

/** Bits 3–7 of `stateFlags` must be zero. */
export const STATE_FLAG_RESERVED_MASK = 0xf8;

/** `S_SNAPSHOT.flags` bit 0: this snapshot is a baseline, not a delta. */
export const SNAPSHOT_FLAG_FULL = 1 << 0;
export const SNAPSHOT_FLAG_RESERVED_MASK = 0xfe;

/** Field domains from §6.2. */
export const LIMITS = {
  idTokenMinBytes: 1,
  idTokenMaxBytes: 4096,
  detailMaxBytes: 256,
  displayNameMaxBytes: 32,
  commandCountMin: 1,
  commandCountMax: 8,
  /** `0` is "none"/"world", `65535` is "invalid". */
  playerIdMin: 1,
  playerIdMax: 65534,
} as const;

/** Fixed message sizes, bytes. Used by the length check in §6 step 6. */
export const FIXED_SIZES = {
  ping: 5,
  leave: 1,
  welcome: 15,
  pong: 9,
  playerLeave: 5,
} as const;

/** `C_INPUT` is `6 + commandCount * 10`. */
export const INPUT_HEADER_BYTES = 6;
export const INPUT_COMMAND_BYTES = 10;
/** `C_HELLO` is `3 + 2 + tokenBytes`; nothing shorter than this can be valid. */
export const HELLO_MIN_BYTES = 5;
