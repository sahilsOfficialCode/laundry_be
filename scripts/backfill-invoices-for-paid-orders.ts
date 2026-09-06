/**
 * One-off backfill: generates an Invoice document for every existing order
 * that's already been paid (paymentStatus COMPLETED) but predates the
 * invoicing system introduced in this change, so the "Download Invoice"
 * button appears for them too.
 *
 * These orders have no OrderPricingSnapshot history, so InvoicesService
 * falls back to a single "Items Subtotal" line item derived from the order's
 * current billAmount/totalAmount — there's no itemized tax/fee breakdown to
 * reconstruct for orders billed before the pricing engine existed.
 *
 * Safe to re-run: InvoicesService.generateForOrder() is idempotent (skips
 * orders that already have an invoice), so nothing is duplicated.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/backfill-invoices-for-paid-orders.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { Order, OrderDocument, PaymentStatus } from '../src/orders/schemas/order.schema';
import { InvoicesService } from '../src/invoices/invoices.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const orderModel = app.get<Model<OrderDocument>>(getModelToken(Order.name));
    const invoicesService = app.get(InvoicesService);

    const paidOrders = await orderModel.find({ paymentStatus: PaymentStatus.COMPLETED });
    console.log(`Found ${paidOrders.length} paid order(s).`);

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of paidOrders) {
      try {
        const existing = await invoicesService.getByOrderId(String(order._id));
        if (existing) {
          skipped++;
          continue;
        }
        const invoice = await invoicesService.generateForOrder(order);
        console.log(`Generated ${invoice.invoiceNumber} for order ${order.orderNumber ?? order._id}`);
        created++;
      } catch (err) {
        failed++;
        console.error(`Failed to generate invoice for order ${order._id}: ${(err as Error).message}`);
      }
    }

    console.log(`Done. Created: ${created}, already existed: ${skipped}, failed: ${failed}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
