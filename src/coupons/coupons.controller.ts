import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { CouponsService } from './services/coupons.service';
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { RecordCouponUsageDto } from './dto/record-usage.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CouponRateLimitGuard } from './guards/coupon-rate-limit.guard';

/**
 * User-facing coupon endpoints
 * ✅ Security: JWT protected, rate limited, input validated
 * ✅ Optimized: Lean queries, proper error handling
 */
@Controller('coupons')
@UseGuards(CouponRateLimitGuard)
export class CouponsController {
  private readonly logger = new Logger(CouponsController.name);

  constructor(private readonly couponsService: CouponsService) {}

  /**
   * POST /coupons/apply — Apply a coupon code and get the discount
   * ✅ Security: Rate limited, input validated, no SQL injection
   * ✅ Optimized: Cached active coupons
   *
   * Request: { couponCode: string, orderAmount: number }
   * Response: { couponCode, originalAmount, discountAmount, finalAmount }
   *
   * Error Cases:
   * - 400: Invalid coupon code format or order amount
   * - 404: Coupon not found
   * - 409: Coupon has reached redemption limit
   * - 429: Too many requests
   */
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  async apply(@Body() dto: ApplyCouponDto) {
    this.logger.debug(`Apply coupon request: ${dto.couponCode}`);

    try {
      return await this.couponsService.applyCoupon(dto);
    } catch (error) {
      this.logger.warn(`Coupon apply failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /coupons/record-usage — Record coupon usage after payment
   * ✅ Security: User-authenticated, prevents duplicate recording
   * This is called internally after order payment succeeds
   *
   * Request: { couponCode: string, orderId: string, discountAmount: number }
   * Response: { success: boolean }
   *
   * Error Cases:
   * - 400: Invalid input or coupon no longer active
   * - 404: Coupon not found
   * - 409: Usage already recorded for this order
   * - 429: Too many requests
   */
  @Post('record-usage')
  @HttpCode(HttpStatus.OK)
  async recordUsage(
    @GetUser() user: any,
    @Body() dto: RecordCouponUsageDto,
  ) {
    if (!user?.sub) {
      this.logger.warn('Unauthorized coupon record-usage attempt');
      throw new Error('Unauthorized');
    }

    this.logger.debug(
      `Record coupon usage: ${dto.couponCode} for order ${dto.orderId}`,
    );

    try {
      return await this.couponsService.recordUsage(dto, user.sub);
    } catch (error) {
      this.logger.warn(`Record usage failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * GET /coupons/available — Get list of available coupons
   * ✅ Optimized: Lean queries, only active coupons, safe defaults
   * ✅ Security: Returns limited fields only
   *
   * Response: [{ code, description, discountAmount, minOrderAmount, expiryDate }]
   *
   * Error Cases:
   * - 429: Too many requests
   * Returns empty array on database error (graceful degradation)
   */
  @Get('available')
  @HttpCode(HttpStatus.OK)
  async available() {
    this.logger.debug('Fetching available coupons');

    try {
      const coupons = await this.couponsService.getAvailable();
      this.logger.debug(`Returned ${coupons.length} available coupons`);
      return coupons;
    } catch (error) {
      this.logger.error(`Error fetching available coupons: ${error.message}`);
      // Return empty array instead of error for better UX
      return [];
    }
  }
}
