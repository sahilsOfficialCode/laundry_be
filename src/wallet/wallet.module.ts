import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from './schemas/wallet-transaction.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CouponsModule } from '../coupons/coupons.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    PaymentsModule,
    AuthModule,
    NotificationsModule,
    CouponsModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
