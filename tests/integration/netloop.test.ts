import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { WebSocket } from "ws";

import {
  Button,
  ClientMessageType,
  MAP01_GAMEPLAY,
  PROTOCOL_VERSION,
  ReasonCode,
  SNAPSHOT_HZ,
  ServerMessageType,
  StateFlag,
  decodeServerMessage,
  encodeClientMessage,
  type ServerMessage,
  type SnapshotMessage,
  type WelcomeMessage,
} from "../../packages/shared/src/index.ts";
import { GameServer } from "../../packages/server/src/net/gameServer.ts";
import { ServerWorld, initPhysics } from "../../packages/server/src/sim/world.ts";

/**
 * The authoritative loop, end to end, over a real WebSocket.
 *
 * A real socket and the real codecs — not a mocked transport. What is being
 * tested is that a client which only ever sends *intent* ends up moved by the
 * server, and that everything a hostile client could send is refused with the
 * documented reason code.
 */

const PORT = 8123;
let world: ServerWorld;
let server: GameServer;

/** Minimal protocol client: connect, handshake, drive input, collect snapshots. */
class TestClient {
  readonly socket: WebSocket;
  readonly snapshots: SnapshotMessage[] = [];
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;
  playerId = 0;
  private sequence = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.binaryType = "nodebuffer";
    socket.on("message", (data: Buffer) => {
      const result = decodeServerMessage(new Uint8Array(data));
      if (!result.ok) throw new Error(`server sent an undecodable frame: ${result.detail}`);
      this.messages.push(result.message);
      if (result.message.type === ServerMessageType.Snapshot) this.snapshots.push(result.message);
      if (result.message.type === ServerMessageType.Welcome) this.playerId = result.message.playerId;
    });
    socket.on("close", (code: number) => {
      this.closeCode = code;
    });
  }

  static async connect(): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return client;
  }

  send(bytes: Uint8Array): void {
    this.socket.send(bytes, { binary: true });
  }

  async handshake(token = "dev-token"): Promise<WelcomeMessage> {
    this.send(
      encodeClientMessage({
        type: ClientMessageType.Hello,
        protocolVersion: PROTOCOL_VERSION,
        idToken: token,
      }),
    );
    const welcome = await this.waitFor(
      (m): m is WelcomeMessage => m.type === ServerMessageType.Welcome,
      2000,
    );
    return welcome;
  }

  /**
   * Sends input the way a real client does: paced, not bursted.
   *
   * Firing every command at once is not a faster version of the same thing. The
   * server applies **at most one command per tick** and caps the queue, so a
   * burst is mostly discarded — which is the correct anti-speedhack behaviour
   * and makes a burst a bad way to ask for a second of movement.
   */
  async drive(buttons: number, ticks: number, yaw = 0, pitch = 0): Promise<void> {
    for (let i = 0; i < ticks; i++) {
      this.sequence += 1;
      this.send(
        encodeClientMessage({
          type: ClientMessageType.Input,
          ackSnapshotTick: 0,
          commands: [{ sequence: this.sequence, buttons, yaw, pitch }],
        }),
      );
      await sleep(16);
    }
  }

  get lastSequence(): number {
    return this.sequence;
  }

  async waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    timeoutMs: number,
  ): Promise<T> {
    const existing = this.messages.find(predicate);
    if (existing !== undefined) return existing;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
      const onMessage = (data: Buffer): void => {
        const result = decodeServerMessage(new Uint8Array(data));
        if (result.ok && predicate(result.message)) {
          clearTimeout(timer);
          this.socket.off("message", onMessage);
          resolve(result.message);
        }
      };
      this.socket.on("message", onMessage);
    });
  }

  /** Waits until `count` snapshots have arrived, or throws. */
  async collectSnapshots(count: number, timeoutMs = 4000): Promise<SnapshotMessage[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.snapshots.length < count) {
      if (Date.now() > deadline) throw new Error(`only ${this.snapshots.length}/${count} snapshots`);
      await sleep(20);
    }
    return this.snapshots;
  }

  async closed(): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;
    return new Promise<number>((resolve) => {
      this.socket.once("close", (code: number) => resolve(code));
    });
  }

  dispose(): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selfEntity(snapshot: SnapshotMessage, playerId: number) {
  return snapshot.entities.find((e) => e.playerId === playerId);
}

before(async () => {
  await initPhysics();
  world = new ServerWorld(MAP01_GAMEPLAY);
  server = new GameServer(world, { port: PORT, devAuth: true });
  server.start();
  await sleep(150);
});

after(async () => {
  await server.stop();
  world.dispose();
});

