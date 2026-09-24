/**
 * @markov/observability
 *
 * Structured, redacted logging shared by every process. Tracing and metrics
 * exporters are deliberately not wired in B01; see docs/markov/open-decisions.md.
 */
import { type DestinationStream, type Logger, type LoggerOptions, pino } from 'pino';

export type { Logger } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface CreateLoggerOptions {
  readonly service: string;
  readonly version: string;
  readonly markovEnv: string;
  readonly level: LogLevel;
  readonly format: 'json' | 'pretty';
  /** Test hook: write to this stream instead of stdout. Incompatible with pretty format. */
  readonly destination?: DestinationStream;
}

/**
 * Keys whose values are replaced wherever they appear in a log object, up to
 * three levels deep. Add to this list when a new secret-bearing field name is
 * introduced; never log raw request bodies of financial operations.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'apikey',
  'privateKey',
  'private_key',
  'seed',
  'mnemonic',
  'signedTransaction',
  'signature',
  'authorization',
  'cookie',
  'set-cookie',
  'DATABASE_URL',
  'TEMPORAL_API_KEY',
] as const;

export const REDACT_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `req.headers.${key}`,
  `res.headers["${key}"]`,
]);

export const REDACTED_VALUE = '[redacted]';

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    base: { service: options.service, version: options.version, env: options.markovEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    redact: { paths: [...REDACT_PATHS], censor: REDACTED_VALUE },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (options.destination !== undefined) {
    return pino(loggerOptions, options.destination);
  }

  if (options.format === 'pretty') {
    return pino({
      ...loggerOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(loggerOptions);
}

/** A logger that discards everything; for tests and tools that must stay quiet. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
