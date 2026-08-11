import {
  BUTTON_RESERVED_MASK,
  ClientMessageType,
  ENTITY_FIELD_RESERVED_MASK,
  EntityField,
  FIXED_SIZES,
  HELLO_MIN_BYTES,
  INPUT_COMMAND_BYTES,
  INPUT_HEADER_BYTES,
  LIMITS,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  RESERVED_CLIENT_IDS,
  RESERVED_SERVER_IDS,
  ReasonCode,
  SNAPSHOT_FLAG_RESERVED_MASK,
  STATE_FLAG_RESERVED_MASK,
  ServerMessageType,
} from "./constants.ts";
import { ByteReader, ByteWriter, ReadOverrunError } from "./cursor.ts";
import { decodeFailure, decodeSuccess, type ClientMessage, type DecodeResult, type EntityState, type ServerMessage } from "./messages.ts";
import { decodePitch, decodeYaw, encodePitch, encodeYaw } from "./quantise.ts";

/**
 * Protocol v1 encode/decode.
 *
 * Decoding **never throws**. §6 requires a clean close with a reason code for
 * every malformed frame and forbids throwing out of the read path, so every
 * failure comes back as a `DecodeFailure` the caller is forced to handle.
 *
 * Validation runs in the documented order — framing, size, id, length, then
 * fields — because the reason code a client receives depends on which check
 * fires first, and reordering them silently changes the protocol's behaviour.
 *
 * Out-of-domain values are **rejected, not clamped** (§6.2). Clamping is for
 * values the server derives itself; a client sending one is a violation.
 */

// ---------------------------------------------------------------- encoding --

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  const writer = new ByteWriter();
  switch (message.type) {
    case ClientMessageType.Hello:
      writer.u8(ClientMessageType.Hello);
      writer.u16(message.protocolVersion);
      writer.str(message.idToken);
      break;

    case ClientMessageType.Input:
      writer.u8(ClientMessageType.Input);
      writer.u32(message.ackSnapshotTick);
      writer.u8(message.commands.length);
      for (const command of message.commands) {
        writer.u32(command.sequence);
        writer.u16(command.buttons);
        writer.u16(encodeYaw(command.yaw));
        writer.i16(encodePitch(command.pitch));
      }
      break;

    case ClientMessageType.Ping:
      writer.u8(ClientMessageType.Ping);
      writer.u32(message.clientTimeMs);
      break;

    case ClientMessageType.Leave:
      writer.u8(ClientMessageType.Leave);
      break;
  }
  return writer.finish();
}

export function encodeServerMessage(message: ServerMessage): Uint8Array {
  const writer = new ByteWriter();
  switch (message.type) {
    case ServerMessageType.Welcome:
      writer.u8(ServerMessageType.Welcome);
      writer.u16(message.protocolVersion);
      writer.u16(message.playerId);
      writer.u32(message.serverTimeMs);
      writer.u32(message.currentTick);
      writer.u8(message.simHz);
      writer.u8(message.snapshotHz);
      break;

    case ServerMessageType.Reject:
      writer.u8(ServerMessageType.Reject);
      writer.u16(message.reasonCode);
      writer.str(message.detail);
      break;

    case ServerMessageType.Snapshot:
      writer.u8(ServerMessageType.Snapshot);
      writer.u32(message.tick);
      writer.u32(message.serverTimeMs);
      writer.u32(message.ackInputSequence);
      writer.u8(message.flags);
      writer.u32(message.baselineTick);
      writer.u8(message.entities.length);
      for (const entity of message.entities) {
        writer.u16(entity.playerId);
        writer.u16(entity.fieldMask);
        // Ascending bit order, and only the fields the mask claims.
        if ((entity.fieldMask & EntityField.Position) !== 0 && entity.position !== undefined) {
          writer.f32(entity.position.x);
          writer.f32(entity.position.y);
          writer.f32(entity.position.z);
        }
        if ((entity.fieldMask & EntityField.Velocity) !== 0 && entity.velocity !== undefined) {
          writer.f32(entity.velocity.x);
          writer.f32(entity.velocity.y);
          writer.f32(entity.velocity.z);
        }
        if ((entity.fieldMask & EntityField.Yaw) !== 0 && entity.yaw !== undefined) {
          writer.u16(encodeYaw(entity.yaw));
        }
        if ((entity.fieldMask & EntityField.Pitch) !== 0 && entity.pitch !== undefined) {
          writer.i16(encodePitch(entity.pitch));
        }
        if ((entity.fieldMask & EntityField.StateFlags) !== 0 && entity.stateFlags !== undefined) {
          writer.u8(entity.stateFlags);
        }
      }
      break;

    case ServerMessageType.Pong:
      writer.u8(ServerMessageType.Pong);
      writer.u32(message.clientTimeMs);
      writer.u32(message.serverTimeMs);
      break;

    case ServerMessageType.PlayerJoin:
      writer.u8(ServerMessageType.PlayerJoin);
      writer.u16(message.playerId);
      writer.str(message.displayName);
      break;

    case ServerMessageType.PlayerLeave:
      writer.u8(ServerMessageType.PlayerLeave);
      writer.u16(message.playerId);
      writer.u16(message.reasonCode);
      break;
  }
  return writer.finish();
}

