import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { CouponsRepository } from '../repositories/coupons.repository';
import { CouponAssignmentsRepository } from '../repositories/coupon-assignments.repository';
import { CouponRedemptionsRepository } from '../repositories/coupon-redemptions.repository';
import { CouponAuditLogRepository } from '../repositories/coupon-audit-log.repository';
import { CouponConditionsService } from './coupon-conditions.service';
import { CreateCouponDto } from '../dto/create-coupon.dto';
import { UpdateCouponDto } from '../dto/update-coupon.dto';
import { ListCouponsQueryDto } from '../dto/list-coupons-query.dto';
import { ListCouponUsersQueryDto } from '../dto/list-coupon-users-query.dto';
import { AssignUsersDto } from '../dto/assign-users.dto';
import { BulkAssignDto } from '../dto/bulk-assign.dto';
import {
  CouponAssignmentSource,
  CouponAuditAction,
  CouponDiscountType,
  CouponEffectiveStatus,
  CouponStatus,
} from '../enums/coupon.enums';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { CouponDocument } from '../schemas/coupon.schema';

export interface ActorContext {
  adminId: string;
  ip?: string | null;
}

@Injectable()
export class CouponsAdminService {
  private readonly logger = new Logger(CouponsAdminService.name);

  constructor(
    private readonly coupons: CouponsRepository,
    private readonly assignments: CouponAssignmentsRepository,
    private readonly redemptions: CouponRedemptionsRepository,
    private readonly auditLog: CouponAuditLogRepository,
    private readonly conditions: CouponConditionsService,
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async create(dto: CreateCouponDto, actor: ActorContext) {
    this.validateBusinessRules(dto);

    const couponCode = dto.couponCode.trim().toUpperCase();
    // Only live (non-deleted) coupons block reuse of a code — a deleted
    // coupon's code is free to reuse. See the partial unique index on
    // Coupon.couponCode.
    const existing = await this.coupons.findByCode(couponCode, false);
    if (existing) {
      throw new ConflictException('A coupon with this code already exists');
    }

    let coupon: CouponDocument;
    try {
      coupon = await this.coupons.create({
        couponCode,
        couponName: dto.couponName.trim(),
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minimumOrderAmount: dto.minimumOrderAmount ?? 0,
        maximumDiscount: dto.maximumDiscount,
        usagePerUser: dto.usagePerUser ?? 1,
        totalUsageLimit: dto.totalUsageLimit,
        startDate: new Date(dto.startDate),
        expiryDate: new Date(dto.expiryDate),
        status: dto.status ?? CouponStatus.ACTIVE,
        description: dto.description ?? '',
        createdBy: actor.adminId,
      });
    } catch (e: any) {
      if (e?.code === 11000) throw new ConflictException('A coupon with this code already exists');
      throw e;
    }

    await this.auditLog.log({
      couponId: coupon._id.toString(),
      couponCode: coupon.couponCode,
      action: CouponAuditAction.COUPON_CREATED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `Coupon ${coupon.couponCode} created`,
      meta: { dto },
    });

    return this.toDetail(coupon);
  }

  async list(query: ListCouponsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.coupons.list({
      search: query.search,
      status: query.status,
      expiryFrom: query.expiryFrom,
      expiryTo: query.expiryTo,
      page,
      limit,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder ?? 'desc',
    });

    return {
      data: data.map((c) => this.toListItem(c)),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getById(id: string) {
    const coupon = await this.getCouponOr404(id);
    return this.toDetail(coupon);
  }

  async update(id: string, dto: UpdateCouponDto, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);

    const merged = {
      discountType: dto.discountType ?? coupon.discountType,
      discountValue: dto.discountValue ?? coupon.discountValue,
      maximumDiscount: dto.maximumDiscount ?? coupon.maximumDiscount,
      startDate: dto.startDate ?? coupon.startDate.toISOString(),
      expiryDate: dto.expiryDate ?? coupon.expiryDate.toISOString(),
    };
    this.validateBusinessRules(merged as CreateCouponDto);

    const update: Partial<CouponDocument> = { updatedBy: actor.adminId } as any;
    if (dto.couponName !== undefined) update.couponName = dto.couponName.trim();
    if (dto.discountType !== undefined) update.discountType = dto.discountType;
    if (dto.discountValue !== undefined) update.discountValue = dto.discountValue;
    if (dto.minimumOrderAmount !== undefined) update.minimumOrderAmount = dto.minimumOrderAmount;
    if (dto.maximumDiscount !== undefined) update.maximumDiscount = dto.maximumDiscount;
    if (dto.usagePerUser !== undefined) update.usagePerUser = dto.usagePerUser;
    if (dto.totalUsageLimit !== undefined) update.totalUsageLimit = dto.totalUsageLimit;
    if (dto.startDate !== undefined) update.startDate = new Date(dto.startDate);
    if (dto.expiryDate !== undefined) update.expiryDate = new Date(dto.expiryDate);
    if (dto.status !== undefined) update.status = dto.status;
    if (dto.description !== undefined) update.description = dto.description;

    const updated = await this.coupons.updateById(id, update);
    if (!updated) throw new NotFoundException('Coupon not found');

    await this.auditLog.log({
      couponId: id,
      couponCode: updated.couponCode,
      action: CouponAuditAction.COUPON_UPDATED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `Coupon ${updated.couponCode} updated`,
      meta: { changes: dto },
    });

    return this.toDetail(updated);
  }

  async setStatus(id: string, status: CouponStatus, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);
    const updated = await this.coupons.setStatus(id, status, actor.adminId);
    if (!updated) throw new NotFoundException('Coupon not found');

    await this.auditLog.log({
      couponId: id,
      couponCode: coupon.couponCode,
      action: status === CouponStatus.DISABLED ? CouponAuditAction.COUPON_DISABLED : CouponAuditAction.COUPON_ENABLED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `Coupon ${coupon.couponCode} set to ${status}`,
    });

    return this.toDetail(updated);
  }

  async softDelete(id: string, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);
    const deleted = await this.coupons.softDelete(id, actor.adminId);
    if (!deleted) throw new NotFoundException('Coupon not found');

    await this.auditLog.log({
      couponId: id,
      couponCode: coupon.couponCode,
      action: CouponAuditAction.COUPON_DELETED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `Coupon ${coupon.couponCode} deleted`,
    });

    return { success: true };
  }

