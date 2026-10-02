import { createServer, type IncomingMessage, type Server } from 'node:http';

/**
 * A local stand-in for the parts of Razorpay retailos calls, answering in the
 * documented shapes:
 *
 *   POST /token   (authorization_code | refresh_token)  → access_token, refresh_token,
 *                                                         public_token, razorpay_account_id, expires_in
 *   POST /revoke
 *   POST /v1/orders                     (Bearer)        → { id, status }
 *   GET  /v1/payments/:id               (Bearer)        → { id, status, order_id, amount, currency }
 *   POST /v1/payments/:id/refund        (Bearer)        → { id, amount, status }
 *
 * It records *which account's token* each call was made with. That is the
 * point of the suite: proving a customer's order is created on the store's
 * own Razorpay account — which is what decides who is paid — without
 * pretending to be Razorpay's settlement.
 */
export class RazorpayStub {
  private server: Server | null = null;
  /** code → account it authorises. */
  readonly codes = new Map<string, string>();
  readonly orders = new Map<string, { accountId: string; amount: number; currency: string }>();
  readonly payments = new Map<string, { status: string; orderId: string; amount: number; currency: string; accountId: string }>();
  readonly refunds: { id: string; paymentId: string; amount: number; accountId: string; idempotencyKey: string | null }[] = [];
  readonly revoked: string[] = [];
  /** What the next refund call answers with. */
  refundStatus: 'processed' | 'pending' = 'processed';
  private seq = 0;

  async start(port = 47990): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** The tokens the stub issues are readable on purpose, so tests can assert routing. */
  static accessToken(accountId: string): string {
    return `at_${accountId}`;
  }
  static publicToken(accountId: string): string {
    return `rzp_test_oauth_${accountId}`;
  }

  /** Simulates a shopper completing Checkout on a stub order. */
  pay(orderId: string, status = 'captured', overrides: Partial<{ amount: number }> = {}): string {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`stub: unknown order ${orderId}`);
    const id = `pay_${++this.seq}${Date.now().toString(36)}`;
    this.payments.set(id, {
      status,
      orderId,
      amount: overrides.amount ?? order.amount,
      currency: order.currency,
      accountId: order.accountId,
    });
    return id;
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse) {
    const body = await readJson(req);
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const url = new URL(req.url ?? '/', 'http://stub');
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const account = bearer.startsWith('at_') ? bearer.slice(3) : null;

    if (req.method === 'POST' && url.pathname === '/token') {
      if (body.client_id !== 'test_oauth_client' || body.client_secret !== 'test_oauth_client_secret') {
        return send(401, { error: 'invalid_client' });
      }
      let accountId: string | undefined;
      if (body.grant_type === 'authorization_code') accountId = this.codes.get(String(body.code));
      if (body.grant_type === 'refresh_token') accountId = String(body.refresh_token).replace(/^rt_/, '');
      if (!accountId) return send(400, { error: 'invalid_grant' });
      return send(200, {
        token_type: 'Bearer',
        expires_in: 7776000,
        access_token: RazorpayStub.accessToken(accountId),
        refresh_token: `rt_${accountId}`,
        public_token: RazorpayStub.publicToken(accountId),
        razorpay_account_id: accountId,
      });
    }

    if (req.method === 'POST' && url.pathname === '/revoke') {
      this.revoked.push(String(body.token));
      return send(200, { message: 'Token Revoked' });
    }

    if (!account) return send(401, { error: { description: 'auth required' } });

    if (req.method === 'POST' && url.pathname === '/v1/orders') {
      const id = `order_${++this.seq}${Date.now().toString(36)}`;
      this.orders.set(id, { accountId: account, amount: Number(body.amount), currency: String(body.currency) });
      return send(200, { id, status: 'created', amount: body.amount, currency: body.currency });
    }

    const paymentMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)(\/refund)?$/);
    if (paymentMatch) {
      const payment = this.payments.get(paymentMatch[1]!);
      // A payment on another account does not exist as far as this token knows.
      if (!payment || payment.accountId !== account) return send(400, { error: { description: 'not found' } });
      if (req.method === 'GET' && !paymentMatch[2]) {
        return send(200, {
          id: paymentMatch[1],
          status: payment.status,
          order_id: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
        });
      }
      if (req.method === 'POST' && paymentMatch[2]) {
        const idem = (req.headers['x-payment-idempotency-key'] as string | undefined) ?? null;
        const existing = idem ? this.refunds.find((r) => r.idempotencyKey === idem) : undefined;
        const refund = existing ?? {
          id: `rfnd_${++this.seq}${Date.now().toString(36)}`,
          paymentId: paymentMatch[1]!,
          amount: Number(body.amount),
          accountId: account,
          idempotencyKey: idem,
        };
        if (!existing) this.refunds.push(refund);
        return send(200, { id: refund.id, amount: refund.amount, status: this.refundStatus });
      }
    }

    return send(404, { error: 'stub: not implemented' });
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
