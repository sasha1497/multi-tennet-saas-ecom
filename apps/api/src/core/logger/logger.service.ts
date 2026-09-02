import { Global, Injectable, LoggerService, Module } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { RequestContextService } from '@/core/context/request-context';

/**
 * Structured logging built on pino.
 *
 * Every line automatically carries requestId, tenantId and userId pulled from
 * the AsyncLocalStorage context — no call site has to remember to pass them,
 * which is exactly why they are actually present when you need them at 3 a.m.
 *
 * In production the output is newline-delimited JSON, which CloudWatch, Loki and
 * Datadog all ingest without a parser.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly root: PinoLogger;
  private context?: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    this.root = pino({
      level: config.log.level,
      base: {
        service: config.serviceName,
        env: config.env,
      },
      // Never let a stray token or password reach the log store.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-guest-token"]',
          'req.headers["x-internal-api-key"]',
          'password',
          'passwordHash',
          'newPassword',
          'currentPassword',
          '*.password',
          '*.passwordHash',
          'refreshToken',
          '*.refreshToken',
          'accessToken',
          '*.accessToken',
          'encryptedPassword',
          '*.encryptedPassword',
          'signature',
          'keySecret',
          'webhookSecret',
        ],
        censor: '[redacted]',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(config.log.pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss.l',
                ignore: 'pid,hostname,service,env',
                messageFormat: '{context}{if requestId} [{requestId}]{end} {msg}',
              },
            },
          }
        : {}),
    });
  }

  /** Returns a child logger tagged with a class/module name. */
  withContext(context: string): AppLogger {
    const child = new AppLogger(this.config, this.requestContext);
    (child as { root: PinoLogger }).root = this.root.child({ context });
    child.context = context;
    return child;
  }

  setContext(context: string): void {
    this.context = context;
  }

  /** The underlying pino instance, for pino-http and other integrations. */
  get pino(): PinoLogger {
    return this.root;
  }

  private fields(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      ...this.requestContext.logFields(),
      ...(this.context ? { context: this.context } : {}),
      ...extra,
    };
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.info(String(message), mergeExtras(optional));
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.root.info(this.fields(extra), message);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.root.debug(this.fields(mergeExtras(optional)), String(message));
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.root.trace(this.fields(mergeExtras(optional)), String(message));
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.root.warn(this.fields(mergeExtras(optional)), String(message));
  }

  error(message: unknown, trace?: unknown, ...optional: unknown[]): void {
    const extra = mergeExtras(optional);
    if (trace instanceof Error) {
      this.root.error({ ...this.fields(extra), err: serialiseError(trace) }, String(message));
    } else {
      this.root.error(
        { ...this.fields(extra), ...(trace ? { stack: String(trace) } : {}) },
        String(message),
      );
    }
  }

  fatal(message: unknown, error?: Error, extra?: Record<string, unknown>): void {
    this.root.fatal(
      { ...this.fields(extra), ...(error ? { err: serialiseError(error) } : {}) },
      String(message),
    );
  }
}

function mergeExtras(optional: unknown[]): Record<string, unknown> | undefined {
  const objects = optional.filter(
    (o): o is Record<string, unknown> => typeof o === 'object' && o !== null,
  );
  if (objects.length === 0) return undefined;
  return Object.assign({}, ...objects);
}

export function serialiseError(err: Error): Record<string, unknown> {
  return {
    type: err.name,
    message: err.message,
    stack: err.stack,
    ...(('code' in err) ? { code: (err as { code?: unknown }).code } : {}),
  };
}

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [RequestContextService, AppLogger],
  exports: [RequestContextService, AppLogger],
})
export class LoggerModule {}
