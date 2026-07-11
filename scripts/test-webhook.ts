/**
 * Fires a synthetic, correctly-signed Razorpay webhook delivery at a running
 * instance of this backend (local or otherwise), without needing Razorpay to
 * actually reach it. Exercises the real code path: signature verification,
 * x-razorpay-event-id dedup, event-type routing, and payment finalization.
 *
 * CAUTION: whatever MONGO_URI your .env points at is what gets read/written.
 * If that's the same database production uses (check before running), only
 * point --order at a disposable test order you created yourself — never a
 * real customer's order. A non-existent --order is always safe (resolves
 * to outcome "order_not_found", which is itself a useful thing to verify).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/test-webhook.ts --order order_XXXXXXXXXXXX
 *
 * Options:
 *   --order <razorpayOrderId>   required
 *   --event <name>              payment.captured (default) | payment.failed | order.paid
 *   --amount <rupees>           default 500
 *   --payment <razorpayPaymentId>  default a generated pay_test_<timestamp>
 *   --event-id <id>             default a generated evt_test_<timestamp> — reuse the same
 *                                value across two runs to test duplicate-delivery dedup
 *   --url <baseUrl>             default http://localhost:3000
 *   --bad-signature             sends a deliberately wrong signature to verify rejection
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

function parseArgs(): Record<string, string> {
  const argv = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function post(rawUrl: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const url = new URL(rawUrl);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = parseArgs();
  const razorpayOrderId = args.order;
  if (!razorpayOrderId) {
    console.error('Missing --order <razorpayOrderId>, e.g. --order order_TBqhUY5PkNTh8m');
    process.exit(1);
  }

  const event = args.event ?? 'payment.captured';
  const amountPaise = Math.round(Number(args.amount ?? 500) * 100);
  const razorpayPaymentId = args.payment ?? `pay_test_${Date.now()}`;
  const baseUrl = args.url ?? 'http://localhost:3000';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret || webhookSecret.includes('REPLACE_WITH')) {
    console.error(
      'RAZORPAY_WEBHOOK_SECRET in .env is still the placeholder value.\n' +
        'Set it to any string for local testing (it just needs to match what the running server reads) — it does not need to be the real Razorpay dashboard secret unless you are testing against a deployment that already validates real deliveries.',
    );
    process.exit(1);
  }

  const payload = {
    entity: 'event',
    account_id: 'acc_test_local',
    event,
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: razorpayPaymentId,
          order_id: razorpayOrderId,
          amount: amountPaise,
          currency: 'INR',
          status: event === 'payment.failed' ? 'failed' : 'captured',
          email: 'test@example.com',
          contact: '+919999999999',
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  // The signature MUST be computed over these exact bytes — the server's
  // rawBody is the literal request body it received, not a re-parsed copy.
  const rawBody = JSON.stringify(payload);
  const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  const signature = args['bad-signature'] ? '0'.repeat(64) : validSignature;
  const eventId = args['event-id'] ?? `evt_test_${Date.now()}`;

  console.log(`POST ${baseUrl}/payments/webhook/razorpay`);
  console.log(`  event=${event}  razorpayOrderId=${razorpayOrderId}  razorpayPaymentId=${razorpayPaymentId}  amountPaise=${amountPaise}  eventId=${eventId}`);
  console.log(args['bad-signature'] ? '  Sending a deliberately INVALID signature — expect outcome "rejected_signature".\n' : '  Signature computed correctly.\n');

  const res = await post(`${baseUrl}/payments/webhook/razorpay`, rawBody, {
    'Content-Type': 'application/json',
    'x-razorpay-signature': signature,
    'x-razorpay-event-id': eventId,
  });

  console.log(`Response: ${res.status}`);
  console.log(res.body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