  // ── Assignment ───────────────────────────────────────────────────────────

  async assignUsersManual(id: string, dto: AssignUsersDto, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);

    const validUsers = await this.userModel
      .find({ _id: { $in: dto.userIds }, isDeleted: { $ne: true } })
      .select('_id')
      .lean();
    const validIds = validUsers.map((u) => u._id.toString());
    if (validIds.length === 0) {
      throw new BadRequestException('None of the provided userIds are valid, active users');
    }

    const { newlyAssigned, alreadyAssigned } = await this.assignments.assignMany(
      id,
      validIds,
      actor.adminId,
      CouponAssignmentSource.MANUAL,
    );

    if (newlyAssigned > 0) {
      await this.coupons.incrementCounters(id, { assignedUsersCount: newlyAssigned });
    }

    await this.auditLog.log({
      couponId: id,
      couponCode: coupon.couponCode,
      action: CouponAuditAction.USERS_ASSIGNED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `${newlyAssigned} user(s) assigned to ${coupon.couponCode} (manual)`,
      meta: { userIds: validIds, newlyAssigned, alreadyAssigned },
    });

    return { newlyAssigned, alreadyAssigned, requested: dto.userIds.length, skippedInvalid: dto.userIds.length - validIds.length };
  }

  async bulkAssign(id: string, dto: BulkAssignDto, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);

    const matchedUserIds = await this.conditions.resolve(dto);
    if (matchedUserIds.length === 0) {
      return { matched: 0, newlyAssigned: 0, alreadyAssigned: 0 };
    }

    const { newlyAssigned, alreadyAssigned } = await this.assignments.assignMany(
      id,
      matchedUserIds,
      `SYSTEM:${dto.condition}`,
      CouponAssignmentSource.BULK_CONDITION,
      dto.condition,
    );

    if (newlyAssigned > 0) {
      await this.coupons.incrementCounters(id, { assignedUsersCount: newlyAssigned });
    }

    await this.auditLog.log({
      couponId: id,
      couponCode: coupon.couponCode,
      action: CouponAuditAction.USERS_ASSIGNED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `${newlyAssigned} user(s) bulk-assigned to ${coupon.couponCode} via "${dto.condition}"`,
      meta: { condition: dto.condition, city: dto.city, matched: matchedUserIds.length, newlyAssigned, alreadyAssigned },
    });

    return { matched: matchedUserIds.length, newlyAssigned, alreadyAssigned };
  }

  async removeUser(id: string, userId: string, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);
    const removed = await this.assignments.removeUser(id, userId, actor.adminId);
    if (!removed) {
      throw new NotFoundException('This user is not actively assigned to this coupon');
    }

    await this.coupons.incrementCounters(id, { assignedUsersCount: -1 });

    await this.auditLog.log({
      couponId: id,
      couponCode: coupon.couponCode,
      action: CouponAuditAction.USER_REMOVED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `User removed from ${coupon.couponCode}`,
      meta: { userId },
    });

    return { success: true };
  }

  async reassignUser(id: string, userId: string, actor: ActorContext) {
    const coupon = await this.getCouponOr404(id);
    const { newlyAssigned } = await this.assignments.assignMany(
      id,
      [userId],
      actor.adminId,
      CouponAssignmentSource.MANUAL,
    );
    if (newlyAssigned > 0) {
      await this.coupons.incrementCounters(id, { assignedUsersCount: newlyAssigned });
    }

    await this.auditLog.log({
      couponId: id,
      couponCode: coupon.couponCode,
      action: CouponAuditAction.USER_REASSIGNED,
      adminId: actor.adminId,
      ipAddress: actor.ip ?? null,
      message: `User reassigned to ${coupon.couponCode}`,
      meta: { userId },
    });

    return { success: true };
  }

  async listUsers(id: string, query: ListCouponUsersQueryDto) {
    await this.getCouponOr404(id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let matchingUserIds: string[] | null = null;
    if (query.search?.trim()) {
      const term = query.search.trim();
      const re = new RegExp(this.escapeRegex(term), 'i');
      const orClauses: Record<string, any>[] = [{ name: re }, { mobileNumber: re }, { email: re }];
      if (this.isObjectId(term)) orClauses.push({ _id: term });
      const users = await this.userModel.find({ $or: orClauses }).select('_id').lean();
      matchingUserIds = users.map((u) => u._id.toString());
      if (matchingUserIds.length === 0) {
        return { data: [], pagination: { page, limit, total: 0, totalPages: 1 } };
      }
    }

    const { data, total } = await this.assignments.listForCoupon(
      id,
      { search: query.search, status: query.status, usage: query.usage, page, limit },
      matchingUserIds,
    );

    const userIds = data.map((a) => a.userId.toString());
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('name mobileNumber email')
      .lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    return {
      data: data.map((a) => {
        const u = userMap.get(a.userId.toString());
        return {
          userId: a.userId.toString(),
          customerName: u?.name ?? 'Unknown',
          mobileNumber: u?.mobileNumber ?? '',
          email: u?.email ?? '',
          assignedAt: a.assignedAt,
          status: a.status,
          usedCount: a.usedCount,
          lastUsedAt: a.lastUsedAt ?? null,
          source: a.source,
        };
      }),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async exportUsersCsv(id: string): Promise<{ filename: string; csv: string }> {
    const coupon = await this.getCouponOr404(id);
    const rows = await this.assignments.listAllForCoupon(id);
    const userIds = rows.map((r) => r.userId.toString());
    const users = await this.userModel.find({ _id: { $in: userIds } }).select('name mobileNumber email').lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const headers = ['Customer', 'Mobile', 'Email', 'Assigned Date', 'Used', 'Used Date', 'Status'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const u = userMap.get(r.userId.toString());
      lines.push(
        [
          this.csvCell(u?.name ?? 'Unknown'),
          this.csvCell(u?.mobileNumber ?? ''),
          this.csvCell(u?.email ?? ''),
          this.csvCell(r.assignedAt?.toISOString() ?? ''),
          this.csvCell(r.usedCount > 0 ? 'Yes' : 'No'),
          this.csvCell(r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : ''),
          this.csvCell(r.status),
        ].join(','),
      );
    }

    return { filename: `${coupon.couponCode}-users.csv`, csv: lines.join('\n') };
  }

  // ── Reports ──────────────────────────────────────────────────────────────

  async dashboard() {
    const counts = await this.coupons.dashboardCounts();
    return counts;
  }

  async report(id: string) {
    const coupon = await this.getCouponOr404(id);
    const assignedUsers = coupon.assignedUsersCount;
    const usedUsers = coupon.usedUsersCount;
    const remainingUsers = Math.max(0, assignedUsers - usedUsers);
    const redemptionRate = assignedUsers > 0 ? Number(((usedUsers / assignedUsers) * 100).toFixed(2)) : 0;

    return {
      couponId: id,
      couponCode: coupon.couponCode,
      assignedUsers,
      usedUsers,
      remainingUsers,
      totalDiscountGiven: coupon.totalDiscountGiven,
      redemptionRate,
      totalRedemptions: coupon.usedCount,
    };
  }

  async auditLogs(id: string, page = 1, limit = 50) {
    await this.getCouponOr404(id);
    return this.auditLog.listForCoupon(id, page, limit);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private async getCouponOr404(id: string): Promise<CouponDocument> {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  private validateBusinessRules(dto: Partial<CreateCouponDto>): void {
    if (dto.discountType === CouponDiscountType.PERCENTAGE && dto.discountValue != null && dto.discountValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100');
    }

    if (dto.discountValue != null && dto.discountValue <= 0) {
      throw new BadRequestException('Discount value must be greater than 0');
    }

    if (dto.startDate && dto.expiryDate) {
      const start = new Date(dto.startDate);
      const expiry = new Date(dto.expiryDate);
      if (isNaN(start.getTime()) || isNaN(expiry.getTime())) {
        throw new BadRequestException('Invalid start or expiry date');
      }
      if (expiry <= start) {
        throw new BadRequestException('Expiry date must be after the start date');
      }
    }

    const maxFixed = this.config.get<number>('COUPON_MAX_FIXED_DISCOUNT');
    if (
      maxFixed &&
      dto.discountType === CouponDiscountType.FIXED &&
      dto.discountValue != null &&
      dto.discountValue > Number(maxFixed)
    ) {
      throw new BadRequestException(`Fixed discount cannot exceed ₹${maxFixed}`);
    }
  }

  private toEffectiveStatus(coupon: CouponDocument): CouponEffectiveStatus {
    if (coupon.status === CouponStatus.DISABLED) return CouponEffectiveStatus.DISABLED;
    if (new Date(coupon.expiryDate) < new Date()) return CouponEffectiveStatus.EXPIRED;
    return CouponEffectiveStatus.ACTIVE;
  }

  private toListItem(coupon: CouponDocument) {
    return {
      id: coupon._id.toString(),
      couponCode: coupon.couponCode,
      couponName: coupon.couponName,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      assignedUsersCount: coupon.assignedUsersCount,
      usedUsersCount: coupon.usedUsersCount,
      expiryDate: coupon.expiryDate,
      status: coupon.status,
      effectiveStatus: this.toEffectiveStatus(coupon),
      createdBy: coupon.createdBy,
      createdAt: coupon.createdAt,
    };
  }

  private toDetail(coupon: CouponDocument) {
    return {
      id: coupon._id.toString(),
      couponCode: coupon.couponCode,
      couponName: coupon.couponName,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minimumOrderAmount: coupon.minimumOrderAmount,
      maximumDiscount: coupon.maximumDiscount,
      usagePerUser: coupon.usagePerUser,
      totalUsageLimit: coupon.totalUsageLimit,
      usedCount: coupon.usedCount,
      startDate: coupon.startDate,
      expiryDate: coupon.expiryDate,
      status: coupon.status,
      effectiveStatus: this.toEffectiveStatus(coupon),
      description: coupon.description,
      createdBy: coupon.createdBy,
      createdAt: coupon.createdAt,
      updatedAt: coupon.updatedAt,
      stats: {
        assignedUsers: coupon.assignedUsersCount,
        usedUsers: coupon.usedUsersCount,
        remainingUsers: Math.max(0, coupon.assignedUsersCount - coupon.usedUsersCount),
        totalDiscountGiven: coupon.totalDiscountGiven,
      },
    };
  }

  private csvCell(value: any): string {
    if (value === null || value === undefined) return '';
    const s = String(value).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isObjectId(v: string): boolean {
    return Types.ObjectId.isValid(v);
  }
}
