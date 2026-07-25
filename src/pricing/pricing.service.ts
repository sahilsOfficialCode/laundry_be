import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OrderPricingSnapshot,
  OrderPricingSnapshotDocument,
  PricingSnapshotReason,
} from './schemas/order-pricing-snapshot.schema';
import {
  PriceAdjustmentLog,
  PriceAdjustmentLogDocument,
} from './schemas/price-adjustment-log.schema';
import { PricingConfigService } from './services/pricing-config.service';
import { ComputeBreakdownInput, computeBreakdown, PricingBreakdown } from './pricing.calculator';

export { computeBreakdown } from './pricing.calculator';
export type { PricingBreakdown, ComputeBreakdownInput } from './pricing.calculator';

/**
 * Centralized server-side pricing engine. Every order total — at checkout,
 * at itemization, and at payment capture — must be produced by this service
 * so there is exactly one place that knows how to turn line items + fees +
 * tax + discounts into a payable total, and exactly one place that persists
 * the immutable audit trail behind that number.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectModel(OrderPricingSnapshot.name)
    private readonly snapshotModel: Model<OrderPricingSnapshotDocument>,
    @InjectModel(PriceAdjustmentLog.name)
    private readonly adjustmentLogModel: Model<PriceAdjustmentLogDocument>,
    private readonly configService: PricingConfigService,
  ) {}

  async getConfig() {
    return this.configService.get();
  }

  compute(input: ComputeBreakdownInput): PricingBreakdown {
    return computeBreakdown(input);
  }

  /** Persists an immutable snapshot for this pricing event. Never updates an existing snapshot. */
  async recordSnapshot(
    orderId: string,
    reason: PricingSnapshotReason,
    breakdown: PricingBreakdown,
    createdBy?: string,
  ): Promise<OrderPricingSnapshotDocument> {
    return this.snapshotModel.create({
      orderId,
      reason,
      lineItems: breakdown.lineItems,
      itemsSubtotal: breakdown.itemsSubtotal,
      taxableSubtotal: breakdown.taxableSubtotal,
      taxRatePercent: breakdown.taxRatePercent,
      taxAmount: breakdown.taxAmount,
      deliveryFee: breakdown.deliveryFee,
      platformFee: breakdown.platformFee,
      convenienceFee: breakdown.convenienceFee,
      packagingFee: breakdown.packagingFee,
      discounts: breakdown.discounts,
      walletDeductionAmount: breakdown.walletDeductionAmount,
      roundingAdjustment: breakdown.roundingAdjustment,
      payableTotal: breakdown.payableTotal,
      isManualOverride: breakdown.isManualOverride,
      overrideReason: breakdown.overrideReason,
      createdBy: createdBy ?? 'SYSTEM',
    });
  }

  async getLatestSnapshot(orderId: string) {
    return this.snapshotModel.findOne({ orderId }).sort({ createdAt: -1 }).lean();
  }

  async getSnapshotsForOrder(orderId: string) {
    return this.snapshotModel.find({ orderId }).sort({ createdAt: -1 }).lean();
  }

  /** Fire-and-forget by callers — a logging failure must never block the money-critical write it documents. */
  async recordAdjustment(params: {
    orderId: string;
    previousAmount: number;
    newAmount: number;
    reason: string;
    adminId: string;
    ipAddress?: string;
    meta?: Record<string, any>;
  }) {
    const diffAmount = Math.round((params.newAmount - params.previousAmount + Number.EPSILON) * 100) / 100;
    return this.adjustmentLogModel.create({
      orderId: params.orderId,
      previousAmount: params.previousAmount,
      newAmount: params.newAmount,
      diffAmount,
      reason: params.reason,
      adminId: params.adminId,
      ipAddress: params.ipAddress ?? null,
      meta: params.meta ?? {},
    });
  }

  async getAdjustmentsForOrder(orderId: string) {
    return this.adjustmentLogModel.find({ orderId }).sort({ createdAt: -1 }).lean();
  }
}

export { PricingSnapshotReason } from './schemas/order-pricing-snapshot.schema';
