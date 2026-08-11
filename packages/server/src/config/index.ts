/**
 * Server runtime configuration.
 *
 * Read from the environment with explicit defaults, never from a committed
 * file: `CLAUDE.md` §11 keeps secrets and deployment specifics out of the
 * repository, and a default that works for local development is the only thing
 * this phase needs.
 */

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name}=${raw} is not a valid port`);
  }
  return parsed;
}

export interface ServerConfig {
  readonly port: number;
  /** Map the development room runs. */
  readonly mapId: string;
  /**
   * Development auth mode.
   *
   * `NETWORK_PROTOCOL.md` §4.1: the `idToken` field exists on the wire from
   * Phase 3, but Firebase Admin verification does not land until Phase 7. Until
   * then the server accepts a local development token. This flag gates that,
   * and a production start must refuse it.
   */
  readonly devAuth: boolean;
}

export function loadConfig(): ServerConfig {
  const production = process.env["NODE_ENV"] === "production";
  const devAuth = process.env["NULLPOINT_DEV_AUTH"] !== "0";

  if (production && devAuth) {
    throw new Error(
      "development auth mode is not permitted in production; set NULLPOINT_DEV_AUTH=0",
    );
  }

  return {
    port: port("NULLPOINT_PORT", 8080),
    mapId: process.env["NULLPOINT_MAP"] ?? "MAP01",
    devAuth,
  };
}
