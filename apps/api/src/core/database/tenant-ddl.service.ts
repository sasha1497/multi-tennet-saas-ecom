import { Client as PgClient } from 'pg';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';

export interface CreatedDatabase {
  databaseName: string;
  username: string;
  password: string;
  host: string;
  port: number;
  clusterId: string;
}

/**
 * Physical database provisioning: `CREATE DATABASE`, `CREATE ROLE`, grants.
 *
 * Prisma cannot do this — `CREATE DATABASE` may not run inside a transaction and
 * needs a connection to a *different* database than the one being created — so
 * this talks to PostgreSQL through `pg` with the admin credentials.
 *
 * Every operation is idempotent: re-running against an existing database or role
 * succeeds without error, which is what makes provisioning retry-safe.
 *
 * SECURITY: identifiers cannot be parameterised in DDL, so every identifier is
 * validated against a strict pattern *and* quoted before interpolation. Nothing
 * user-supplied reaches these strings unvalidated — the tenant slug has already
 * been through `slugSchema`, and the names built here are derived, not raw.
 */
@Injectable()
export class TenantDdlService {
  private readonly logger: AppLogger;

  constructor(
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantDdl');
  }

  /** `tenant_kickzone` — deterministic, so a retry targets the same database. */
  databaseNameFor(slug: string): string {
    const safe = this.sanitiseIdentifierPart(slug);
    // PostgreSQL truncates identifiers at 63 bytes.
    return `${this.config.tenantDb.namePrefix}${safe}`.slice(0, 63);
  }

  /** `tu_kickzone` — a least-privilege role that owns only this one database. */
  usernameFor(slug: string): string {
    const safe = this.sanitiseIdentifierPart(slug);
    return `${this.config.tenantDb.userPrefix}${safe}`.slice(0, 63);
  }

  /**
   * Creates the role and database for a tenant if they do not already exist.
   * Returns the connection details; the caller encrypts and stores them.
   */
  async createTenantDatabase(params: {
    slug: string;
    password: string;
  }): Promise<CreatedDatabase> {
    const databaseName = this.databaseNameFor(params.slug);
    const username = this.usernameFor(params.slug);
    const admin = await this.connectAdmin();

    try {
      await this.ensureRole(admin, username, params.password);
      await this.ensureDatabase(admin, databaseName, username);
    } finally {
      await admin.end().catch(() => undefined);
    }

    // Schema-level grants must be issued while connected to the new database.
    await this.grantSchemaPrivileges(databaseName, username);

    this.logger.info('Tenant database ready', { databaseName, username });

    return {
      databaseName,
      username,
      password: params.password,
      host: this.config.tenantDb.host,
      port: this.config.tenantDb.port,
      clusterId: this.config.tenantDb.clusterId,
    };
  }

  private async ensureRole(admin: PgClient, username: string, password: string): Promise<void> {
    const quoted = this.quoteIdentifier(username);
    const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);

    if (exists.rowCount === 0) {
      // The password IS parameterisable here via the literal-quoting helper;
      // pg has no bind support inside CREATE ROLE.
      await admin.query(
        `CREATE ROLE ${quoted} WITH LOGIN PASSWORD ${this.quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
      );
      this.logger.debug('Created tenant role', { username });
    } else {
      // Re-running provisioning rotates the password to the one we just stored,
      // so the registry and the server can never disagree.
      await admin.query(`ALTER ROLE ${quoted} WITH LOGIN PASSWORD ${this.quoteLiteral(password)}`);
      this.logger.debug('Rotated existing tenant role password', { username });
    }
  }

  private async ensureDatabase(
    admin: PgClient,
    databaseName: string,
    owner: string,
  ): Promise<void> {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (exists.rowCount && exists.rowCount > 0) {
      this.logger.debug('Tenant database already exists', { databaseName });
      return;
    }

    await admin.query(
      `CREATE DATABASE ${this.quoteIdentifier(databaseName)} ` +
        `WITH OWNER ${this.quoteIdentifier(owner)} ENCODING 'UTF8' TEMPLATE template0`,
    );
    this.logger.info('Created tenant database', { databaseName, owner });
  }

  private async grantSchemaPrivileges(databaseName: string, username: string): Promise<void> {
    const client = await this.connect(databaseName);
    try {
      const user = this.quoteIdentifier(username);
      // PostgreSQL 15+ revokes CREATE on public from PUBLIC by default, so the
      // tenant role needs it granted explicitly to run migrations.
      await client.query(`GRANT ALL ON SCHEMA public TO ${user}`);
      await client.query(`ALTER SCHEMA public OWNER TO ${user}`);
      await client.query(
        `GRANT ALL PRIVILEGES ON DATABASE ${this.quoteIdentifier(databaseName)} TO ${user}`,
      );
      // Extensions must be created by a superuser; do it once, up front, so the
      // tenant migration itself does not need elevated rights.
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await client.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  /**
   * Drops a tenant database. Only ever called from the explicit, audited
   * deprovisioning path — never as part of an error rollback, because a
   * half-failed provision must be retried, not destroyed.
   */
  async dropTenantDatabase(databaseName: string, username?: string): Promise<void> {
    const admin = await this.connectAdmin();
    try {
      // Terminate stragglers, otherwise DROP DATABASE fails.
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${this.quoteIdentifier(databaseName)}`);
      if (username) {
        await admin.query(`DROP ROLE IF EXISTS ${this.quoteIdentifier(username)}`);
      }
      this.logger.warn('Dropped tenant database', { databaseName, username });
    } finally {
      await admin.end().catch(() => undefined);
    }
  }

  async databaseExists(databaseName: string): Promise<boolean> {
    const admin = await this.connectAdmin();
    try {
      const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
      return (res.rowCount ?? 0) > 0;
    } finally {
      await admin.end().catch(() => undefined);
    }
  }

  /** Opens an admin connection to a specific tenant database (migrations, health). */
  async connect(databaseName: string): Promise<PgClient> {
    const client = new PgClient({
      host: this.config.tenantDb.host,
      port: this.config.tenantDb.port,
      user: this.config.tenantDb.adminUser,
      password: this.config.tenantDb.adminPassword,
      database: databaseName,
      ssl: this.config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
      application_name: 'retailos-provisioner',
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    return client;
  }

  private connectAdmin(): Promise<PgClient> {
    return this.connect(this.config.tenantDb.maintenanceDb);
  }

  // ------------------------------------------------------------ identifiers --

  /**
   * Reduces a slug to characters that are unambiguously safe in an identifier.
   * Hyphens become underscores because an unquoted hyphen would break the name
   * and a quoted one makes every hand-written psql query awkward.
   */
  private sanitiseIdentifierPart(slug: string): string {
    const cleaned = slug.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_');
    if (!/^[a-z][a-z0-9_]*$/.test(cleaned)) {
      throw new Error(`Cannot derive a safe database identifier from slug "${slug}"`);
    }
    return cleaned;
  }

  /** Double-quotes an identifier, escaping embedded quotes. */
  private quoteIdentifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Refusing to use unsafe SQL identifier: ${name}`);
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  /** Single-quotes a string literal, escaping embedded quotes and backslashes. */
  private quoteLiteral(value: string): string {
    const escaped = value.replace(/'/g, "''");
    return escaped.includes('\\') ? `E'${escaped.replace(/\\/g, '\\\\')}'` : `'${escaped}'`;
  }
}
