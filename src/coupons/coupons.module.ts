import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './services/coupons.service';
import { CouponsRepository } from './repositories/coupons.repository';
import { CouponRateLimitGuard } from './guards/coupon-rate-limit.guard';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import { CouponUsage, CouponUsageSchema } from './schemas/coupon-usage.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Coupon.name, schema: CouponSchema },
      { name: CouponUsage.name, schema: CouponUsageSchema },
    ]),
  ],
  controllers: [CouponsController],
  providers: [
    CouponsService,
    CouponsRepository,
    CouponRateLimitGuard,
  ],
  exports: [CouponsService, CouponRateLimitGuard],
})
export class CouponsModule {}
