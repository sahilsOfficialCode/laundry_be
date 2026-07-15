import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { CouponsRepository } from '../repositories/coupons.repository';
import { CouponAssignmentsRepository } from '../repositories/coupon-assignments.repository';
import { CouponRedemptionsRepository } from '../repositories/coupon-redemptions.repository';
import { CouponAuditLogRepository } from '../repositories/coupon-audit-log.repository';
import { ValidateCouponDto } from '../dto/validate-coupon.dto';
import { CouponDiscountType, CouponStatus, CouponAuditAction } from '../enums/coupon.enums';
import { CouponDocument } from '../schemas/coupon.schema';
import { Order, OrderDocument, PaymentStatus, OrderStatus } from '../../orders/schemas/order.schema';

export interface CouponPreview {
  couponId: string;
  couponCode: string;
  couponName: string;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/**
 * Customer-facing coupon flows: validate / apply (preview only — never
 * mutates usage counts) and finalizeRedemption (the only place usage counts
 * and redemption rows are written, called once an order is actually paid).
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);
  private readonly MAX_ORDER_AMOUNT = 9_999_999;

  constructor(
    private readonly coupons: CouponsRepository,
    private readonly assignments: CouponAssignmentsRepository,
    private readonly redemptions: CouponRedemptionsRepository,
    private readonly auditLog: CouponAuditLogRepository,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  /**
   * Coupons currently usable by this user — active assignment, coupon still
   * active/within its date window, and the user hasn't exhausted their
   * per-user allowance. Powers the customer app's coupon list (distinct
   * from /validate|/apply, which check one specific code).
   */
  async listMyCoupons(userId: string) {
    if (!userId) return [];

    const activeAssignments = await this.assignments.model
      .find({ userId, status: 'active' })
      .select('couponId usedCount')
      .lean();
    if (activeAssignments.length === 0) return [];

    const usedCountByCoupon = new Map(
      activeAssignments.map((a) => [a.couponId.toString(), a.usedCount ?? 0]),
    );
    const couponIds = activeAssignments.map((a) => a.couponId);

    const now = new Date();
    const validCoupons = await this.coupons.model
      .find({
        _id: { $in: couponIds },
        isDeleted: false,
        status: CouponStatus.ACTIVE,
        startDate: { $lte: now },
        expiryDate: { $gte: now },
      })
      .lean();

    return validCoupons
      .map((c) => ({
        couponId: c._id.toString(),
        couponCode: c.couponCode,
        couponName: c.couponName,
        description: c.description ?? '',
        discountType: c.discountType,
        discountValue: c.discountValue,
        maximumDiscount: c.maximumDiscount ?? null,
        minimumOrderAmount: c.minimumOrderAmount,
        expiryDate: c.expiryDate,
        remainingUses: Math.max(0, c.usagePerUser - (usedCountByCoupon.get(c._id.toString()) ?? 0)),
      }))
      .filter((c) => c.remainingUses > 0);
  }

  /**
   * Full server-side validation + discount computation for a coupon against
   * a given user + order amount. Used by both /validate and /apply, and
   * internally by checkout(). Never mutates any counters.
   */
  async validateForUser(userId: string, dto: ValidateCouponDto): Promise<CouponPreview> {
    if (!userId) throw new ForbiddenException('You must be logged in to use a coupon');

    const sanitizedCode = this.sanitizeCode(dto.couponCode);
    const orderAmount = this.sanitizeAmount(dto.orderAmount);

    const coupon = await this.coupons.findByCode(sanitizedCode);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    this.assertWithinWindowAndActive(coupon);

    const assignment = await this.assignments.findActive(coupon._id.toString(), userId);
    if (!assignment) {
      throw new ForbiddenException('This coupon is not available for your account.');
    }

    if (assignment.usedCount >= coupon.usagePerUser) {
      throw new ConflictException('Coupon already redeemed.');
    }

    if (coupon.totalUsageLimit != null && coupon.usedCount >= coupon.totalUsageLimit) {
      throw new ConflictException('This coupon has reached its overall redemption limit');
    }

    if (orderAmount < coupon.minimumOrderAmount) {
      throw new BadRequestException(
        `Minimum order amount is ₹${coupon.minimumOrderAmount} for this coupon`,
      );
    }

    const discountAmount = this.computeDiscount(coupon, orderAmount);
    const finalAmount = Math.max(0, Number((orderAmount - discountAmount).toFixed(2)));

    return {
      couponId: coupon._id.toString(),
      couponCode: coupon.couponCode,
      couponName: coupon.couponName,
      originalAmount: orderAmount,
      discountAmount: Number(discountAmount.toFixed(2)),
      finalAmount,
    };
  }

  /**
   * Apply a coupon to an order that already exists but hasn't been paid yet
   * — the pattern this app's "pay for order" screen uses (order created
   * first, itemized/billed, then paid). Persists the discount onto the
   * order itself so whichever payment path runs next (Razorpay or wallet,
   * see payment-finalization.service.ts / wallet.service.ts) picks up the
   * already-reduced payable amount, and so finalizeRedemption() — which
   * only reads couponId/couponCode/couponDiscountAmount off the order —
   * needs no changes to support this flow.
   */
  async applyToOrder(userId: string, orderId: string, couponCode: string): Promise<CouponPreview> {
    const order = await this.orderModel.findById(orderId);
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException('This order has already been paid for');
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('This order has been cancelled');
    }
    if (order.couponCode) {
      throw new ConflictException('A coupon is already applied to this order — remove it first');
    }

    const payableAmount = order.billAmount ?? order.totalAmount;
    const preview = await this.validateForUser(userId, { couponCode, orderAmount: payableAmount });

