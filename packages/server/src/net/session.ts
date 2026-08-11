import {
  ClientMessageType,
  LIMITS,
  PROTOCOL_VERSION,
  ReasonCode,
  ServerMessageType,
  closeCodeFor,
  decodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "@nullpoint/shared";

import type { Room } from "../rooms/Room.ts";

/**
 * One client connection's protocol state.
 *
 * Everything a client sends passes through here and is treated as hostile until
 * proven otherwise (`ARCHITECTURE.md` §5.4). The order of checks is the order in
 * `NETWORK_PROTOCOL.md` §6, because which check fires first decides which reason
 * code the client is given.
 *
 * Transport-agnostic on purpose: it is handed bytes and returns frames to send,
 * so it can be driven by a real socket or directly by a test.
 */

/** Token bucket, §6.1. */
class RateLimit {
  private tokens: number;
  private lastRefillMs: number;
  private readonly sustainedPerSecond: number;
  private readonly burst: number;

  constructor(sustainedPerSecond: number, burst: number, nowMs: number) {
    this.sustainedPerSecond = sustainedPerSecond;
    this.burst = burst;
    this.tokens = burst;
    this.lastRefillMs = nowMs;
  }

  take(nowMs: number): boolean {
    const elapsed = Math.max(0, nowMs - this.lastRefillMs) / 1000;
    this.lastRefillMs = nowMs;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.sustainedPerSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface SessionAction {
  /** Frames to send, in order. */
  readonly send: readonly Uint8Array[];
  /** Close the connection after sending, with this code. */
  readonly close?: { readonly code: number; readonly reason: ReasonCode };
}

const NOTHING: SessionAction = { send: [] };

export interface SessionHooks {
  /** Called once the handshake succeeds. Returns the assigned player id. */
  onHandshake(displayName: string): number;
  onLeave(reason: ReasonCode): void;
}

export class Session {
  /** Assigned on a successful handshake; `0` means "not yet identified". */
  private playerId = 0;
  private handshakeComplete = false;
  private rejectedInputs = 0;

  private readonly limits: {
    hello: RateLimit;
    input: RateLimit;
    ping: RateLimit;
    leave: RateLimit;
  };

  private readonly room: Room;
  private readonly hooks: SessionHooks;
  private readonly devAuth: boolean;

  constructor(room: Room, hooks: SessionHooks, devAuth: boolean, nowMs: number) {
    this.room = room;
    this.hooks = hooks;
    this.devAuth = devAuth;
    this.limits = {
      hello: new RateLimit(1, 1, nowMs),
      input: new RateLimit(90, 120, nowMs),
      ping: new RateLimit(4, 8, nowMs),
      leave: new RateLimit(1, 1, nowMs),
    };
  }

  get id(): number {
    return this.playerId;
  }

  get identified(): boolean {
    return this.handshakeComplete;
  }

  get rejectedInputCount(): number {
    return this.rejectedInputs;
  }

  /** Handles one binary frame. Never throws. */
  handleFrame(bytes: Uint8Array, nowMs: number, serverTimeMs: number): SessionAction {
    const decoded = decodeClientMessage(bytes);
    if (!decoded.ok) {
      if (decoded.reason === ReasonCode.InvalidField || decoded.reason === ReasonCode.BadLength) {
        this.rejectedInputs += 1;
      }
      return this.reject(decoded.reason, decoded.detail);
    }

    const message = decoded.message;

    // §6 step 5: nothing but a handshake is accepted before one has completed.
    if (!this.handshakeComplete && message.type !== ClientMessageType.Hello) {
      return this.reject(ReasonCode.ProtocolError, "message before handshake");
    }
    if (this.handshakeComplete && message.type === ClientMessageType.Hello) {
      return this.reject(ReasonCode.ProtocolError, "second handshake");
    }

    if (!this.allow(message, nowMs)) {
      return this.reject(ReasonCode.RateLimited, `rate limit for type 0x${message.type.toString(16)}`);
    }

    switch (message.type) {
      case ClientMessageType.Hello:
        return this.handleHello(message.idToken, serverTimeMs);

      case ClientMessageType.Input: {
        // A client may not acknowledge a tick the server has not reached.
        if (message.ackSnapshotTick > this.room.tick) {
          this.rejectedInputs += 1;
          return this.reject(ReasonCode.InvalidField, "ackSnapshotTick is in the future");
        }
        this.room.enqueueInput(this.playerId, message.commands);
        return NOTHING;
      }

      case ClientMessageType.Ping:
        return {
          send: [
            encodeServerMessage({
              type: ServerMessageType.Pong,
              clientTimeMs: message.clientTimeMs,
              serverTimeMs,
            }),
          ],
        };

      case ClientMessageType.Leave:
        this.hooks.onLeave(ReasonCode.Normal);
        return { send: [], close: { code: closeCodeFor(ReasonCode.Normal), reason: ReasonCode.Normal } };
    }
  }

  private allow(message: ClientMessage, nowMs: number): boolean {
    switch (message.type) {
      case ClientMessageType.Hello:
        return this.limits.hello.take(nowMs);
      case ClientMessageType.Input:
        return this.limits.input.take(nowMs);
      case ClientMessageType.Ping:
        return this.limits.ping.take(nowMs);
      case ClientMessageType.Leave:
        return this.limits.leave.take(nowMs);
    }
  }

  /**
   * Completes the handshake.
   *
   * **Development auth only.** `NETWORK_PROTOCOL.md` §4.1 puts Firebase Admin
   * verification in Phase 7; until then the server accepts a local development
   * token and assigns a throwaway identity. The wire format is identical in both
   * modes — only the check differs — and this path is gated behind a flag that
   * a production start refuses.
   */
  private handleHello(idToken: string, serverTimeMs: number): SessionAction {
    if (!this.devAuth) {
      return this.reject(ReasonCode.AuthFailed, "token verification is not available until Phase 7");
    }
    if (idToken.length === 0 || idToken.length > LIMITS.idTokenMaxBytes) {
      return this.reject(ReasonCode.AuthFailed, "malformed development token");
    }

    // Throwaway identity. A real display name comes from a verified token.
    const displayName = `dev-${idToken.slice(0, 8)}`;
    this.playerId = this.hooks.onHandshake(displayName);
    this.handshakeComplete = true;

    return {
      send: [
        encodeServerMessage({
          type: ServerMessageType.Welcome,
          protocolVersion: PROTOCOL_VERSION,
          playerId: this.playerId,
          serverTimeMs,
          currentTick: this.room.tick,
          simHz: 60,
          snapshotHz: 20,
        }),
      ],
    };
  }

  /** Sends `S_REJECT` where the connection is still usable, then closes. */
  private reject(reason: ReasonCode, detail: string): SessionAction {
    const frames: Uint8Array[] = [];
    try {
      frames.push(
        encodeServerMessage({ type: ServerMessageType.Reject, reasonCode: reason, detail: detail.slice(0, 200) }),
      );
    } catch {
      // Encoding a rejection must never itself break the close path.
    }
    this.hooks.onLeave(reason);
    return { send: frames, close: { code: closeCodeFor(reason), reason } };
  }

  /** Frame for an arbitrary server message. */
  static frame(message: ServerMessage): Uint8Array {
    return encodeServerMessage(message);
  }
}