// ---------------------------------------------------------------- decoding --

/** Framing checks common to both directions: §6 steps 2 and 3. */
function checkFrame(bytes: Uint8Array): DecodeResult<true> {
  if (bytes.byteLength > MAX_FRAME_BYTES) {
    return decodeFailure(ReasonCode.MessageTooLarge, `frame ${bytes.byteLength} > ${MAX_FRAME_BYTES}`);
  }
  if (bytes.byteLength < 1) {
    return decodeFailure(ReasonCode.ProtocolError, "empty frame");
  }
  return decodeSuccess(true);
}

export function decodeClientMessage(bytes: Uint8Array): DecodeResult<ClientMessage> {
  const framing = checkFrame(bytes);
  if (!framing.ok) return framing;

  const type = bytes[0] ?? 0;
  try {
    switch (type) {
      case ClientMessageType.Hello:
        return decodeHello(bytes);
      case ClientMessageType.Input:
        return decodeInput(bytes);
      case ClientMessageType.Ping:
        return decodeFixed(bytes, FIXED_SIZES.ping, (reader) => {
          reader.u8();
          return { type: ClientMessageType.Ping, clientTimeMs: reader.u32() } as const;
        });
      case ClientMessageType.Leave:
        return decodeFixed(bytes, FIXED_SIZES.leave, () => ({ type: ClientMessageType.Leave }) as const);
      default:
        return unknownType(type, RESERVED_CLIENT_IDS);
    }
  } catch (error) {
    return failFromThrow(error);
  }
}

export function decodeServerMessage(bytes: Uint8Array): DecodeResult<ServerMessage> {
  const framing = checkFrame(bytes);
  if (!framing.ok) return framing;

  const type = bytes[0] ?? 0;
  try {
    switch (type) {
      case ServerMessageType.Welcome:
        return decodeFixed(bytes, FIXED_SIZES.welcome, (reader) => {
          reader.u8();
          return {
            type: ServerMessageType.Welcome,
            protocolVersion: reader.u16(),
            playerId: reader.u16(),
            serverTimeMs: reader.u32(),
            currentTick: reader.u32(),
            simHz: reader.u8(),
            snapshotHz: reader.u8(),
          } as const;
        });
      case ServerMessageType.Reject:
        return decodeReject(bytes);
      case ServerMessageType.Snapshot:
        return decodeSnapshot(bytes);
      case ServerMessageType.Pong:
        return decodeFixed(bytes, FIXED_SIZES.pong, (reader) => {
          reader.u8();
          return {
            type: ServerMessageType.Pong,
            clientTimeMs: reader.u32(),
            serverTimeMs: reader.u32(),
          } as const;
        });
      case ServerMessageType.PlayerJoin:
        return decodePlayerJoin(bytes);
      case ServerMessageType.PlayerLeave:
        return decodeFixed(bytes, FIXED_SIZES.playerLeave, (reader) => {
          reader.u8();
          return {
            type: ServerMessageType.PlayerLeave,
            playerId: reader.u16(),
            reasonCode: reader.u16() as ReasonCode,
          } as const;
        });
      default:
        return unknownType(type, RESERVED_SERVER_IDS);
    }
  } catch (error) {
    return failFromThrow(error);
  }
}

