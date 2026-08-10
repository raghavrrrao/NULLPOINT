/**
 * The project logger.
 *
 * `CLAUDE.md` §5 bans `console.log` in committed code. This module is the single
 * sanctioned place where the console is touched, so log output has one level
 * filter and one format instead of being scattered across the codebase.
 */

export const LogLevel = {
  Debug: 10,
  Info: 20,
  Warn: 30,
  Error: 40,
  Silent: 100,
} as const;

export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

export interface Logger {
  debug(message: string, ...details: readonly unknown[]): void;
  info(message: string, ...details: readonly unknown[]): void;
  warn(message: string, ...details: readonly unknown[]): void;
  error(message: string, ...details: readonly unknown[]): void;
  child(scope: string): Logger;
}

let activeLevel: LogLevelValue = LogLevel.Info;

export function setLogLevel(level: LogLevelValue): void {
  activeLevel = level;
}

export function getLogLevel(): LogLevelValue {
  return activeLevel;
}

function emit(
  level: LogLevelValue,
  scope: string,
  message: string,
  details: readonly unknown[],
): void {
  if (level < activeLevel) return;

  const prefix = `[${scope}]`;

  // The only sanctioned console usage in the project — see the module comment.
  /* eslint-disable no-console */
  if (level >= LogLevel.Error) {
    console.error(prefix, message, ...details);
  } else if (level >= LogLevel.Warn) {
    console.warn(prefix, message, ...details);
  } else {
    console.info(prefix, message, ...details);
  }
  /* eslint-enable no-console */
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, ...details) => emit(LogLevel.Debug, scope, message, details),
    info: (message, ...details) => emit(LogLevel.Info, scope, message, details),
    warn: (message, ...details) => emit(LogLevel.Warn, scope, message, details),
    error: (message, ...details) => emit(LogLevel.Error, scope, message, details),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}
