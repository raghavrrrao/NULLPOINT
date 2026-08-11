import type { Vec3 } from "../math/index.ts";

import type { ClientMessageType, ReasonCode, ServerMessageType } from "./constants.ts";

/**
 * Decoded protocol messages, as plain data.
 *
 * Deliberately free of Three.js, Rapier, WebSocket and DOM types: the protocol
 * layer is shared by a browser and a Node process and must mean the same thing
 * in both. Angles here are **radians** and positions **metres** — the quantised
 * wire forms exist only inside the codec.
 */

export interface HelloMessage {
  readonly type: typeof ClientMessageType.Hello;
  readonly protocolVersion: number;
  /** Firebase ID token. Verified from Phase 7; a dev token until then. */
  readonly idToken: string;
}

export interface InputCommand {
  /** Strictly increasing per connection. */
  readonly sequence: number;
  /** Bitfield, see `Button`. */
  readonly buttons: number;
  /** Radians. Quantised to `u16` on the wire. */
  readonly yaw: number;
  /** Radians, clamped to ±π/2. Quantised to `i16` on the wire. */
  readonly pitch: number;
}

export interface InputMessage {
  readonly type: typeof ClientMessageType.Input;
  /** Newest snapshot tick received; `0` = none. */
  readonly ackSnapshotTick: number;
  /** 1–8 commands, oldest → newest, strictly increasing sequences. */
  readonly commands: readonly InputCommand[];
}

export interface PingMessage {
  readonly type: typeof ClientMessageType.Ping;
  /** Client monotonic ms, truncated to 32 bits. Echoed, never trusted. */
  readonly clientTimeMs: number;
}

export interface LeaveMessage {
  readonly type: typeof ClientMessageType.Leave;
}

export type ClientMessage = HelloMessage | InputMessage | PingMessage | LeaveMessage;

export interface WelcomeMessage {
  readonly type: typeof ServerMessageType.Welcome;
  readonly protocolVersion: number;
  /** Server-assigned authoritative identity, 1–65534. */
  readonly playerId: number;
  readonly serverTimeMs: number;
  readonly currentTick: number;
  readonly simHz: number;
  readonly snapshotHz: number;
}

export interface RejectMessage {
  readonly type: typeof ServerMessageType.Reject;
  readonly reasonCode: ReasonCode;
  /** Diagnostics only. The client keys behaviour off `reasonCode`. */
  readonly detail: string;
}

export interface EntityState {
  readonly playerId: number;
  /** Which fields are present, see `EntityField`. */
  readonly fieldMask: number;
  readonly position?: Vec3;
  readonly velocity?: Vec3;
  /** Radians. */
  readonly yaw?: number;
  /** Radians. */
  readonly pitch?: number;
  /** Bitfield, see `StateFlag`. */
  readonly stateFlags?: number;
}

export interface SnapshotMessage {
  readonly type: typeof ServerMessageType.Snapshot;
  readonly tick: number;
  readonly serverTimeMs: number;
  /** Last `InputCommand.sequence` applied for this client. Drives reconciliation. */
  readonly ackInputSequence: number;
  /** bit0 = FULL. */
  readonly flags: number;
  /** Tick this delta is against; `0` when FULL. */
  readonly baselineTick: number;
  readonly entities: readonly EntityState[];
}

export interface PongMessage {
  readonly type: typeof ServerMessageType.Pong;
  readonly clientTimeMs: number;
  readonly serverTimeMs: number;
}

export interface PlayerJoinMessage {
  readonly type: typeof ServerMessageType.PlayerJoin;
  readonly playerId: number;
  /** From the verified token, never client-supplied. */
  readonly displayName: string;
}

export interface PlayerLeaveMessage {
  readonly type: typeof ServerMessageType.PlayerLeave;
  readonly playerId: number;
  readonly reasonCode: ReasonCode;
}

export type ServerMessage =
  | WelcomeMessage
  | RejectMessage
  | SnapshotMessage
  | PongMessage
  | PlayerJoinMessage
  | PlayerLeaveMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;

/**
 * Why a frame was refused.
 *
 * Decoding returns this rather than throwing: §6 requires a clean close on every
 * malformed frame and forbids throwing out of the read path, so the failure has
 * to be an ordinary value the caller must look at.
 */
export interface DecodeFailure {
  readonly ok: false;
  readonly reason: ReasonCode;
  /** Developer-facing description. Never sent to a client verbatim. */
  readonly detail: string;
}

export interface DecodeSuccess<T> {
  readonly ok: true;
  readonly message: T;
}

export type DecodeResult<T> = DecodeSuccess<T> | DecodeFailure;

export function decodeFailure(reason: ReasonCode, detail: string): DecodeFailure {
  return { ok: false, reason, detail };
}

export function decodeSuccess<T>(message: T): DecodeSuccess<T> {
  return { ok: true, message };
}
