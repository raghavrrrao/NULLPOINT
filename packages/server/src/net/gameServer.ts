import { WebSocketServer, type WebSocket } from "ws";

import {
  ReasonCode,
  SIM_HZ,
  ServerMessageType,
  closeCodeFor,
  createLogger,
} from "@nullpoint/shared";

import { Room, type RoomDiagnostics } from "../rooms/Room.ts";
import { Session } from "./session.ts";
import type { ServerWorld } from "../sim/world.ts";

const log = createLogger("net");

const SIM_DT_MS = 1000 / SIM_HZ;
/** Longest catch-up a single wake-up may perform, ms. */
const MAX_CATCHUP_MS = 250;
/** No `C_HELLO` within this window closes the connection (§7, code 9). */
const HANDSHAKE_TIMEOUT_MS = 5000;

interface Connection {
  readonly socket: WebSocket;
  readonly session: Session;
  handshakeTimer: NodeJS.Timeout | null;
}

/**
 * The WebSocket transport and the authoritative clock.
 *
 * The tick loop is driven by a timer and an accumulator, never by anything a
 * client controls: `setInterval` fires approximately, so elapsed real time is
 * measured and whole simulation steps are consumed from it. A client's frame
 * rate, or a stalled client, cannot change how fast the world runs.
 */
export class GameServer {
  private readonly wss: WebSocketServer;
  private readonly room: Room;
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly devAuth: boolean;

  private timer: NodeJS.Timeout | null = null;
  private accumulatorMs = 0;
  private lastWakeMs = 0;
  private readonly startedAtMs = Date.now();

  constructor(world: ServerWorld, options: { port: number; devAuth: boolean }) {
    this.room = new Room(world);
    this.devAuth = options.devAuth;
    this.wss = new WebSocketServer({ port: options.port });

    this.wss.on("connection", (socket) => this.onConnection(socket));
    this.wss.on("listening", () => {
      log.info(`listening on ws://localhost:${options.port} (map ${this.room.map.id})`);
    });
  }

  get diagnostics(): RoomDiagnostics & { connections: number } {
    return { ...this.room.diagnostics, connections: this.connections.size };
  }

  private serverTimeMs(): number {
    return Date.now() - this.startedAtMs;
  }

  private onConnection(socket: WebSocket): void {
    socket.binaryType = "nodebuffer";

    const session = new Session(
      this.room,
      {
        onHandshake: (displayName) => {
          const player = this.room.addPlayer(displayName);
          // Everyone already present, then the newcomer, so a client can build
          // its roster before the first snapshot arrives.
          this.broadcast(
            Session.frame({
              type: ServerMessageType.PlayerJoin,
              playerId: player.playerId,
              displayName: player.displayName,
            }),
          );
          return player.playerId;
        },
        onLeave: (reason) => this.removeConnection(socket, reason),
      },
      this.devAuth,
      Date.now(),
    );

    const connection: Connection = {
      socket,
      session,
      handshakeTimer: setTimeout(() => {
        if (!session.identified) {
          log.warn("handshake timeout");
          this.closeWith(socket, ReasonCode.HandshakeTimeout);
        }
      }, HANDSHAKE_TIMEOUT_MS),
    };
    this.connections.set(socket, connection);

    socket.on("message", (data, isBinary) => {
      // §6 step 1: text frames are not part of this protocol.
      if (!isBinary) {
        this.closeWith(socket, ReasonCode.ProtocolError);
        return;
      }
      const bytes = toBytes(data);
      const action = session.handleFrame(bytes, Date.now(), this.serverTimeMs());
      for (const frame of action.send) this.send(socket, frame);
      if (action.close !== undefined) {
        socket.close(action.close.code);
        this.removeConnection(socket, action.close.reason);
      }
    });

    socket.on("close", () => this.removeConnection(socket, ReasonCode.Normal));
    socket.on("error", (error) => {
      log.warn(`socket error: ${error.message}`);
      this.removeConnection(socket, ReasonCode.InternalError);
    });
  }

  /**
   * Tears a connection down exactly once.
   *
   * Idempotent because it is reached from several directions — a protocol
   * rejection, a socket close and a socket error can all fire for the same
   * connection, and a player must not be removed from the room twice or leak a
   * timer if they do.
   */
  private removeConnection(socket: WebSocket, reason: ReasonCode): void {
    const connection = this.connections.get(socket);
    if (connection === undefined) return;
    this.connections.delete(socket);

    if (connection.handshakeTimer !== null) {
      clearTimeout(connection.handshakeTimer);
      connection.handshakeTimer = null;
    }

    const playerId = connection.session.id;
    if (playerId !== 0) {
      this.room.removePlayer(playerId);
      this.broadcast(
        Session.frame({ type: ServerMessageType.PlayerLeave, playerId, reasonCode: reason }),
      );
    }
  }

  private closeWith(socket: WebSocket, reason: ReasonCode): void {
    try {
      this.send(socket, Session.frame({ type: ServerMessageType.Reject, reasonCode: reason, detail: "" }));
      socket.close(closeCodeFor(reason));
    } finally {
      this.removeConnection(socket, reason);
    }
  }

  private send(socket: WebSocket, frame: Uint8Array): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(frame, { binary: true });
  }

  private broadcast(frame: Uint8Array): void {
    for (const connection of this.connections.values()) this.send(connection.socket, frame);
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastWakeMs = Date.now();
    // Woken more often than the tick rate so the accumulator rarely has to
    // consume more than one step, which keeps tick spacing even.
    this.timer = setInterval(() => this.pump(), Math.floor(SIM_DT_MS / 2));
  }

  private pump(): void {
    const now = Date.now();
    // Clamped: after a long stall, replaying every missed tick would freeze the
    // process trying to catch up. Time is dropped instead.
    this.accumulatorMs = Math.min(this.accumulatorMs + (now - this.lastWakeMs), MAX_CATCHUP_MS);
    this.lastWakeMs = now;

    while (this.accumulatorMs >= SIM_DT_MS) {
      this.accumulatorMs -= SIM_DT_MS;
      this.room.tickOnce();
      if (this.room.shouldSnapshot()) this.broadcastSnapshot();
    }
  }

  /** One snapshot per client: `ackInputSequence` is per-recipient. */
  private broadcastSnapshot(): void {
    const serverTimeMs = this.serverTimeMs();
    for (const connection of this.connections.values()) {
      const playerId = connection.session.id;
      if (playerId === 0) continue;
      const frame = Session.frame(this.room.buildSnapshot(playerId, serverTimeMs));
      this.room.recordSnapshotBytes(frame.byteLength);
      this.send(connection.socket, frame);
    }
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const connection of [...this.connections.values()]) {
      this.send(
        connection.socket,
        Session.frame({
          type: ServerMessageType.Reject,
          reasonCode: ReasonCode.ServerShutdown,
          detail: "server stopping",
        }),
      );
      connection.socket.close(closeCodeFor(ReasonCode.ServerShutdown));
      this.removeConnection(connection.socket, ReasonCode.ServerShutdown);
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

/** `ws` hands over a Buffer, an ArrayBuffer or an array of Buffers. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data as Buffer[]));
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(0);
}
