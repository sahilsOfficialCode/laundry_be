import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferralController } from './referral.controller';
import { AdminReferralController } from './admin-referral.controller';

import { ReferralService } from './services/referral.service';
import { ReferralSettingsService } from './services/referral-settings.service';
import { ReferralRewardService } from './services/referral-reward.service';
import { FraudDetectionService } from './services/fraud-detection.service';
import { ReferralAnalyticsService } from './services/referral-analytics.service';
import { ReferralRepository } from './repositories/referral.repository';

import { Referral, ReferralSchema } from './schemas/referral.schema';
import {
  ReferralReward,
  ReferralRewardSchema,
} from './schemas/referral-reward.schema';
import {
  ReferralSettings,
  ReferralSettingsSchema,
} from './schemas/referral-settings.schema';
import { ReferralLog, ReferralLogSchema } from './schemas/referral-log.schema';
import { FraudLog, FraudLogSchema } from './schemas/fraud-log.schema';
import {
  ReferralRateLimit,
  ReferralRateLimitSchema,
} from './schemas/referral-rate-limit.schema';
import { ReferralThrottleGuard } from './guards/referral-throttle.guard';

import { User, UserSchema } from '../users/schemas/user.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from '../wallet/schemas/wallet-transaction.schema';

import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Refer & Earn module.
 *
 * Exports ReferralService + ReferralRewardService so other modules
 * (UsersModule for code generation, OrdersModule for the reward milestone hook)
 * can call into the referral domain without circular coupling.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Referral.name, schema: ReferralSchema },
      { name: ReferralReward.name, schema: ReferralRewardSchema },
      { name: ReferralSettings.name, schema: ReferralSettingsSchema },
      { name: ReferralLog.name, schema: ReferralLogSchema },
      { name: FraudLog.name, schema: FraudLogSchema },
      { name: ReferralRateLimit.name, schema: ReferralRateLimitSchema },
      { name: User.name, schema: UserSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
    ]),
    AuthModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [ReferralController, AdminReferralController],
  providers: [
    ReferralRepository,
    ReferralService,
    ReferralSettingsService,
    ReferralRewardService,
    FraudDetectionService,
    ReferralAnalyticsService,
    ReferralThrottleGuard,
  ],
  exports: [ReferralService, ReferralRewardService],
})
export class ReferralModule {}
