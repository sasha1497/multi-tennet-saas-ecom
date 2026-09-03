import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { storefrontUrl } from '@retailos/config';
import type { Notification, NotificationChannel } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { RequestContextService } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { renderTemplate, type TemplateData } from './notification-templates';

export interface DeliverParams {
  tenantId: string;
  template: string;
  channels: NotificationChannel[];
  email?: string | null;
  phone?: string | null;
  customerId?: string | null;
  data: TemplateData;
}

/**
 * Notification delivery.
 *
 * Called from the **worker**, never inline in a request: sending mail to a slow
 * SMTP server is exactly the kind of work requirement §13 says must not block an
 * API response.
 *
 * Each channel has a `log` driver so the whole flow — templating, persistence,
 * the in-app inbox — is exercisable locally with no third-party credentials.
 * Delivery failures are recorded on the notification row and never bubble up
 * into the business operation that triggered them.
 */
@Injectable()
export class NotificationsService {
  private readonly logger: AppLogger;
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Notifications');
  }

  /** Renders a template and fans it out across the requested channels. */
  async deliver(params: DeliverParams): Promise<void> {
    const store = await this.storeContext(params.tenantId);
    const rendered = renderTemplate(params.template, params.data, store);

    await Promise.all(
      params.channels.map(async (channel) => {
        try {
          switch (channel) {
            case 'EMAIL':
              if (!params.email) return;
              await this.sendEmail(params.email, rendered.subject, rendered.html, rendered.text);
              await this.record(params, channel, 'SENT', rendered.subject, rendered.html, rendered.actionUrl);
              break;

            case 'SMS':
              if (!params.phone) return;
              await this.sendSms(params.phone, rendered.short);
              await this.record(params, channel, 'SENT', null, rendered.short, rendered.actionUrl);
              break;

            case 'PUSH':
              if (!params.customerId) return;
              await this.sendPush(params.tenantId, params.customerId, rendered.subject, rendered.short, rendered.actionUrl);
              await this.record(params, channel, 'SENT', rendered.subject, rendered.short, rendered.actionUrl);
              break;

            case 'IN_APP':
              await this.record(params, channel, 'SENT', rendered.subject, rendered.short, rendered.actionUrl);
              break;
          }
        } catch (err) {
          this.logger.error('Notification delivery failed', err as Error, {
            channel,
            template: params.template,
            tenantId: params.tenantId,
          });
          await this.record(
            params,
            channel,
            'FAILED',
            rendered.subject,
            rendered.short,
            rendered.actionUrl,
            (err as Error).message,
          );
        }
      }),
    );
  }

  // ============================================================ channels ==

  private async sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
    if (this.config.notifications.mail.driver === 'log') {
      this.logger.info('[mail:log] Email would be sent', { to, subject });
      return;
    }

    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: this.config.notifications.mail.from,
      to,
      subject,
      html,
      text,
    });
    this.logger.debug('Email sent', { to, subject });
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const mail = this.config.notifications.mail;
    this.transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
      // Mailpit in dev speaks plain SMTP on 1025.
      ignoreTLS: !mail.secure,
    });
    return this.transporter;
  }

  private async sendSms(to: string, message: string): Promise<void> {
    if (this.config.notifications.sms.driver === 'log') {
      this.logger.info('[sms:log] SMS would be sent', { to, message: message.slice(0, 160) });
      return;
    }
    // A real provider (MSG91, Twilio) plugs in here behind the same signature.
    this.logger.warn('SMS driver is configured but not implemented in this build', {
      driver: this.config.notifications.sms.driver,
    });
  }

  private async sendPush(
    tenantId: string,
    customerId: string,
    title: string,
    body: string,
    actionUrl: string | null,
  ): Promise<void> {
    const tokens = await this.tenantDb.runFor(tenantId, (db) =>
      db.pushToken.findMany({
        where: { customerId, isActive: true },
        select: { token: true, platform: true },
      }),
    );
    if (tokens.length === 0) return;

    if (this.config.notifications.push.driver === 'log') {
      this.logger.info('[push:log] Push would be sent', {
        customerId,
        devices: tokens.length,
        title,
      });
      return;
    }
    this.logger.warn('Push driver is configured but not implemented in this build', {
      driver: this.config.notifications.push.driver,
      actionUrl,
      body: body.slice(0, 60),
    });
  }

  // ========================================================== persistence ==

  private async record(
    params: DeliverParams,
    channel: NotificationChannel,
    status: 'SENT' | 'FAILED' | 'QUEUED',
    subject: string | null,
    body: string,
    actionUrl: string | null,
    error?: string,
  ): Promise<void> {
    const recipient = params.email ?? params.phone ?? params.customerId ?? 'unknown';
    await this.tenantDb
      .runFor(params.tenantId, (db) =>
        db.notification.create({
          data: {
            customerId: params.customerId ?? null,
            channel,
            template: params.template,
            status,
            recipient: recipient.slice(0, 255),
            subject: subject?.slice(0, 200) ?? null,
            body: body.slice(0, 5000),
            actionUrl: actionUrl?.slice(0, 500) ?? null,
            metadata: (params.data ?? null) as never,
            sentAt: status === 'SENT' ? new Date() : null,
            error: error?.slice(0, 1000) ?? null,
          },
        }),
      )
      .catch((err) =>
        this.logger.warn('Failed to persist notification record', {
          error: (err as Error).message,
        }),
      );
  }

  // ======================================================= customer inbox ==

  async listForCustomer(limit = 30): Promise<Notification[]> {
    const auth = this.context.auth;
    if (!auth || auth.audience !== 'customer') throw Errors.unauthenticated();

    const rows = await this.tenantDb.run((db) =>
      db.notification.findMany({
        where: { customerId: auth.userId, channel: { in: ['IN_APP', 'PUSH'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      template: row.template,
      status: row.status,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      actionUrl: row.actionUrl,
      readAt: row.readAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async markRead(id: string): Promise<void> {
    const auth = this.context.auth;
    if (!auth || auth.audience !== 'customer') throw Errors.unauthenticated();

    // Scoped by customer id, so one shopper cannot mark another's notification.
    await this.tenantDb.run((db) =>
      db.notification.updateMany({
        where: { id, customerId: auth.userId },
        data: { readAt: new Date(), status: 'READ' },
      }),
    );
  }

  async registerPushToken(
    token: string,
    platform: 'ios' | 'android' | 'web',
    deviceId?: string,
  ): Promise<void> {
    const auth = this.context.auth;
    if (!auth || auth.audience !== 'customer') throw Errors.unauthenticated();

    await this.tenantDb.run((db) =>
      db.pushToken.upsert({
        where: { token },
        create: { customerId: auth.userId, token, platform, deviceId: deviceId ?? null },
        // A device can change hands; re-point the token at whoever holds it now.
        update: { customerId: auth.userId, platform, isActive: true, deviceId: deviceId ?? null },
      }),
    );
  }

  /** Store name + storefront URL used in every template header and footer. */
  private async storeContext(
    tenantId: string,
  ): Promise<{ storeName: string; storefrontUrl: string; currency: string }> {
    const [tenant, settings] = await Promise.all([
      this.master.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, name: true } }),
      this.tenantDb
        .runFor(tenantId, (db) =>
          db.storeSettings.findUnique({
            where: { id: 'singleton' },
            select: { storeName: true, currency: true },
          }),
        )
        .catch(() => null),
    ]);

    return {
      storeName: settings?.storeName ?? tenant?.name ?? 'Your store',
      storefrontUrl: tenant ? storefrontUrl(tenant.slug, this.config.domain) : '',
      currency: settings?.currency ?? 'INR',
    };
  }
}
