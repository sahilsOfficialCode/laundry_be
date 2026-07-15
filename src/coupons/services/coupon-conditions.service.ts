import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Order, OrderDocument, OrderStatus, PaymentStatus } from '../../orders/schemas/order.schema';
import { BulkAssignDto } from '../dto/bulk-assign.dto';
import { CouponBulkCondition } from '../enums/coupon.enums';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const WALLET_THRESHOLD = 100;

/**
 * Resolves a bulk-assignment condition into a concrete list of userIds.
 * Every condition query is scoped to isDeleted: false / isActive: true users
 * so disabled/deleted accounts never get assigned a coupon.
 */
@Injectable()
export class CouponConditionsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  async resolve(dto: BulkAssignDto): Promise<string[]> {
    switch (dto.condition) {
      case CouponBulkCondition.CUSTOM_USER_IDS:
        return this.resolveCustomIds(dto.userIds);
      case CouponBulkCondition.CITY:
        return this.resolveCity(dto.city);
      case CouponBulkCondition.MISSED_FIRST_CASHBACK:
        return this.resolveMissedFirstCashback();
      case CouponBulkCondition.FAILED_PAYMENT:
        return this.resolveFailedPayment();
      case CouponBulkCondition.COMPLETED_FIRST_ORDER:
        return this.resolveCompletedFirstOrder();
      case CouponBulkCondition.NO_ORDERS_30_DAYS:
        return this.resolveNoOrders30Days();
      case CouponBulkCondition.WALLET_BALANCE_BELOW_100:
        return this.resolveWalletBelow100();
      default:
        throw new BadRequestException('Unsupported bulk condition');
    }
  }

  private async activeUserIdSet(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const users = await this.userModel
      .find({ _id: { $in: ids }, isDeleted: { $ne: true }, isActive: { $ne: false } })
      .select('_id')
      .lean();
    return users.map((u) => u._id.toString());
  }

  private resolveCustomIds(userIds?: string[]): Promise<string[]> {
    if (!userIds || userIds.length === 0) {
      throw new BadRequestException('userIds is required for the custom_user_ids condition');
    }
    return this.activeUserIdSet(userIds);
  }

  private async resolveCity(city?: string): Promise<string[]> {
    if (!city || !city.trim()) {
      throw new BadRequestException('city is required for the city condition');
    }
    const users = await this.userModel
      .find({
        isDeleted: { $ne: true },
        isActive: { $ne: false },
        addresses: { $elemMatch: { city: new RegExp(`^${this.escapeRegex(city.trim())}$`, 'i') } },
      })
      .select('_id')
      .lean();
    return users.map((u) => u._id.toString());
  }

  /**
   * Users whose first COMPLETED order did NOT receive the first-order
   * discount (firstOrderDiscountAmount falsy) — i.e. they missed the
   * first-order cashback promotion and are candidates for compensation.
   */
  private async resolveMissedFirstCashback(): Promise<string[]> {
    const rows = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED } },
      { $sort: { userId: 1, createdAt: 1 } },
      {
        $group: {
          _id: '$userId',
          firstOrderDiscount: { $first: '$firstOrderDiscountAmount' },
        },
      },
      { $match: { $or: [{ firstOrderDiscount: { $in: [null, 0] } }, { firstOrderDiscount: { $exists: false } }] } },
    ]);
    const userIds = rows.map((r) => r._id).filter(Boolean);
    return this.activeUserIdSet(userIds);
  }

  private async resolveFailedPayment(): Promise<string[]> {
    const userIds = await this.orderModel.distinct('userId', { paymentStatus: PaymentStatus.FAILED });
    return this.activeUserIdSet(userIds.filter(Boolean));
  }

  /** Users who have completed exactly one order — i.e. just finished their first. */
  private async resolveCompletedFirstOrder(): Promise<string[]> {
    const rows = await this.orderModel.aggregate([
      { $match: { status: OrderStatus.COMPLETED } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $match: { count: 1 } },
    ]);
    const userIds = rows.map((r) => r._id).filter(Boolean);
    return this.activeUserIdSet(userIds);
  }

  /** Users with at least one historical order but none in the last 30 days — win-back segment. */
  private async resolveNoOrders30Days(): Promise<string[]> {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const rows = await this.orderModel.aggregate([
      { $match: { status: { $ne: OrderStatus.CANCELLED } } },
      { $group: { _id: '$userId', lastOrderAt: { $max: '$createdAt' } } },
      { $match: { lastOrderAt: { $lt: cutoff } } },
    ]);
    const userIds = rows.map((r) => r._id).filter(Boolean);
    return this.activeUserIdSet(userIds);
  }

  private async resolveWalletBelow100(): Promise<string[]> {
    const users = await this.userModel
      .find({
        isDeleted: { $ne: true },
        isActive: { $ne: false },
        $or: [{ walletBalance: { $lt: WALLET_THRESHOLD } }, { walletBalance: { $exists: false } }],
      })
      .select('_id')
      .lean();
    return users.map((u) => u._id.toString());
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
