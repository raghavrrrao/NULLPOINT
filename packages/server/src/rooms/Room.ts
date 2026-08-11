import {
  EntityField,
  IMPLEMENTED_ENTITY_FIELDS,
  LIMITS,
  MovementState,
  SIM_HZ,
  SNAPSHOT_HZ,
  SNAPSHOT_FLAG_FULL,
  ServerMessageType,
  StateFlag,
  createLogger,
  type EntityState,
  type GameplayMap,
  type InputCommand,
  type SnapshotMessage,
  type SpawnPoint,
} from "@nullpoint/shared";

import { ServerPlayer } from "../sim/ServerPlayer.ts";
import type { ServerWorld } from "../sim/world.ts";

const log = createLogger("room");

const SIM_DT = 1 / SIM_HZ;
const TICKS_PER_SNAPSHOT = Math.round(SIM_HZ / SNAPSHOT_HZ);

export interface RoomDiagnostics {
  readonly tick: number;
  readonly players: number;
  readonly lastTickMs: number;
  readonly worstTickMs: number;
  readonly snapshotsSent: number;
  readonly lastSnapshotBytes: number;
  readonly averageSnapshotBytes: number;
}

/**
 * One authoritative match.
 *
 * Owns the world, the players and the clock. Everything gameplay-affecting
 * happens inside `tick()`, at a fixed `SIM_DT`, independent of any client's
 * frame rate — a player on a 30 Hz laptop and one on a 240 Hz desktop are
 * simulated identically.
 *
 * Session B runs movement only. Combat, health and respawn-on-death are
 * Session C; the shapes here are chosen so adding them does not restructure it.
 */
export class Room {
  readonly map: GameplayMap;

  private readonly world: ServerWorld;
  private readonly players = new Map<number, ServerPlayer>();
  /** Queued commands per player, consumed one per tick. */
  private readonly pending = new Map<number, InputCommand[]>();

  private tickCount = 0;
  private nextPlayerId: number = LIMITS.playerIdMin;
  private ticksSinceSnapshot = 0;

  // Diagnostics.
  private lastTickMs = 0;
  private worstTickMs = 0;
  private snapshotsSent = 0;
  private lastSnapshotBytes = 0;
  private totalSnapshotBytes = 0;

  constructor(world: ServerWorld) {
    this.world = world;
    this.map = world.map;
  }

