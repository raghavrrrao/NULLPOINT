import {
  MAP01_GAMEPLAY,
  PROTOCOL_VERSION,
  SIM_HZ,
  SNAPSHOT_HZ,
  TRAINING_GAMEPLAY,
  createLogger,
  type GameplayMap,
} from "@nullpoint/shared";

import { loadConfig } from "./config/index.ts";
import { GameServer } from "./net/gameServer.ts";
import { validateGameplayMap } from "./sim/collision.ts";
import { ServerWorld, initPhysics } from "./sim/world.ts";

const log = createLogger("server");

const MAPS: Record<string, GameplayMap> = {
  [MAP01_GAMEPLAY.id]: MAP01_GAMEPLAY,
  [TRAINING_GAMEPLAY.id]: TRAINING_GAMEPLAY,
};

/** Periodic one-line health report. Deliberately not per tick. */
const DIAGNOSTIC_INTERVAL_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const map = MAPS[config.mapId.toUpperCase()] ?? MAP01_GAMEPLAY;

  const problems = validateGameplayMap(map);
  if (problems.length > 0) {
    for (const problem of problems) log.error(problem);
    process.exitCode = 1;
    return;
  }

  await initPhysics();
  const world = new ServerWorld(map);
  const server = new GameServer(world, { port: config.port, devAuth: config.devAuth });
  server.start();

  log.info(`protocol v${PROTOCOL_VERSION}, sim ${SIM_HZ} Hz, snapshots ${SNAPSHOT_HZ} Hz`);
  log.info(`map ${map.id}: ${map.geometry.length} solid boxes, ${map.spawns.length} spawns`);
  if (config.devAuth) log.warn("development auth: any non-empty token is accepted (Phase 7 adds Firebase)");

  const reporter = setInterval(() => {
    const d = server.diagnostics;
    if (d.connections === 0) return;
    log.info(
      `tick ${d.tick} | ${d.connections} conn, ${d.players} players | ` +
        `tick ${d.lastTickMs.toFixed(2)}ms (worst ${d.worstTickMs.toFixed(2)}) | ` +
        `${d.snapshotsSent} snapshots, avg ${d.averageSnapshotBytes.toFixed(0)} B`,
    );
  }, DIAGNOSTIC_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(reporter);
    void server.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
