import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { storefrontUrl, adminUrl, apiUrl } from '@retailos/config';
import { AppConfig, buildConfig } from './configuration';
import { validateEnv } from './env.schema';

/**
 * Thin, fully typed wrapper over the validated configuration.
 *
 * Everything downstream injects this instead of `ConfigService<...>` with
 * string keys, so a renamed setting is a compile error rather than an
 * `undefined` at runtime.
 */
@Injectable()
export class AppConfigService {
  private readonly config: AppConfig;

  constructor(private readonly nestConfig: ConfigService) {
    this.config = this.nestConfig.get<AppConfig>('app')!;
  }

  get env() {
    return this.config.env;
  }
  get isProd() {
    return this.config.isProd;
  }
  get isDev() {
    return this.config.isDev;
  }
  get isTest() {
    return this.config.isTest;
  }
  get serviceName() {
    return this.config.serviceName;
  }
  get http() {
    return this.config.http;
  }
  get log() {
    return this.config.log;
  }
  get domain() {
    return this.config.domain;
  }
  get masterDb() {
    return this.config.masterDb;
  }
  get tenantDb() {
    return this.config.tenantDb;
  }
  get auth() {
    return this.config.auth;
  }
  get crypto() {
    return this.config.crypto;
  }
  get redis() {
    return this.config.redis;
  }
  get mysql() {
    return this.config.mysql;
  }
  get storage() {
    return this.config.storage;
  }
  get payments() {
    return this.config.payments;
  }
  get notifications() {
    return this.config.notifications;
  }
  get security() {
    return this.config.security;
  }
  get queue() {
    return this.config.queue;
  }
  get observability() {
    return this.config.observability;
  }
  get seed() {
    return this.config.seed;
  }

  /** Full config object, for the rare consumer that needs to pass it wholesale. */
  get all(): AppConfig {
    return this.config;
  }

  // ------------------------------------------------------------------ URLs --

  storefrontUrlFor(slug: string): string {
    return storefrontUrl(slug, this.config.domain);
  }
  get adminConsoleUrl(): string {
    return adminUrl(this.config.domain);
  }
  get publicApiUrl(): string {
    return apiUrl(this.config.domain);
  }
}

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // The repo root `.env` is the single file every service reads, so the API,
      // the worker and docker compose can never drift apart.
      envFilePath: ['.env.local', '.env', '../../.env'],
      validate: (raw) => ({ app: buildConfig(validateEnv(raw)) }),
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService, NestConfigModule],
})
export class AppConfigModule {}
