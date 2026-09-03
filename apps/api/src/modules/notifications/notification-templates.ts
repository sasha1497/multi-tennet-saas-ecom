import { formatMoney } from '@retailos/config';
import { NotificationTemplate } from '@retailos/types';

export interface RenderedNotification {
  subject: string;
  html: string;
  text: string;
  /** Short form for SMS/push, which have hard length limits. */
  short: string;
  actionUrl: string | null;
}

export type TemplateData = Record<string, unknown>;

/**
 * Notification content.
 *
 * Kept as plain functions rather than a templating engine: there are a dozen
 * messages, they need no logic beyond interpolation, and this way the whole
 * catalogue is greppable and unit-testable without a filesystem.
 *
 * Every value is HTML-escaped — a product name is merchant-supplied text, and it
 * ends up in an email a customer opens.
 */
export function renderTemplate(
  template: string,
  data: TemplateData,
  store: { storeName: string; storefrontUrl: string; currency: string },
): RenderedNotification {
  const s = (key: string, fallback = ''): string => escapeHtml(String(data[key] ?? fallback));
  const money = (key: string): string => formatMoney(Number(data[key] ?? 0), store.currency);
  const orderUrl = data.orderNumber
    ? `${store.storefrontUrl}/account/orders/${encodeURIComponent(String(data.orderNumber))}`
    : store.storefrontUrl;

  switch (template) {
    case NotificationTemplate.ORDER_PLACED:
      return build({
        subject: `Order ${s('orderNumber')} confirmed — ${escapeHtml(store.storeName)}`,
        heading: 'Thanks for your order!',
        body: `
          <p>Hi ${s('customerName', 'there')},</p>
          <p>We've received your order <strong>${s('orderNumber')}</strong> and it is being prepared.</p>
          <p><strong>Order total:</strong> ${money('total')}<br/>
             <strong>Payment:</strong> ${s('paymentMethod')}</p>`,
        cta: { label: 'Track your order', url: orderUrl },
        short: `${store.storeName}: Order ${String(data.orderNumber)} confirmed. Total ${money('total')}.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.ORDER_CONFIRMED:
      return build({
        subject: `Order ${s('orderNumber')} is confirmed`,
        heading: 'Your order is confirmed',
        body: `<p>Good news — payment for <strong>${s('orderNumber')}</strong> has been received and your order is on its way to being packed.</p>`,
        cta: { label: 'View order', url: orderUrl },
        short: `${store.storeName}: Payment received for order ${String(data.orderNumber)}.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.ORDER_SHIPPED:
      return build({
        subject: `Order ${s('orderNumber')} has shipped`,
        heading: 'Your order is on the way',
        body: `<p>Order <strong>${s('orderNumber')}</strong> has left the store and is heading to you.</p>`,
        cta: { label: 'Track your order', url: orderUrl },
        short: `${store.storeName}: Order ${String(data.orderNumber)} has shipped.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.ORDER_OUT_FOR_DELIVERY:
      return build({
        subject: `Order ${s('orderNumber')} is out for delivery`,
        heading: 'Arriving today',
        body: `<p>Your order <strong>${s('orderNumber')}</strong> is out for delivery and should reach you today.</p>`,
        cta: { label: 'Track your order', url: orderUrl },
        short: `${store.storeName}: Order ${String(data.orderNumber)} is out for delivery today.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.ORDER_DELIVERED:
      return build({
        subject: `Order ${s('orderNumber')} delivered`,
        heading: 'Delivered — enjoy!',
        body: `
          <p>Your order <strong>${s('orderNumber')}</strong> has been delivered.</p>
          <p>If anything is not right, reply to this email and the store will help.</p>`,
        cta: { label: 'Rate your purchase', url: orderUrl },
        short: `${store.storeName}: Order ${String(data.orderNumber)} delivered.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.ORDER_CANCELLED:
      return build({
        subject: `Order ${s('orderNumber')} cancelled`,
        heading: 'Your order was cancelled',
        body: `
          <p>Order <strong>${s('orderNumber')}</strong> has been cancelled.</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${s('reason')}</p>` : ''}
          <p>Any amount paid will be refunded to the original payment method.</p>`,
        cta: { label: 'Continue shopping', url: store.storefrontUrl },
        short: `${store.storeName}: Order ${String(data.orderNumber)} was cancelled.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.PAYMENT_RECEIVED:
      return build({
        subject: `Payment received for ${s('orderNumber')}`,
        heading: 'Payment received',
        body: `<p>We've received ${money('amount')} for order <strong>${s('orderNumber')}</strong>. Thank you!</p>`,
        cta: { label: 'View order', url: orderUrl },
        short: `${store.storeName}: Payment of ${money('amount')} received.`,
        store,
        actionUrl: orderUrl,
      });

    case NotificationTemplate.PAYMENT_FAILED:
      return build({
        subject: `Payment failed for ${s('orderNumber')}`,
        heading: 'We could not process your payment',
        body: `
          <p>The payment for order <strong>${s('orderNumber')}</strong> did not go through${data.reason ? `: ${s('reason')}` : ''}.</p>
          <p>Your items have been released back to stock. You are welcome to try again.</p>`,
        cta: { label: 'Try again', url: `${store.storefrontUrl}/cart` },
        short: `${store.storeName}: Payment failed for order ${String(data.orderNumber)}.`,
        store,
        actionUrl: `${store.storefrontUrl}/cart`,
      });

    case NotificationTemplate.NEW_ORDER_MERCHANT:
      return build({
        subject: `New order ${s('orderNumber')} — ${money('total')}`,
        heading: 'You have a new order',
        body: `
          <p><strong>${s('orderNumber')}</strong> from ${s('customerName')}</p>
          <p><strong>Total:</strong> ${money('total')}<br/>
             <strong>Items:</strong> ${s('itemCount')}<br/>
             <strong>Payment:</strong> ${s('paymentMethod')}</p>`,
        cta: { label: 'Open in dashboard', url: String(data.consoleUrl ?? store.storefrontUrl) },
        short: `New order ${String(data.orderNumber)} — ${money('total')}`,
        store,
        actionUrl: String(data.consoleUrl ?? ''),
      });

    case NotificationTemplate.LOW_STOCK_ALERT:
      return build({
        subject: `Low stock alert — ${s('itemCount')} item(s)`,
        heading: 'Some items are running low',
        body: `
          <p>The following items are at or below their low-stock threshold:</p>
          <ul>${(data.items as { name: string; sku: string; available: number }[] | undefined ?? [])
            .map(
              (i) =>
                `<li>${escapeHtml(i.name)} (${escapeHtml(i.sku)}) — ${i.available} left</li>`,
            )
            .join('')}</ul>`,
        cta: { label: 'Manage inventory', url: String(data.consoleUrl ?? '') },
        short: `${data.itemCount} item(s) low on stock at ${store.storeName}.`,
        store,
        actionUrl: String(data.consoleUrl ?? ''),
      });

    case NotificationTemplate.WELCOME_CUSTOMER:
      return build({
        subject: `Welcome to ${escapeHtml(store.storeName)}`,
        heading: `Welcome, ${s('firstName', 'there')}!`,
        body: `<p>Thanks for creating an account at ${escapeHtml(store.storeName)}. Your orders, addresses and wishlist now live in one place.</p>`,
        cta: { label: 'Start shopping', url: store.storefrontUrl },
        short: `Welcome to ${store.storeName}!`,
        store,
        actionUrl: store.storefrontUrl,
      });

    case NotificationTemplate.TENANT_READY:
      return build({
        subject: 'Your store is ready',
        heading: 'Your store is live',
        body: `
          <p>Hi ${s('firstName', 'there')}, your store <strong>${escapeHtml(store.storeName)}</strong> is set up and ready.</p>
          <p>Your storefront address is <a href="${store.storefrontUrl}">${escapeHtml(store.storefrontUrl)}</a>.</p>
          <p>Add a few products and publish the store to start selling.</p>`,
        cta: { label: 'Open your dashboard', url: String(data.consoleUrl ?? store.storefrontUrl) },
        short: `Your store ${store.storeName} is ready.`,
        store,
        actionUrl: String(data.consoleUrl ?? store.storefrontUrl),
      });

    case NotificationTemplate.STAFF_INVITE:
      return build({
        subject: `You've been added to ${escapeHtml(store.storeName)}`,
        heading: 'You have been added to a store',
        body: `
          <p>Hi ${s('firstName', 'there')}, you now have <strong>${s('role')}</strong> access to ${escapeHtml(store.storeName)}.</p>
          ${
            data.temporaryPassword
              ? `<p>Sign in with this temporary password and change it straight away:<br/>
                 <code style="font-size:16px;letter-spacing:1px">${s('temporaryPassword')}</code></p>`
              : '<p>Sign in with your existing account password.</p>'
          }`,
        cta: { label: 'Sign in', url: String(data.consoleUrl ?? '') },
        short: `You've been added to ${store.storeName}.`,
        store,
        actionUrl: String(data.consoleUrl ?? ''),
      });

    default:
      return build({
        subject: `A message from ${escapeHtml(store.storeName)}`,
        heading: escapeHtml(store.storeName),
        body: `<p>${escapeHtml(String(data.message ?? ''))}</p>`,
        cta: null,
        short: String(data.message ?? ''),
        store,
        actionUrl: null,
      });
  }
}

function build(params: {
  subject: string;
  heading: string;
  body: string;
  cta: { label: string; url: string } | null;
  short: string;
  store: { storeName: string; storefrontUrl: string };
  actionUrl: string | null;
}): RenderedNotification {
  const html = layout(params.heading, params.body, params.cta, params.store);
  return {
    subject: params.subject,
    html,
    text: htmlToText(params.body),
    short: params.short.slice(0, 300),
    actionUrl: params.actionUrl,
  };
}

/**
 * Table-based email layout with inline styles.
 *
 * Not a stylistic choice: Gmail strips `<style>` blocks and Outlook ignores
 * flexbox, so this is what actually renders consistently in a real inbox.
 */
function layout(
  heading: string,
  body: string,
  cta: { label: string; url: string } | null,
  store: { storeName: string; storefrontUrl: string },
): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="padding:24px 28px 8px;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;">${escapeHtml(store.storeName)}</div>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;">${heading}</h1>
          <div style="font-size:14px;line-height:1.6;color:#334155;">${body}</div>
        </td></tr>
        ${
          cta
            ? `<tr><td style="padding:8px 28px 28px;">
                 <a href="${cta.url}" style="display:inline-block;background:#1f47e0;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:14px;font-weight:600;">${escapeHtml(cta.label)}</a>
               </td></tr>`
            : '<tr><td style="padding:0 28px 20px;"></td></tr>'
        }
        <tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #f1f5f9;font-size:12px;color:#64748b;">
          <div>${escapeHtml(store.storeName)} · <a href="${store.storefrontUrl}" style="color:#475569;">${escapeHtml(store.storefrontUrl)}</a></div>
          <div style="margin-top:6px;">Powered by RetailOS</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