  get tick(): number {
    return this.tickCount;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get diagnostics(): RoomDiagnostics {
    return {
      tick: this.tickCount,
      players: this.players.size,
      lastTickMs: this.lastTickMs,
      worstTickMs: this.worstTickMs,
      snapshotsSent: this.snapshotsSent,
      lastSnapshotBytes: this.lastSnapshotBytes,
      averageSnapshotBytes:
        this.snapshotsSent === 0 ? 0 : this.totalSnapshotBytes / this.snapshotsSent,
    };
  }

  /**
   * Picks a spawn.
   *
   * **Temporary, development only.** Round-robin over the map's spawn points.
   * Real selection — furthest from an enemy, team sides, or fixed — is a
   * game-mode decision and is still OPEN (`PROJECT.md` Q2/Q8).
   */
  private selectSpawn(): SpawnPoint {
    const spawns = this.map.spawns;
    const spawn = spawns[this.players.size % spawns.length];
    if (spawn === undefined) throw new Error(`map ${this.map.id} has no spawns`);
    return spawn;
  }

  /** Allocates an id that is free in this room. Ids are reused after a leave. */
  private allocatePlayerId(): number {
    for (let attempt = 0; attempt <= LIMITS.playerIdMax - LIMITS.playerIdMin; attempt++) {
      const candidate = this.nextPlayerId;
      this.nextPlayerId = this.nextPlayerId >= LIMITS.playerIdMax ? LIMITS.playerIdMin : this.nextPlayerId + 1;
      if (!this.players.has(candidate)) return candidate;
    }
    throw new Error("no free player id");
  }

  addPlayer(displayName: string): ServerPlayer {
    const playerId = this.allocatePlayerId();
    const player = new ServerPlayer(playerId, displayName, this.world, this.selectSpawn());
    this.players.set(playerId, player);
    this.pending.set(playerId, []);
    log.info(`player ${playerId} (${displayName}) joined; ${this.players.size} in room`);
    return player;
  }

  removePlayer(playerId: number): void {
    const player = this.players.get(playerId);
    if (player === undefined) return;
    player.dispose();
    this.players.delete(playerId);
    this.pending.delete(playerId);
    log.info(`player ${playerId} left; ${this.players.size} in room`);
  }

  getPlayer(playerId: number): ServerPlayer | undefined {
    return this.players.get(playerId);
  }

  /**
   * Queues validated commands.
   *
   * Commands at or below the last applied sequence are dropped — a client sends
   * its recent commands redundantly (`NETWORK_PROTOCOL.md` §4.2), so seeing one
   * twice is normal traffic rather than an error. Returns how many were queued.
   */
  enqueueInput(playerId: number, commands: readonly InputCommand[]): number {
    const player = this.players.get(playerId);
    const queue = this.pending.get(playerId);
    if (player === undefined || queue === undefined) return 0;

    let queued = 0;
    const highestQueued = queue.length > 0 ? (queue[queue.length - 1]?.sequence ?? 0) : 0;
    const floor = Math.max(player.acknowledgedSequence, highestQueued);

    for (const command of commands) {
      if (command.sequence <= floor) continue;
      queue.push(command);
      queued += 1;
    }

    // A queue only grows if the client is sending faster than the server ticks.
    // Bounded so a burst cannot buy a player a long tail of banked movement.
    const maxQueued = LIMITS.commandCountMax * 2;
    if (queue.length > maxQueued) queue.splice(0, queue.length - maxQueued);

    return queued;
  }

  /**
   * Advances the simulation one tick.
   *
   * **At most one command per player per tick** (§4.2), so a client cannot move
   * faster by sending more input.
   */
  tickOnce(): void {
    const started = performance.now();

    for (const [playerId, player] of this.players) {
      const queue = this.pending.get(playerId);
      const command = queue?.shift();
      if (command === undefined) player.applyIdleTick(SIM_DT);
      else player.applyCommand(command, SIM_DT);
    }

    this.world.step();
    this.tickCount += 1;

    this.lastTickMs = performance.now() - started;
    if (this.lastTickMs > this.worstTickMs) this.worstTickMs = this.lastTickMs;
  }

  /** True on the ticks a snapshot is due. */
  shouldSnapshot(): boolean {
    this.ticksSinceSnapshot += 1;
    if (this.ticksSinceSnapshot < TICKS_PER_SNAPSHOT) return false;
    this.ticksSinceSnapshot = 0;
    return true;
  }

  /**
   * Builds a snapshot for one client.
   *
   * `ackInputSequence` is per-recipient — it is what drives that client's
   * reconciliation in Session C, and it means nothing to anyone else.
   *
   * Session B sends **FULL** snapshots only. Delta encoding needs per-client
   * baseline tracking, which is real work and belongs with the prediction it
   * exists to serve.
   */
  buildSnapshot(forPlayerId: number, serverTimeMs: number): SnapshotMessage {
    const recipient = this.players.get(forPlayerId);
    const entities: EntityState[] = [];

    for (const player of this.players.values()) {
      let stateFlags = 0;
      if (player.state.grounded) stateFlags |= StateFlag.Grounded;
      if (player.state.crouching) stateFlags |= StateFlag.Crouched;
      if (player.state.movementState === MovementState.Sprint) stateFlags |= StateFlag.Sprinting;

      entities.push({
        playerId: player.playerId,
        fieldMask: IMPLEMENTED_ENTITY_FIELDS,
        position: { ...player.state.position },
        velocity: { ...player.state.velocity },
        yaw: player.state.yaw,
        pitch: player.pitch,
        stateFlags,
      });
    }

    return {
      type: ServerMessageType.Snapshot,
      tick: this.tickCount,
      serverTimeMs,
      ackInputSequence: recipient?.acknowledgedSequence ?? 0,
      flags: SNAPSHOT_FLAG_FULL,
      baselineTick: 0,
      entities,
    };
  }

  recordSnapshotBytes(bytes: number): void {
    this.snapshotsSent += 1;
    this.lastSnapshotBytes = bytes;
    this.totalSnapshotBytes += bytes;
  }

  /** Field mask a v1 FULL snapshot uses. Exposed for tests. */
  static get fullFieldMask(): number {
    return IMPLEMENTED_ENTITY_FIELDS;
  }

  /** Present so a future delta encoder has an obvious place to start. */
  static get positionField(): number {
    return EntityField.Position;
  }
}
