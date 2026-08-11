import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUTTON_RESERVED_MASK,
  Button,
  ClientMessageType,
  EntityField,
  IMPLEMENTED_ENTITY_FIELDS,
  LIMITS,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  ReasonCode,
  SNAPSHOT_FLAG_FULL,
  SNAPSHOT_HZ,
  ServerMessageType,
  StateFlag,
  closeCodeFor,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  encodePitch,
  encodeYaw,
  decodePitch,
  decodeYaw,
  PITCH_QUANTISATION_ERROR,
  YAW_QUANTISATION_ERROR,
} from "../../packages/shared/src/protocol/index.ts";
import { SIM_HZ } from "../../packages/shared/src/constants/sim.ts";
import type {
  ClientMessage,
  ServerMessage,
} from "../../packages/shared/src/protocol/messages.ts";

/**
 * Protocol v1 conformance.
 *
 * Three kinds of test, and the third is the one that matters most:
 *
 * 1. **Round trip** — encode, decode, compare. Catches asymmetry.
 * 2. **Malformed input** — every documented rejection produces the documented
 *    reason code rather than plausible garbage.
 * 3. **Byte layout** — the exact bytes are compared against the table in
 *    `NETWORK_PROTOCOL.md`. A round trip only proves the encoder and decoder
 *    agree with *each other*; two matching mistakes pass it happily. Only a
 *    literal byte comparison proves either matches the document.
 */

function clientRoundTrip(message: ClientMessage): ClientMessage {
  const bytes = encodeClientMessage(message);
  const result = decodeClientMessage(bytes);
  assert.ok(result.ok, `decode failed: ${result.ok ? "" : result.detail}`);
  return result.message;
}

function serverRoundTrip(message: ServerMessage): ServerMessage {
  const bytes = encodeServerMessage(message);
  const result = decodeServerMessage(bytes);
  assert.ok(result.ok, `decode failed: ${result.ok ? "" : result.detail}`);
  return result.message;
}

/** Asserts a decode failed with a specific reason. */
function expectClientReject(bytes: Uint8Array, reason: ReasonCode, note: string): void {
  const result = decodeClientMessage(bytes);
  assert.equal(result.ok, false, `${note}: expected rejection, got a message`);
  if (!result.ok) assert.equal(result.reason, reason, `${note}: ${result.detail}`);
}

describe("protocol constants", () => {
  it("matches the documented version and rates", () => {
    assert.equal(PROTOCOL_VERSION, 1);
    assert.equal(SIM_HZ, 60);
    assert.equal(SNAPSHOT_HZ, 20);
    assert.equal(MAX_FRAME_BYTES, 8192);
  });

  it("maps reason codes onto the 4000-range close codes", () => {
    assert.equal(closeCodeFor(ReasonCode.Normal), 4000);
    assert.equal(closeCodeFor(ReasonCode.VersionMismatch), 4002);
    assert.equal(closeCodeFor(ReasonCode.InternalError), 4014);
  });
});

describe("angle quantisation", () => {
  it("round-trips yaw across a full turn within the documented error", () => {
    for (let degrees = -720; degrees <= 720; degrees += 7) {
      const yaw = (degrees * Math.PI) / 180;
      const decoded = decodeYaw(encodeYaw(yaw));
      // Compared as a wrapped difference: ±π are the same heading.
      const delta = Math.atan2(Math.sin(decoded - yaw), Math.cos(decoded - yaw));
      assert.ok(
        Math.abs(delta) <= YAW_QUANTISATION_ERROR + 1e-9,
        `yaw ${degrees}° error ${delta}`,
      );
    }
  });

  it("round-trips pitch within the documented error and clamps beyond ±π/2", () => {
    for (let degrees = -90; degrees <= 90; degrees += 3) {
      const pitch = (degrees * Math.PI) / 180;
      const decoded = decodePitch(encodePitch(pitch));
      assert.ok(
        Math.abs(decoded - pitch) <= PITCH_QUANTISATION_ERROR + 1e-9,
        `pitch ${degrees}° error ${decoded - pitch}`,
      );
    }
    // Out of range is clamped by the encoder, which is a value the *sender*
    // derives — not a client field the receiver has to reject.
    assert.equal(encodePitch(Math.PI), 32767);
    assert.equal(encodePitch(-Math.PI), -32767);
  });

  it("keeps yaw quantisation stable at the ±π seam", () => {
    for (const yaw of [Math.PI, -Math.PI, Math.PI - 1e-6, -Math.PI + 1e-6]) {
      const decoded = decodeYaw(encodeYaw(yaw));
      const delta = Math.atan2(Math.sin(decoded - yaw), Math.cos(decoded - yaw));
      assert.ok(Math.abs(delta) <= YAW_QUANTISATION_ERROR + 1e-9, `seam yaw ${yaw}`);
    }
  });
});

