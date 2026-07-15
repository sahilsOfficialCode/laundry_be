import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { CouponsService } from './services/coupons.service';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { ApplyToOrderDto } from './dto/apply-to-order.dto';
import { RemoveFromOrderDto } from './dto/remove-from-order.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CouponRateLimitGuard } from './guards/coupon-rate-limit.guard';

/**
 * Customer-facing coupon endpoints. JwtAuthGuard is already applied
 * globally (APP_GUARD in app.module.ts) so every route here requires a
 * logged-in user; only coupons assigned to that specific user can ever
 * validate or apply successfully — see CouponsService.validateForUser.
 */
@Controller('customer/coupon')
@UseGuards(CouponRateLimitGuard)
export class CouponsController {
  private readonly logger = new Logger(CouponsController.name);

  constructor(private readonly couponsService: CouponsService) {}

  /**
   * GET /customer/coupon/my-coupons — coupons currently assigned to and
   * usable by the logged-in user (active, within date window, allowance
   * remaining). Powers a "Your coupons" list in the app, separate from
   * validating one specific code.
   */
  @Get('my-coupons')
  @HttpCode(HttpStatus.OK)
  async myCoupons(@GetUser() user: any) {
    const coupons = await this.couponsService.listMyCoupons(user?.sub);
    return { coupons };
  }

  /**
   * POST /customer/coupon/validate — check a coupon without applying it
   * (used for the "Apply" button preview at checkout).
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(@GetUser() user: any, @Body() dto: ValidateCouponDto) {
    const preview = await this.couponsService.validateForUser(user?.sub, dto);
    return { valid: true, ...preview };
  }

  /**
   * POST /customer/coupon/apply — same validation as /validate; returns the
   * discount to apply at checkout. Does NOT mark the coupon as used — that
   * only happens once the order is actually paid for (see
   * PaymentFinalizationService / WalletService calling
   * CouponsService.finalizeRedemption after payment success).
   */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  async apply(@GetUser() user: any, @Body() dto: ValidateCouponDto) {
    this.logger.debug(`Apply coupon request: ${dto.couponCode}`);
    const preview = await this.couponsService.validateForUser(user?.sub, dto);
    return { applied: true, ...preview };
  }

  /**
   * POST /customer/coupon/apply-to-order — for the "pay for an already
   * created order" screen: attaches the coupon to that specific order and
   * persists the reduced payable amount, so whichever payment path runs
   * next (Razorpay or wallet) charges the discounted amount.
   */
  @Post('apply-to-order')
  @HttpCode(HttpStatus.OK)
  async applyToOrder(@GetUser() user: any, @Body() dto: ApplyToOrderDto) {
    const preview = await this.couponsService.applyToOrder(user?.sub, dto.orderId, dto.couponCode);
    return { applied: true, ...preview };
  }

  /** POST /customer/coupon/remove-from-order — undo apply-to-order before payment. */
  @Post('remove-from-order')
  @HttpCode(HttpStatus.OK)
  async removeFromOrder(@GetUser() user: any, @Body() dto: RemoveFromOrderDto) {
    return this.couponsService.removeFromOrder(user?.sub, dto.orderId);
  }
}
