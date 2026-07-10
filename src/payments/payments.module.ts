import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
    ]),
    OrdersModule,
    AuthModule,
    NotificationsModule,
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
  exports: [PaymentsService, PaymentFinalizationService],
})
export class PaymentsModule {}
