import { NotificationChannel, NotificationStatus } from './enums';

export const NotificationTemplate = {
  ORDER_PLACED: 'order.placed',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_OUT_FOR_DELIVERY: 'order.out_for_delivery',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_FAILED: 'payment.failed',
  LOW_STOCK_ALERT: 'inventory.low_stock',
  NEW_ORDER_MERCHANT: 'merchant.new_order',
  WELCOME_CUSTOMER: 'customer.welcome',
  TENANT_READY: 'tenant.ready',
  STAFF_INVITE: 'staff.invite',
} as const;
export type NotificationTemplate =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];

export interface Notification {
  id: string;
  channel: NotificationChannel;
  template: string;
  status: NotificationStatus;
  recipient: string;
  subject: string | null;
  body: string;
  /** Deep-link target, e.g. `/orders/KZ-2026-000123`. */
  actionUrl: string | null;
  readAt: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface SendNotificationRequest {
  channel: NotificationChannel;
  template: NotificationTemplate | string;
  recipient: string;
  data: Record<string, unknown>;
}

export interface RegisterPushTokenRequest {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
}

export interface NotificationPreferences {
  orderUpdates: { email: boolean; sms: boolean; push: boolean };
  promotions: { email: boolean; sms: boolean; push: boolean };
}
