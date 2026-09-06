import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { OrdersModule } from '../orders/orders.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { PaymentEvent, PaymentEventSchema } from './schemas/payment-event.schema';
import { PaymentFinalizationService } from './payment-finalization.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';
import { ReconciliationService } from './reconciliation.service';
import { PaymentMetricsService } from './payment-metrics.service';
import { PaymentAlertsService } from './payment-alerts.service';
import { CouponsModule } from '../coupons/coupons.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
    ]),
    OrdersModule,
    AuthModule,
    NotificationsModule,
    CouponsModule,
    InvoicesModule,
    // Wallet top-ups are a second, independent thing a Razorpay payment can
    // be for — the webhook fallback and reconciliation sweep both need to
    // hand off to WalletService when a razorpayOrderId isn't an Order.
    // WalletModule imports PaymentsModule too (for PaymentsService), so this
    // edge needs forwardRef() on both sides.
    forwardRef(() => WalletModule),
  ],
  providers: [
    PaymentsService,
    PaymentFinalizationService,
    RazorpayWebhookService,
    ReconciliationService,
    PaymentMetricsService,
    PaymentAlertsService,
  ],
  controllers: [PaymentsController],
  exports: [PaymentsService, PaymentFinalizationService, PaymentMetricsService, PaymentAlertsService],
})
export class PaymentsModule {}