describe("C_HELLO", () => {
  it("round-trips", () => {
    const decoded = clientRoundTrip({
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      idToken: "dev-token-abc.123",
    });
    assert.deepEqual(decoded, {
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      idToken: "dev-token-abc.123",
    });
  });

  it("round-trips a maximum-length token", () => {
    const idToken = "x".repeat(LIMITS.idTokenMaxBytes);
    const decoded = clientRoundTrip({
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      idToken,
    });
    assert.equal(decoded.type, ClientMessageType.Hello);
    if (decoded.type === ClientMessageType.Hello) assert.equal(decoded.idToken.length, LIMITS.idTokenMaxBytes);
  });

  it("round-trips a multi-byte UTF-8 token", () => {
    const idToken = "tökén-日本語-🎯";
    const decoded = clientRoundTrip({
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      idToken,
    });
    if (decoded.type === ClientMessageType.Hello) assert.equal(decoded.idToken, idToken);
  });

  it("has the documented byte layout", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Hello,
      protocolVersion: 1,
      idToken: "ab",
    });
    // type=0x01 | version u16 LE = 01 00 | length u16 LE = 02 00 | "ab"
    assert.deepEqual([...bytes], [0x01, 0x01, 0x00, 0x02, 0x00, 0x61, 0x62]);
  });

  it("rejects a version mismatch", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION + 1,
      idToken: "t",
    });
    expectClientReject(bytes, ReasonCode.VersionMismatch, "wrong version");
  });

  it("rejects an empty token", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      idToken: "",
    });
    expectClientReject(bytes, ReasonCode.AuthFailed, "empty token");
  });

  it("rejects a frame shorter than the minimum", () => {
    expectClientReject(new Uint8Array([0x01, 0x01]), ReasonCode.BadLength, "short hello");
  });

  it("rejects a token length that overruns the frame", () => {
    // Claims 0xFFFF bytes of token but supplies none.
    const bytes = new Uint8Array([0x01, 0x01, 0x00, 0xff, 0xff]);
    expectClientReject(bytes, ReasonCode.BadLength, "lying length prefix");
  });

  it("rejects trailing bytes", () => {
    const valid = encodeClientMessage({
      type: ClientMessageType.Hello,
      protocolVersion: PROTOCOL_VERSION,
      idToken: "ab",
    });
    const padded = new Uint8Array(valid.length + 1);
    padded.set(valid);
    expectClientReject(padded, ReasonCode.BadLength, "trailing bytes");
  });
});