function unknownType(type: number, reserved: readonly number[]): DecodeResult<never> {
  const note = reserved.includes(type) ? " (reserved for a later phase)" : "";
  return decodeFailure(ReasonCode.UnknownMessage, `unknown type 0x${type.toString(16)}${note}`);
}

/** A read overrun is a truncated frame; anything else is a genuine fault. */
function failFromThrow(error: unknown): DecodeResult<never> {
  if (error instanceof ReadOverrunError) {
    return decodeFailure(ReasonCode.BadLength, `truncated frame: ${error.message}`);
  }
  if (error instanceof TypeError) {
    // `TextDecoder` with `fatal: true` throws this on invalid UTF-8.
    return decodeFailure(ReasonCode.InvalidField, "invalid UTF-8 in a string field");
  }
  return decodeFailure(ReasonCode.InternalError, error instanceof Error ? error.message : "decode failed");
}

function decodeFixed<T>(
  bytes: Uint8Array,
  size: number,
  read: (reader: ByteReader) => T,
): DecodeResult<T> {
  if (bytes.byteLength !== size) {
    return decodeFailure(ReasonCode.BadLength, `expected ${size} bytes, got ${bytes.byteLength}`);
  }
  return decodeSuccess(read(new ByteReader(bytes)));
}

function decodeHello(bytes: Uint8Array): DecodeResult<ClientMessage> {
  if (bytes.byteLength < HELLO_MIN_BYTES) {
    return decodeFailure(ReasonCode.BadLength, `C_HELLO needs ${HELLO_MIN_BYTES}+ bytes`);
  }
  const reader = new ByteReader(bytes);
  reader.u8();
  const protocolVersion = reader.u16();
  const idToken = reader.str(LIMITS.idTokenMaxBytes);

  if (reader.remaining !== 0) {
    return decodeFailure(ReasonCode.BadLength, `${reader.remaining} trailing bytes after C_HELLO`);
  }
  // Version is checked before the token: a client on the wrong version has no
  // business being told anything about its credentials.
  if (protocolVersion !== PROTOCOL_VERSION) {
    return decodeFailure(
      ReasonCode.VersionMismatch,
      `protocol ${protocolVersion}, server speaks ${PROTOCOL_VERSION}`,
    );
  }
  if (idToken.length < LIMITS.idTokenMinBytes) {
    return decodeFailure(ReasonCode.AuthFailed, "empty idToken");
  }
  return decodeSuccess({ type: ClientMessageType.Hello, protocolVersion, idToken });
}

function decodeInput(bytes: Uint8Array): DecodeResult<ClientMessage> {
  if (bytes.byteLength < INPUT_HEADER_BYTES) {
    return decodeFailure(ReasonCode.BadLength, "C_INPUT header truncated");
  }
  const reader = new ByteReader(bytes);
  reader.u8();
  const ackSnapshotTick = reader.u32();
  const commandCount = reader.u8();

  if (commandCount < LIMITS.commandCountMin || commandCount > LIMITS.commandCountMax) {
    return decodeFailure(ReasonCode.InvalidField, `commandCount ${commandCount} outside 1–8`);
  }
  const expected = INPUT_HEADER_BYTES + commandCount * INPUT_COMMAND_BYTES;
  if (bytes.byteLength !== expected) {
    return decodeFailure(
      ReasonCode.BadLength,
      `C_INPUT declares ${commandCount} commands (${expected} bytes), frame is ${bytes.byteLength}`,
    );
  }

  const commands = [];
  let previousSequence = -1;
  for (let i = 0; i < commandCount; i++) {
    const sequence = reader.u32();
    const buttons = reader.u16();
    const yawRaw = reader.u16();
    const pitchRaw = reader.i16();

    if ((buttons & BUTTON_RESERVED_MASK) !== 0) {
      return decodeFailure(ReasonCode.InvalidField, `buttons 0x${buttons.toString(16)} sets a reserved bit`);
    }
    // Strictly increasing *within* the message; the connection-level ordering
    // check belongs to the session, which is the only thing that knows what it
    // last applied.
    if (sequence <= previousSequence) {
      return decodeFailure(ReasonCode.InvalidField, `sequence ${sequence} not increasing`);
    }
    previousSequence = sequence;

    commands.push({ sequence, buttons, yaw: decodeYaw(yawRaw), pitch: decodePitch(pitchRaw) });
  }

  return decodeSuccess({ type: ClientMessageType.Input, ackSnapshotTick, commands });
}