describe("connection lifecycle", () => {
  it("assigns a player id and reports the documented rates", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();

    assert.equal(welcome.protocolVersion, PROTOCOL_VERSION);
    assert.ok(welcome.playerId >= 1 && welcome.playerId <= 65534);
    assert.equal(welcome.simHz, 60);
    assert.equal(welcome.snapshotHz, SNAPSHOT_HZ);
    client.dispose();
  });

  it("spawns the player at a MAP01 spawn point, on the floor", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();
    const [first] = await client.collectSnapshots(1);

    const self = selfEntity(first!, welcome.playerId);
    assert.ok(self !== undefined, "the snapshot should contain the player");
    assert.ok(self.position !== undefined);

    const near = MAP01_GAMEPLAY.spawns.some(
      (spawn) =>
        Math.hypot(spawn.position.x - self.position!.x, spawn.position.z - self.position!.z) < 1.5,
    );
    assert.ok(near, `spawned at ${JSON.stringify(self.position)}, not near any MAP01 spawn`);
    // On the ground rather than falling through it or floating.
    assert.ok(self.position.y < 1, `spawn y ${self.position.y}`);
    client.dispose();
  });

  it("refuses anything before the handshake", async () => {
    const client = await TestClient.connect();
    client.send(encodeClientMessage({ type: ClientMessageType.Ping, clientTimeMs: 1 }));

    const code = await client.closed();
    assert.equal(code, 4000 + ReasonCode.ProtocolError);
  });

  it("refuses a version mismatch and does not admit the player", async () => {
    const client = await TestClient.connect();
    client.send(
      encodeClientMessage({
        type: ClientMessageType.Hello,
        protocolVersion: PROTOCOL_VERSION + 7,
        idToken: "dev",
      }),
    );
    const code = await client.closed();
    assert.equal(code, 4000 + ReasonCode.VersionMismatch);
  });

  it("answers a ping with the echoed client time", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    client.send(encodeClientMessage({ type: ClientMessageType.Ping, clientTimeMs: 4242 }));

    const pong = await client.waitFor((m) => m.type === ServerMessageType.Pong, 2000);
    assert.equal(pong.clientTimeMs, 4242);
    client.dispose();
  });
});

describe("authoritative movement", () => {
  it("moves the player when it is sent forward input, and only then", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();
    await client.collectSnapshots(2);

    const before = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    const startZ = before.position!.z;

    // Yaw 0 means forward is −Z.
    await client.drive(Button.Forward, 45);
    await sleep(200);

    const after = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    assert.ok(
      after.position!.z < startZ - 0.5,
      `expected to travel −Z; ${startZ} -> ${after.position!.z}`,
    );
    client.dispose();
  });

  it("acknowledges the input sequence it has applied", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    await client.drive(Button.Forward, 20);
    await sleep(300);

    const latest = client.snapshots[client.snapshots.length - 1]!;
    assert.ok(latest.ackInputSequence > 0, "server should acknowledge applied input");
    assert.ok(
      latest.ackInputSequence <= client.lastSequence,
      "server must not acknowledge input it was never sent",
    );
    client.dispose();
  });

  it("reports crouch and sprint through the state flags", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();
    await client.collectSnapshots(1);

    await client.drive(Button.Crouch, 25);
    await sleep(200);
    const crouched = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    assert.ok(((crouched.stateFlags ?? 0) & StateFlag.Crouched) !== 0, "crouch should replicate");

    // Aimed at the middle of the map rather than straight ahead. Every spawn has
    // cover a couple of metres in front of it — that is the point of a spawn —
    // so "hold forward" runs into a wall long before sprint speed is reached.
    const here = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    const towardCentre = Math.atan2(-(0 - here.position!.x), -(0 - here.position!.z));

    const before = client.snapshots.length;
    await client.drive(Button.Forward | Button.Sprint, 110, towardCentre);
    await sleep(200);

    const sprinted = client.snapshots
      .slice(before)
      .some((snapshot) => {
        const self = selfEntity(snapshot, welcome.playerId);
        return (((self?.stateFlags ?? 0) & StateFlag.Sprinting) !== 0);
      });
    assert.ok(sprinted, "sprint should replicate at some point during the run");
    client.dispose();
  });

  it("leaves the player grounded and stationary with no input", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();
    await client.collectSnapshots(6);

    const latest = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    assert.ok(((latest.stateFlags ?? 0) & StateFlag.Grounded) !== 0, "should settle on the ground");
    assert.ok(Math.abs(latest.velocity!.x) < 0.01 && Math.abs(latest.velocity!.z) < 0.01);
    client.dispose();
  });

  it("keeps the player inside the map when it drives at a wall", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();
    await client.collectSnapshots(1);

    // Drive north for long enough to cross the whole map.
    await client.drive(Button.Forward | Button.Sprint, 150);
    await sleep(400);

    const self = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    assert.ok(
      self.position!.z > MAP01_GAMEPLAY.bounds.z[0],
      `escaped the north boundary: z ${self.position!.z}`,
    );
    client.dispose();
  });
});