describe("C_INPUT", () => {
  const command = { sequence: 1, buttons: Button.Forward, yaw: 0.5, pitch: -0.25 };

  it("round-trips a single command", () => {
    const decoded = clientRoundTrip({
      type: ClientMessageType.Input,
      ackSnapshotTick: 42,
      commands: [command],
    });
    assert.equal(decoded.type, ClientMessageType.Input);
    if (decoded.type !== ClientMessageType.Input) return;
    assert.equal(decoded.ackSnapshotTick, 42);
    assert.equal(decoded.commands.length, 1);
    const first = decoded.commands[0];
    assert.ok(first !== undefined);
    assert.equal(first.sequence, 1);
    assert.equal(first.buttons, Button.Forward);
    assert.ok(Math.abs(first.yaw - 0.5) < YAW_QUANTISATION_ERROR + 1e-9);
    assert.ok(Math.abs(first.pitch - -0.25) < PITCH_QUANTISATION_ERROR + 1e-9);
  });

  it("round-trips the maximum eight commands with every movement button", () => {
    const buttons =
      Button.Forward | Button.Back | Button.Left | Button.Right | Button.Jump | Button.Crouch | Button.Sprint;
    const commands = Array.from({ length: LIMITS.commandCountMax }, (_, i) => ({
      sequence: 100 + i,
      buttons,
      yaw: (i / 8) * Math.PI,
      pitch: -Math.PI / 2 + (i / 8) * Math.PI,
    }));

    const decoded = clientRoundTrip({ type: ClientMessageType.Input, ackSnapshotTick: 0, commands });
    if (decoded.type !== ClientMessageType.Input) throw new Error("wrong type");
    assert.equal(decoded.commands.length, LIMITS.commandCountMax);
    for (let i = 0; i < commands.length; i++) {
      assert.equal(decoded.commands[i]?.sequence, 100 + i);
      assert.equal(decoded.commands[i]?.buttons, buttons);
    }
  });

  it("round-trips the Fire and Aim bits reserved for Phase 5", () => {
    const decoded = clientRoundTrip({
      type: ClientMessageType.Input,
      ackSnapshotTick: 1,
      commands: [{ sequence: 7, buttons: Button.Fire | Button.Aim, yaw: 0, pitch: 0 }],
    });
    if (decoded.type !== ClientMessageType.Input) throw new Error("wrong type");
    assert.equal(decoded.commands[0]?.buttons, Button.Fire | Button.Aim);
  });

  it("round-trips a maximum u32 sequence and ack tick", () => {
    const decoded = clientRoundTrip({
      type: ClientMessageType.Input,
      ackSnapshotTick: 0xffffffff,
      commands: [{ sequence: 0xffffffff, buttons: 0, yaw: 0, pitch: 0 }],
    });
    if (decoded.type !== ClientMessageType.Input) throw new Error("wrong type");
    assert.equal(decoded.ackSnapshotTick, 0xffffffff);
    assert.equal(decoded.commands[0]?.sequence, 0xffffffff);
  });

  it("has the documented byte layout", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Input,
      ackSnapshotTick: 1,
      commands: [{ sequence: 2, buttons: Button.Jump, yaw: 0, pitch: 0 }],
    });
    assert.equal(bytes.length, 6 + 10, "6-byte header plus one 10-byte command");
    assert.deepEqual(
      [...bytes],
      [
        0x02, // type
        0x01, 0x00, 0x00, 0x00, // ackSnapshotTick u32 LE = 1
        0x01, // commandCount
        0x02, 0x00, 0x00, 0x00, // sequence u32 LE = 2
        0x10, 0x00, // buttons u16 LE = Jump (bit 4)
        0x00, 0x00, // yaw u16 LE = 0
        0x00, 0x00, // pitch i16 LE = 0
      ],
    );
  });

  it("rejects a reserved button bit", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Input,
      ackSnapshotTick: 0,
      commands: [{ sequence: 1, buttons: BUTTON_RESERVED_MASK, yaw: 0, pitch: 0 }],
    });
    expectClientReject(bytes, ReasonCode.InvalidField, "reserved button bit");
  });

  it("rejects a command count of zero", () => {
    const bytes = new Uint8Array([0x02, 0, 0, 0, 0, 0x00]);
    expectClientReject(bytes, ReasonCode.InvalidField, "zero commands");
  });

  it("rejects a command count above eight", () => {
    const bytes = new Uint8Array(6 + 9 * 10);
    bytes[0] = 0x02;
    bytes[5] = 9;
    expectClientReject(bytes, ReasonCode.InvalidField, "nine commands");
  });

  it("rejects a length that disagrees with commandCount", () => {
    // Declares two commands but carries one.
    const bytes = new Uint8Array(6 + 10);
    bytes[0] = 0x02;
    bytes[5] = 2;
    expectClientReject(bytes, ReasonCode.BadLength, "count/length mismatch");
  });

  it("rejects sequences that are not strictly increasing", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Input,
      ackSnapshotTick: 0,
      commands: [
        { sequence: 5, buttons: 0, yaw: 0, pitch: 0 },
        { sequence: 5, buttons: 0, yaw: 0, pitch: 0 },
      ],
    });
    expectClientReject(bytes, ReasonCode.InvalidField, "duplicate sequence");
  });

  it("rejects a decreasing sequence", () => {
    const bytes = encodeClientMessage({
      type: ClientMessageType.Input,
      ackSnapshotTick: 0,
      commands: [
        { sequence: 9, buttons: 0, yaw: 0, pitch: 0 },
        { sequence: 4, buttons: 0, yaw: 0, pitch: 0 },
      ],
    });
    expectClientReject(bytes, ReasonCode.InvalidField, "out-of-order sequence");
  });
});

