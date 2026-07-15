import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CouponsController } from './coupons.controller';
import { AdminCouponsController } from './admin-coupons.controller';
import { CouponsService } from './services/coupons.service';
import { CouponsAdminService } from './services/coupons-admin.service';
import { CouponConditionsService } from './services/coupon-conditions.service';
import { CouponsRepository } from './repositories/coupons.repository';
import { CouponAssignmentsRepository } from './repositories/coupon-assignments.repository';
import { CouponRedemptionsRepository } from './repositories/coupon-redemptions.repository';
import { CouponAuditLogRepository } from './repositories/coupon-audit-log.repository';
import { CouponRateLimitGuard } from './guards/coupon-rate-limit.guard';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import { CouponAssignment, CouponAssignmentSchema } from './schemas/coupon-assignment.schema';
import { CouponRedemption, CouponRedemptionSchema } from './schemas/coupon-redemption.schema';
import { CouponAuditLog, CouponAuditLogSchema } from './schemas/coupon-audit-log.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Coupon.name, schema: CouponSchema },
      { name: CouponAssignment.name, schema: CouponAssignmentSchema },
      { name: CouponRedemption.name, schema: CouponRedemptionSchema },
      { name: CouponAuditLog.name, schema: CouponAuditLogSchema },
      // Registered here (not imported via UsersModule/OrdersModule) purely for
      // read-only queries — bulk-assignment condition matching and the
      // assigned-users admin table both need to look up user records, and
      // Mongoose allows the same schema to be registered in multiple modules.
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    // JwtAuthGuard (used on AdminCouponsController) needs AuthService/TokenBlacklistService.
    AuthModule,
  ],
  controllers: [CouponsController, AdminCouponsController],
  providers: [
    CouponsService,
    CouponsAdminService,
    CouponConditionsService,
    CouponsRepository,
    CouponAssignmentsRepository,
    CouponRedemptionsRepository,
    CouponAuditLogRepository,
    CouponRateLimitGuard,
  ],
  exports: [CouponsService, CouponRateLimitGuard],
})
export class CouponsModule {}