    const amountField = order.billAmount != null ? 'billAmount' : 'totalAmount';
    await this.orderModel.updateOne(
      { _id: orderId },
      {
        $set: {
          couponCode: preview.couponCode,
          couponId: preview.couponId,
          couponDiscountAmount: preview.discountAmount,
          [amountField]: preview.finalAmount,
        },
      },
    );

    return preview;
  }

  /** Undo applyToOrder() — only allowed before the order is paid. */
  async removeFromOrder(userId: string, orderId: string): Promise<{ success: boolean }> {
    const order = await this.orderModel.findById(orderId);
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException('This order has already been paid for');
    }
    if (!order.couponCode) {
      return { success: true };
    }

    const discount = order.couponDiscountAmount ?? 0;
    const amountField = order.billAmount != null ? 'billAmount' : 'totalAmount';
    const restored = (order[amountField as 'billAmount' | 'totalAmount'] ?? 0) + discount;

    await this.orderModel.updateOne(
      { _id: orderId },
      {
        $set: { [amountField]: restored },
        $unset: { couponCode: '', couponId: '', couponDiscountAmount: '' },
      },
    );

    return { success: true };
  }

  /**
   * The ONLY place coupon usage is actually recorded. Called once an order
   * has been successfully paid for (Razorpay capture or wallet debit).
   * Idempotent: safe to call more than once for the same orderId — the
   * unique index on CouponRedemption.orderId plus the existence check below
   * guarantee at most one redemption per order.
   */
  async finalizeRedemption(params: {
    orderId: string;
    userId: string;
    couponId: string;
    couponCode: string;
    discountAmount: number;
  }): Promise<{ redeemed: boolean }> {
    const { orderId, userId, couponId, couponCode, discountAmount } = params;
    if (!couponId || !discountAmount) return { redeemed: false };

    const existing = await this.redemptions.findByOrder(orderId);
    if (existing) return { redeemed: false };

    const run = async (session?: any) => {
      const opts = session ? { session } : undefined;

      // Claims this order for redemption via the unique orderId index — if two
      // callers race, only one create() succeeds; the other hits E11000 below.
      await this.redemptions.create(
        { couponId, couponCode, userId, orderId, discountAmount },
        session,
      );

      // Pre-increment read tells us whether this was the user's first
      // redemption of this coupon (drives the coupon's usedUsersCount).
      const prevAssignment = await this.assignments.model.findOneAndUpdate(
        { couponId, userId },
        { $inc: { usedCount: 1 }, $set: { lastUsedAt: new Date() } },
        { new: false, ...opts },
      );
      const wasFirstUse = !prevAssignment || (prevAssignment.usedCount ?? 0) === 0;

      await this.coupons.model.updateOne(
        { _id: couponId },
        {
          $inc: {
            usedCount: 1,
            totalDiscountGiven: discountAmount,
            usedUsersCount: wasFirstUse ? 1 : 0,
          },
        },
        opts,
      );
    };

    try {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(() => run(session));
      } catch (e) {
        if ((e as any)?.code === 11000) {
          // Lost the race to another concurrent finalize — already redeemed.
          return { redeemed: false };
        }
        if (!this.isTxnUnsupported(e)) throw e;
        await run(); // standalone-Mongo fallback (no transactions available)
      } finally {
        await session.endSession();
      }
    } catch (e) {
      if ((e as any)?.code === 11000) return { redeemed: false };
      this.logger.error(
        `finalizeRedemption failed for order ${orderId}, coupon ${couponCode}: ${(e as Error).message}`,
      );
      throw e;
    }

    this.auditLog
      .log({
        couponId,
        couponCode,
        action: CouponAuditAction.COUPON_REDEEMED,
        adminId: `USER:${userId}`,
        message: `Coupon redeemed on order ${orderId}`,
        meta: { orderId, discountAmount },
      })
      .catch(() => {});

    return { redeemed: true };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private assertWithinWindowAndActive(coupon: CouponDocument): void {
    if (coupon.status !== CouponStatus.ACTIVE) {
      throw new BadRequestException('This coupon is no longer active');
    }
    const now = new Date();
    if (coupon.startDate && now < new Date(coupon.startDate)) {
      throw new BadRequestException('This coupon is not active yet');
    }
    if (now > new Date(coupon.expiryDate)) {
      throw new BadRequestException('Coupon has expired.');
    }
  }

  private computeDiscount(coupon: CouponDocument, orderAmount: number): number {
    let discount = 0;
    if (coupon.discountType === CouponDiscountType.FIXED) {
      discount = Math.min(coupon.discountValue, orderAmount);
    } else {
      discount = (orderAmount * coupon.discountValue) / 100;
      if (coupon.maximumDiscount != null) {
        discount = Math.min(discount, coupon.maximumDiscount);
      }
    }
    return Math.max(0, Math.min(discount, orderAmount));
  }

  private sanitizeCode(code: string): string {
    if (!code || typeof code !== 'string') {
      throw new BadRequestException('Invalid coupon code format');
    }
    const sanitized = code.trim().toUpperCase();
    if (sanitized.length < 3 || sanitized.length > 50) {
      throw new BadRequestException('Coupon code must be between 3-50 characters');
    }
    return sanitized;
  }

  private sanitizeAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Invalid order amount');
    }
    return Math.min(amount, this.MAX_ORDER_AMOUNT);
  }

  private isTxnUnsupported(e: unknown): boolean {
    const msg = (e as Error)?.message ?? '';
    return (
      msg.includes('Transaction numbers are only allowed on a replica set') ||
      msg.includes('Transactions are not supported') ||
      msg.includes('replica set') ||
      msg.includes('mongos')
    );
  }
}