describe("C_PING and C_LEAVE", () => {
  it("round-trips a ping", () => {
    const decoded = clientRoundTrip({ type: ClientMessageType.Ping, clientTimeMs: 123456 });
    assert.deepEqual(decoded, { type: ClientMessageType.Ping, clientTimeMs: 123456 });
  });

  it("round-trips a maximum u32 client time", () => {
    const decoded = clientRoundTrip({ type: ClientMessageType.Ping, clientTimeMs: 0xffffffff });
    assert.deepEqual(decoded, { type: ClientMessageType.Ping, clientTimeMs: 0xffffffff });
  });

  it("has the documented ping byte layout", () => {
    const bytes = encodeClientMessage({ type: ClientMessageType.Ping, clientTimeMs: 1 });
    assert.deepEqual([...bytes], [0x03, 0x01, 0x00, 0x00, 0x00]);
  });

  it("round-trips a leave, which is one byte", () => {
    const bytes = encodeClientMessage({ type: ClientMessageType.Leave });
    assert.deepEqual([...bytes], [0x04]);
    assert.deepEqual(clientRoundTrip({ type: ClientMessageType.Leave }), { type: ClientMessageType.Leave });
  });

  it("rejects a ping of the wrong length", () => {
    expectClientReject(new Uint8Array([0x03, 0x01, 0x00]), ReasonCode.BadLength, "short ping");
    expectClientReject(new Uint8Array([0x03, 0, 0, 0, 0, 0]), ReasonCode.BadLength, "long ping");
  });

  it("rejects a leave with a payload", () => {
    expectClientReject(new Uint8Array([0x04, 0x00]), ReasonCode.BadLength, "leave with payload");
  });
});

describe("framing and unknown ids", () => {
  it("rejects an empty frame", () => {
    expectClientReject(new Uint8Array(0), ReasonCode.ProtocolError, "empty frame");
  });

  it("rejects a frame over MAX_FRAME_BYTES", () => {
    expectClientReject(new Uint8Array(MAX_FRAME_BYTES + 1), ReasonCode.MessageTooLarge, "oversized");
  });

  it("accepts a frame of exactly MAX_FRAME_BYTES as far as the size check", () => {
    const result = decodeClientMessage(new Uint8Array(MAX_FRAME_BYTES));
    // Byte 0 is 0x00, an unknown id — the point is that it got past the size gate.
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.UnknownMessage);
  });

  it("rejects an unknown message id", () => {
    expectClientReject(new Uint8Array([0x7f]), ReasonCode.UnknownMessage, "unknown id");
  });

  it("rejects a reserved-for-later id", () => {
    expectClientReject(new Uint8Array([0x05]), ReasonCode.UnknownMessage, "reserved id");
  });

  it("rejects a server id arriving on the client→server path", () => {
    expectClientReject(new Uint8Array([0x83]), ReasonCode.UnknownMessage, "wrong direction");
  });

  it("rejects a client id arriving on the server→client path", () => {
    const result = decodeServerMessage(new Uint8Array([0x02]));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.UnknownMessage);
  });
});

describe("S_WELCOME", () => {
  const welcome = {
    type: ServerMessageType.Welcome,
    protocolVersion: PROTOCOL_VERSION,
    playerId: 7,
    serverTimeMs: 1_000_000,
    currentTick: 60,
    simHz: SIM_HZ,
    snapshotHz: SNAPSHOT_HZ,
  } as const;

  it("round-trips", () => {
    assert.deepEqual(serverRoundTrip(welcome), welcome);
  });

  it("round-trips the extreme player ids", () => {
    for (const playerId of [LIMITS.playerIdMin, LIMITS.playerIdMax]) {
      const decoded = serverRoundTrip({ ...welcome, playerId });
      if (decoded.type === ServerMessageType.Welcome) assert.equal(decoded.playerId, playerId);
    }
  });

  it("is exactly 15 bytes with the documented layout", () => {
    const bytes = encodeServerMessage({ ...welcome, playerId: 1, serverTimeMs: 2, currentTick: 3 });
    assert.equal(bytes.length, 15);
    assert.deepEqual(
      [...bytes],
      [
        0x81, // type
        0x01, 0x00, // protocolVersion u16 LE
        0x01, 0x00, // playerId u16 LE
        0x02, 0x00, 0x00, 0x00, // serverTimeMs u32 LE
        0x03, 0x00, 0x00, 0x00, // currentTick u32 LE
        60, // simHz
        20, // snapshotHz
      ],
    );
  });

  it("rejects a welcome of the wrong length", () => {
    const result = decodeServerMessage(new Uint8Array(14).fill(0).map((_, i) => (i === 0 ? 0x81 : 0)));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.BadLength);
  });
});

