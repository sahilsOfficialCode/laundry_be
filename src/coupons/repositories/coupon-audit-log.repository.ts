import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CouponAuditLog, CouponAuditLogDocument } from '../schemas/coupon-audit-log.schema';
import { CouponAuditAction } from '../enums/coupon.enums';

@Injectable()
export class CouponAuditLogRepository {
  private readonly logger = new Logger(CouponAuditLogRepository.name);

  constructor(
    @InjectModel(CouponAuditLog.name)
    private readonly model: Model<CouponAuditLogDocument>,
  ) {}

  /**
   * Best-effort by design — an audit-log write failure must never roll back
   * or block the underlying admin action it's describing.
   */
  async log(entry: {
    couponId?: string | null;
    couponCode?: string | null;
    action: CouponAuditAction;
    adminId: string;
    message?: string;
    ipAddress?: string | null;
    meta?: Record<string, any>;
  }): Promise<void> {
    try {
      await this.model.create(entry);
    } catch (err) {
      this.logger.error(`Failed to write coupon audit log (${entry.action}): ${(err as Error).message}`);
    }
  }

  async listForCoupon(couponId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model.find({ couponId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments({ couponId }),
    ]);
    return { data, total };
  }
}
