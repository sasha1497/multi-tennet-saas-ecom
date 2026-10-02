'use client';

/**
 * Razorpay Standard Checkout, loaded on demand.
 *
 * The browser only ever receives what the server decided: the store's public
 * key (a key id, or the store's OAuth `public_token`) and the Razorpay order id
 * created on the store's own account. Nothing here chooses who is paid, and
 * nothing here decides a payment succeeded — the handler's result goes to
 * `/payments/verify`, where the signature is checked and the payment is read
 * back from Razorpay before an order is confirmed.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type CheckoutOutcome =
  | { kind: 'success'; response: RazorpaySuccess }
  | { kind: 'dismissed' }
  | { kind: 'failed'; reason: string };

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openRazorpayCheckout(options: {
  key: string;
  orderId: string;
  amount: number;
  currency: string;
  storeName: string;
  description: string;
  logoUrl?: string | null;
  themeColor?: string;
  prefill: { name?: string; email?: string | null; contact?: string | null };
}): Promise<CheckoutOutcome> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) return { kind: 'failed', reason: 'The payment window is unavailable right now.' };

  return new Promise<CheckoutOutcome>((resolve) => {
    let settled = false;
    // A decline is not the end: Razorpay offers a retry inside the same
    // window, on the same order. Remember it, and decide only when the
    // shopper either pays or closes the window.
    let lastFailure: string | null = null;
    const finish = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const instance = new Razorpay({
      key: options.key,
      order_id: options.orderId,
      amount: options.amount,
      currency: options.currency,
      name: options.storeName,
      description: options.description,
      image: options.logoUrl ?? undefined,
      prefill: {
        name: options.prefill.name,
        email: options.prefill.email ?? undefined,
        contact: options.prefill.contact ?? undefined,
      },
      theme: options.themeColor ? { color: options.themeColor } : undefined,
      handler: (response: RazorpaySuccess) => finish({ kind: 'success', response }),
      modal: {
        // Closing the window is not a failure: the order stays pending and a
        // payment completed in the meantime still reconciles by webhook.
        ondismiss: () =>
          finish(lastFailure ? { kind: 'failed', reason: lastFailure } : { kind: 'dismissed' }),
      },
    });

    instance.on('payment.failed', (response) => {
      lastFailure = response.error?.description ?? 'The payment did not go through.';
    });
    instance.open();
  });
}