describe("S_REJECT", () => {
  it("round-trips every reason code", () => {
    for (const reason of Object.values(ReasonCode)) {
      const decoded = serverRoundTrip({
        type: ServerMessageType.Reject,
        reasonCode: reason,
        detail: `reason ${reason}`,
      });
      if (decoded.type === ServerMessageType.Reject) assert.equal(decoded.reasonCode, reason);
    }
  });

  it("round-trips an empty detail", () => {
    const decoded = serverRoundTrip({
      type: ServerMessageType.Reject,
      reasonCode: ReasonCode.Normal,
      detail: "",
    });
    if (decoded.type === ServerMessageType.Reject) assert.equal(decoded.detail, "");
  });

  it("has the documented byte layout", () => {
    const bytes = encodeServerMessage({
      type: ServerMessageType.Reject,
      reasonCode: ReasonCode.VersionMismatch,
      detail: "no",
    });
    assert.deepEqual([...bytes], [0x82, 0x02, 0x00, 0x02, 0x00, 0x6e, 0x6f]);
  });
});

describe("S_SNAPSHOT", () => {
  const full = {
    type: ServerMessageType.Snapshot,
    tick: 1234,
    serverTimeMs: 20_567,
    ackInputSequence: 99,
    flags: SNAPSHOT_FLAG_FULL,
    baselineTick: 0,
    entities: [
      {
        playerId: 1,
        fieldMask: IMPLEMENTED_ENTITY_FIELDS,
        position: { x: 1.5, y: 0.25, z: -3.75 },
        velocity: { x: -2, y: 0, z: 4 },
        yaw: 1.25,
        pitch: -0.5,
        stateFlags: StateFlag.Grounded | StateFlag.Sprinting,
      },
    ],
  } as const;

  it("round-trips a full snapshot", () => {
    const decoded = serverRoundTrip(full);
    if (decoded.type !== ServerMessageType.Snapshot) throw new Error("wrong type");
    assert.equal(decoded.tick, 1234);
    assert.equal(decoded.ackInputSequence, 99);
    assert.equal(decoded.flags, SNAPSHOT_FLAG_FULL);
    assert.equal(decoded.baselineTick, 0);

    const entity = decoded.entities[0];
    assert.ok(entity !== undefined);
    // Position and velocity are f32 with no quantisation, so these are exact
    // for values representable in single precision.
    assert.deepEqual(entity.position, { x: 1.5, y: 0.25, z: -3.75 });
    assert.deepEqual(entity.velocity, { x: -2, y: 0, z: 4 });
    assert.equal(entity.stateFlags, StateFlag.Grounded | StateFlag.Sprinting);
    assert.ok(Math.abs((entity.yaw ?? 0) - 1.25) < YAW_QUANTISATION_ERROR + 1e-9);
    assert.ok(Math.abs((entity.pitch ?? 0) - -0.5) < PITCH_QUANTISATION_ERROR + 1e-9);
  });

  it("round-trips an empty snapshot", () => {
    const decoded = serverRoundTrip({ ...full, entities: [] });
    if (decoded.type === ServerMessageType.Snapshot) assert.equal(decoded.entities.length, 0);
  });

  it("round-trips a delta carrying only position", () => {
    const decoded = serverRoundTrip({
      ...full,
      flags: 0,
      baselineTick: 1200,
      entities: [{ playerId: 2, fieldMask: EntityField.Position, position: { x: 0, y: 0, z: 0 } }],
    });
    if (decoded.type !== ServerMessageType.Snapshot) throw new Error("wrong type");
    assert.equal(decoded.baselineTick, 1200);
    const entity = decoded.entities[0];
    assert.equal(entity?.fieldMask, EntityField.Position);
    assert.equal(entity?.velocity, undefined, "absent fields must stay absent");
    assert.equal(entity?.yaw, undefined);
  });

  it("round-trips many entities", () => {
    const entities = Array.from({ length: 16 }, (_, i) => ({
      playerId: i + 1,
      fieldMask: EntityField.Yaw,
      yaw: (i / 16) * Math.PI * 2,
    }));
    const decoded = serverRoundTrip({ ...full, entities });
    if (decoded.type !== ServerMessageType.Snapshot) throw new Error("wrong type");
    assert.equal(decoded.entities.length, 16);
    assert.equal(decoded.entities[15]?.playerId, 16);
  });

  it("has the documented header layout and field ordering", () => {
    const bytes = encodeServerMessage({
      type: ServerMessageType.Snapshot,
      tick: 1,
      serverTimeMs: 2,
      ackInputSequence: 3,
      flags: SNAPSHOT_FLAG_FULL,
      baselineTick: 0,
      entities: [{ playerId: 4, fieldMask: EntityField.StateFlags, stateFlags: StateFlag.Grounded }],
    });
    assert.deepEqual(
      [...bytes],
      [
        0x83, // type
        0x01, 0x00, 0x00, 0x00, // tick
        0x02, 0x00, 0x00, 0x00, // serverTimeMs
        0x03, 0x00, 0x00, 0x00, // ackInputSequence
        0x01, // flags = FULL
        0x00, 0x00, 0x00, 0x00, // baselineTick
        0x01, // entityCount
        0x04, 0x00, // playerId u16 LE
        0x10, 0x00, // fieldMask u16 LE = StateFlags (bit 4)
        0x01, // stateFlags = Grounded
      ],
    );
    // Header is 19 bytes before the first entity, per the offset table.
    assert.equal(bytes.length, 19 + 2 + 2 + 1);
  });

  it("rejects a reserved snapshot flag bit", () => {
    const bytes = encodeServerMessage({ ...full, flags: 0x02 });
    const result = decodeServerMessage(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.InvalidField);
  });

  it("rejects a reserved fieldMask bit", () => {
    const bytes = encodeServerMessage({
      ...full,
      entities: [{ playerId: 1, fieldMask: 1 << 6 }],
    });
    const result = decodeServerMessage(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.InvalidField);
  });

  it("rejects a reserved stateFlags bit", () => {
    const bytes = encodeServerMessage({
      ...full,
      entities: [{ playerId: 1, fieldMask: EntityField.StateFlags, stateFlags: 0x80 }],
    });
    const result = decodeServerMessage(bytes);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.InvalidField);
  });

  it("rejects a truncated entity list", () => {
    const bytes = encodeServerMessage(full);
    const result = decodeServerMessage(bytes.subarray(0, bytes.length - 4));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.BadLength);
  });

  it("rejects trailing bytes after the entity list", () => {
    const valid = encodeServerMessage(full);
    const padded = new Uint8Array(valid.length + 2);
    padded.set(valid);
    const result = decodeServerMessage(padded);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, ReasonCode.BadLength);
  });
});

