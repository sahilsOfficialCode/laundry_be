import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { ReferralRepository } from '../repositories/referral.repository';
import { FraudDetectionService } from './fraud-detection.service';
import { ReferralStatus, RewardStatus } from '../enums/referral.enums';
import {
  ReferralDashboardSummary,
  Paginated,
} from '../types/referral.types';

/**
 * Read-only analytics + reporting for the admin dashboard.
 * All heavy lifting is done in MongoDB aggregation pipelines (indexed fields).
 */
@Injectable()
export class ReferralAnalyticsService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly repo: ReferralRepository,
    private readonly fraudService: FraudDetectionService,
  ) {}

  // ── Dashboard summary cards ────────────────────────────────────────────────

  async dashboard(): Promise<ReferralDashboardSummary> {
    const completedStatuses = [ReferralStatus.REWARD_RELEASED];
    const pendingStatuses = [
      ReferralStatus.PENDING,
      ReferralStatus.REGISTERED,
      ReferralStatus.FIRST_ORDER_COMPLETED,
      ReferralStatus.PAYMENT_COMPLETED,
    ];

    const [total, pending, completed, rejected] = await Promise.all([
      this.repo.countReferrals({}),
      this.repo.countReferrals({ status: { $in: pendingStatuses } }),
      this.repo.countReferrals({ status: { $in: completedStatuses } }),
      this.repo.countReferrals({ status: ReferralStatus.REJECTED }),
    ]);

    // Reward paid vs pending (sum over reward records).
    const rewardAgg = await this.repo.aggregateRewards([
      {
        $group: {
          _id: '$status',
          sum: { $sum: '$amount' },
        },
      },
    ]);
    const rewardPaid =
      rewardAgg.find((r) => r._id === RewardStatus.RELEASED)?.sum ?? 0;
    const rewardPending =
      rewardAgg.find((r) => r._id === RewardStatus.PENDING)?.sum ?? 0;

    // Most active referrers.
    const topReferrers = await this.repo.aggregateReferrals([
      { $group: { _id: '$referrerId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);
    const referrerIds = topReferrers.map((t) => t._id);
    const referrerUsers = await this.userModel
      .find({ _id: { $in: referrerIds } })
      .select('name')
      .lean();
    const nameMap = new Map(referrerUsers.map((u) => [String(u._id), u.name]));
    const mostActiveReferrers = topReferrers.map((t) => ({
      referrerId: String(t._id),
      name: nameMap.get(String(t._id)) ?? 'User',
      count: t.count,
    }));

    // Top cities — derived from referees' default address city.
    const topCities = await this.topCities();

    return {
      totalReferrals: total,
      pendingReferrals: pending,
      completedReferrals: completed,
      rejectedReferrals: rejected,
      rewardPaid,
      rewardPending,
      mostActiveReferrers,
      topCities,
    };
  }

  private async topCities(): Promise<Array<{ city: string; count: number }>> {
    const rows = await this.userModel.aggregate([
      { $unwind: { path: '$addresses', preserveNullAndEmptyArrays: false } },
      { $match: { 'addresses.city': { $nin: [null, ''] } } },
      { $group: { _id: '$addresses.city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);
    return rows.map((r) => ({ city: r._id, count: r.count }));
  }

  // ── Time-series report (daily / weekly / monthly) ──────────────────────────

  async report(query: {
    from?: string;
    to?: string;
    granularity?: 'daily' | 'weekly' | 'monthly';
  }) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    const granularity = query.granularity ?? 'daily';

    const dateFormat =
      granularity === 'monthly'
        ? '%Y-%m'
        : granularity === 'weekly'
        ? '%Y-%U'
        : '%Y-%m-%d';

    const series = await this.repo.aggregateReferrals([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [
                { $eq: ['$status', ReferralStatus.REWARD_RELEASED] },
                1,
                0,
              ],
            },
          },
          rejected: {
            $sum: {
              $cond: [{ $eq: ['$status', ReferralStatus.REJECTED] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalReferrals = await this.repo.countReferrals({
      createdAt: { $gte: from, $lte: to },
    });
    const completed = await this.repo.countReferrals({
      status: ReferralStatus.REWARD_RELEASED,
      createdAt: { $gte: from, $lte: to },
    });

    // Reward cost + ROI inputs.
    const rewardCostAgg = await this.repo.aggregateRewards([
      {
        $match: {
          status: RewardStatus.RELEASED,
          releasedAt: { $gte: from, $lte: to },
        },
      },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]);
    const rewardCost = rewardCostAgg[0]?.sum ?? 0;

    const conversionRate =
      totalReferrals > 0
        ? Number(((completed / totalReferrals) * 100).toFixed(2))
        : 0;
    const fraudRate = await this.fraudService.fraudRate(totalReferrals);

    return {
      range: { from, to, granularity },
      series: series.map((s) => ({
        period: s._id,
        total: s.total,
        completed: s.completed,
        rejected: s.rejected,
      })),
      summary: {
        totalReferrals,
        completedReferrals: completed,
        conversionRate, // %
        rewardCost, // INR paid out
        fraudRate, // %
        // ROI is defined by the business (revenue attributable / reward cost);
        // exposed as a placeholder the finance team can wire to order revenue.
        roi: null as number | null,
      },
    };
  }

  // ── Admin searchable, paginated referral list ──────────────────────────────

  async listReferrals(query: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<Paginated<any>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;

    // Search by referral code or referrer/referee id.
    if (query.search) {
      const s = query.search.trim();
      filter.$or = [
        { code: s.toUpperCase() },
        { referrerId: s },
        { refereeId: s },
      ];
    }

    const { data, total } = await this.repo.paginateReferrals(
      filter,
      page,
      limit,
    );
    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