describe("input validation", () => {
  it("rejects a reserved button bit", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    // Bit 15 is reserved and must be zero.
    client.send(
      encodeClientMessage({
        type: ClientMessageType.Input,
        ackSnapshotTick: 0,
        commands: [{ sequence: 1, buttons: 1 << 15, yaw: 0, pitch: 0 }],
      }),
    );
    assert.equal(await client.closed(), 4000 + ReasonCode.InvalidField);
  });

  it("rejects an acknowledgement of a tick the server has not reached", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    client.send(
      encodeClientMessage({
        type: ClientMessageType.Input,
        ackSnapshotTick: 0xffffff,
        commands: [{ sequence: 1, buttons: 0, yaw: 0, pitch: 0 }],
      }),
    );
    assert.equal(await client.closed(), 4000 + ReasonCode.InvalidField);
  });

  it("rejects an unknown message id", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    client.send(new Uint8Array([0x7e]));
    assert.equal(await client.closed(), 4000 + ReasonCode.UnknownMessage);
  });

  it("ignores replayed commands rather than applying them twice", async () => {
    const client = await TestClient.connect();
    const welcome = await client.handshake();
    await client.collectSnapshots(1);

    const replay = encodeClientMessage({
      type: ClientMessageType.Input,
      ackSnapshotTick: 0,
      commands: [{ sequence: 1, buttons: Button.Forward, yaw: 0, pitch: 0 }],
    });
    // The same command twenty times: redundant sends are normal traffic
    // (§4.2), so this must be absorbed, not stacked into twenty ticks of travel.
    for (let i = 0; i < 20; i++) client.send(replay);
    await sleep(700);

    const self = selfEntity(client.snapshots[client.snapshots.length - 1]!, welcome.playerId)!;
    // One tick of walking is centimetres; twenty would be far more.
    assert.ok(Math.abs(self.velocity!.z) < 6, `replay was stacked: vz ${self.velocity!.z}`);
    client.dispose();
  });
});

describe("snapshots", () => {
  it("arrive at roughly the documented rate", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    await client.collectSnapshots(1);

    const before = client.snapshots.length;
    await sleep(1000);
    const produced = client.snapshots.length - before;

    // 20 Hz nominal; a wide band, because this is a timer on a loaded machine.
    assert.ok(produced >= 12 && produced <= 28, `${produced} snapshots in ~1 s`);
    client.dispose();
  });

  it("advance the server tick monotonically", async () => {
    const client = await TestClient.connect();
    await client.handshake();
    const snapshots = await client.collectSnapshots(5);

    for (let i = 1; i < snapshots.length; i++) {
      assert.ok(
        snapshots[i]!.tick > snapshots[i - 1]!.tick,
        `tick went backwards: ${snapshots[i - 1]!.tick} -> ${snapshots[i]!.tick}`,
      );
    }
    client.dispose();
  });
});

describe("disconnect", () => {
  it("removes the player and tells the remaining clients", async () => {
    const watcher = await TestClient.connect();
    await watcher.handshake();

    const leaver = await TestClient.connect();
    const leaverWelcome = await leaver.handshake();
    await sleep(200);

    leaver.send(encodeClientMessage({ type: ClientMessageType.Leave }));
    // Matched on the specific id: this watcher has seen other players leave in
    // earlier tests, and the first PlayerLeave in its history is not this one.
    const notice = await watcher.waitFor(
      (m): m is ServerMessage & { playerId: number } =>
        m.type === ServerMessageType.PlayerLeave && m.playerId === leaverWelcome.playerId,
      2000,
    );
    assert.equal(notice.playerId, leaverWelcome.playerId);

    // And the departed player stops appearing in snapshots.
    await sleep(300);
    const before = watcher.snapshots.length;
    await sleep(400);
    for (const snapshot of watcher.snapshots.slice(before)) {
      assert.equal(
        selfEntity(snapshot, leaverWelcome.playerId),
        undefined,
        "a disconnected player must not remain in the world",
      );
    }
    watcher.dispose();
  });

  it("survives repeated connect/disconnect without leaking players", async () => {
    const watcher = await TestClient.connect();
    await watcher.handshake();
    await watcher.collectSnapshots(1);
    const baseline = watcher.snapshots[watcher.snapshots.length - 1]!.entities.length;

    for (let i = 0; i < 4; i++) {
      const client = await TestClient.connect();
      await client.handshake();
      await sleep(120);
      client.socket.close();
      await sleep(180);
    }

    await sleep(400);
    const after = watcher.snapshots[watcher.snapshots.length - 1]!.entities.length;
    assert.equal(
      after,
      baseline,
      `four connect/disconnect cycles leaked ${after - baseline} players`,
    );
    watcher.dispose();
  });
});