function decodeReject(bytes: Uint8Array): DecodeResult<ServerMessage> {
  const reader = new ByteReader(bytes);
  reader.u8();
  const reasonCode = reader.u16() as ReasonCode;
  const detail = reader.str(LIMITS.detailMaxBytes);
  if (reader.remaining !== 0) {
    return decodeFailure(ReasonCode.BadLength, `${reader.remaining} trailing bytes after S_REJECT`);
  }
  return decodeSuccess({ type: ServerMessageType.Reject, reasonCode, detail });
}

function decodePlayerJoin(bytes: Uint8Array): DecodeResult<ServerMessage> {
  const reader = new ByteReader(bytes);
  reader.u8();
  const playerId = reader.u16();
  const displayName = reader.str(LIMITS.displayNameMaxBytes);
  if (reader.remaining !== 0) {
    return decodeFailure(ReasonCode.BadLength, `${reader.remaining} trailing bytes after S_PLAYER_JOIN`);
  }
  return decodeSuccess({ type: ServerMessageType.PlayerJoin, playerId, displayName });
}

function decodeSnapshot(bytes: Uint8Array): DecodeResult<ServerMessage> {
  const reader = new ByteReader(bytes);
  reader.u8();
  const tick = reader.u32();
  const serverTimeMs = reader.u32();
  const ackInputSequence = reader.u32();
  const flags = reader.u8();
  const baselineTick = reader.u32();
  const entityCount = reader.u8();

  if ((flags & SNAPSHOT_FLAG_RESERVED_MASK) !== 0) {
    return decodeFailure(ReasonCode.InvalidField, `snapshot flags 0x${flags.toString(16)} sets a reserved bit`);
  }

  const entities: EntityState[] = [];
  for (let i = 0; i < entityCount; i++) {
    const playerId = reader.u16();
    const fieldMask = reader.u16();

    if ((fieldMask & ENTITY_FIELD_RESERVED_MASK) !== 0) {
      return decodeFailure(ReasonCode.InvalidField, `fieldMask 0x${fieldMask.toString(16)} sets a reserved bit`);
    }

    const entity: {
      playerId: number;
      fieldMask: number;
      position?: { x: number; y: number; z: number };
      velocity?: { x: number; y: number; z: number };
      yaw?: number;
      pitch?: number;
      stateFlags?: number;
    } = { playerId, fieldMask };

    if ((fieldMask & EntityField.Position) !== 0) {
      entity.position = { x: reader.f32(), y: reader.f32(), z: reader.f32() };
    }
    if ((fieldMask & EntityField.Velocity) !== 0) {
      entity.velocity = { x: reader.f32(), y: reader.f32(), z: reader.f32() };
    }
    if ((fieldMask & EntityField.Yaw) !== 0) entity.yaw = decodeYaw(reader.u16());
    if ((fieldMask & EntityField.Pitch) !== 0) entity.pitch = decodePitch(reader.i16());
    if ((fieldMask & EntityField.StateFlags) !== 0) {
      const stateFlags = reader.u8();
      if ((stateFlags & STATE_FLAG_RESERVED_MASK) !== 0) {
        return decodeFailure(
          ReasonCode.InvalidField,
          `stateFlags 0x${stateFlags.toString(16)} sets a reserved bit`,
        );
      }
      entity.stateFlags = stateFlags;
    }

    entities.push(entity);
  }

  if (reader.remaining !== 0) {
    return decodeFailure(ReasonCode.BadLength, `${reader.remaining} trailing bytes after S_SNAPSHOT`);
  }

  return decodeSuccess({
    type: ServerMessageType.Snapshot,
    tick,
    serverTimeMs,
    ackInputSequence,
    flags,
    baselineTick,
    entities,
  });
}