describe("S_PONG, S_PLAYER_JOIN, S_PLAYER_LEAVE", () => {
  it("round-trips a pong", () => {
    const message = {
      type: ServerMessageType.Pong,
      clientTimeMs: 111,
      serverTimeMs: 222,
    } as const;
    assert.deepEqual(serverRoundTrip(message), message);
  });

  it("has the documented pong layout, 9 bytes", () => {
    const bytes = encodeServerMessage({
      type: ServerMessageType.Pong,
      clientTimeMs: 1,
      serverTimeMs: 2,
    });
    assert.equal(bytes.length, 9);
    assert.deepEqual([...bytes], [0x84, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
  });

  it("round-trips a join, including a maximum-length display name", () => {
    const displayName = "n".repeat(LIMITS.displayNameMaxBytes);
    const decoded = serverRoundTrip({
      type: ServerMessageType.PlayerJoin,
      playerId: 3,
      displayName,
    });
    if (decoded.type === ServerMessageType.PlayerJoin) {
      assert.equal(decoded.playerId, 3);
      assert.equal(decoded.displayName, displayName);
    }
  });

  it("has the documented join layout", () => {
    const bytes = encodeServerMessage({
      type: ServerMessageType.PlayerJoin,
      playerId: 1,
      displayName: "ab",
    });
    assert.deepEqual([...bytes], [0x85, 0x01, 0x00, 0x02, 0x00, 0x61, 0x62]);
  });

  it("round-trips a leave with a reason", () => {
    const message = {
      type: ServerMessageType.PlayerLeave,
      playerId: 5,
      reasonCode: ReasonCode.Timeout,
    } as const;
    assert.deepEqual(serverRoundTrip(message), message);
  });

  it("has the documented player-leave layout, 5 bytes", () => {
    const bytes = encodeServerMessage({
      type: ServerMessageType.PlayerLeave,
      playerId: 1,
      reasonCode: ReasonCode.Kicked,
    });
    assert.equal(bytes.length, 5);
    assert.deepEqual([...bytes], [0x86, 0x01, 0x00, 0x0d, 0x00]);
  });
});
