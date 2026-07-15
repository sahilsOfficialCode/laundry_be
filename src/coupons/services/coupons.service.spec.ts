import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { CouponsService } from './coupons.service';
import { CouponsRepository } from '../repositories/coupons.repository';
import { CouponAssignmentsRepository } from '../repositories/coupon-assignments.repository';
import { CouponRedemptionsRepository } from '../repositories/coupon-redemptions.repository';
import { CouponAuditLogRepository } from '../repositories/coupon-audit-log.repository';
import { CouponAssignmentStatus, CouponDiscountType, CouponStatus } from '../enums/coupon.enums';

describe('CouponsService', () => {
  let service: CouponsService;
  let coupons: CouponsRepository;
  let assignments: CouponAssignmentsRepository;
  let redemptions: CouponRedemptionsRepository;

  const now = Date.now();
  const mockCoupon = {
    _id: '507f1f77bcf86cd799439011',
    couponCode: 'WELCOME50',
    couponName: 'Welcome back',
    discountType: CouponDiscountType.FIXED,
    discountValue: 50,
    maximumDiscount: undefined as number | undefined,
    minimumOrderAmount: 100,
    usagePerUser: 1,
    totalUsageLimit: undefined as number | undefined,
    usedCount: 0,
    startDate: new Date(now - 86_400_000),
    expiryDate: new Date(now + 86_400_000),
    status: CouponStatus.ACTIVE,
  };

  const mockAssignment = {
    couponId: mockCoupon._id,
    userId: 'user123',
    status: CouponAssignmentStatus.ACTIVE,
    usedCount: 0,
  };

  // Fake mongoose model with just enough surface for finalizeRedemption().
  const fakeAssignmentModel = {
    findOneAndUpdate: jest.fn(),
  };
  const fakeCouponModel = {
    updateOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        {
          provide: CouponsRepository,
          useValue: {
            findByCode: jest.fn(),
            model: fakeCouponModel,
          },
        },
        {
          provide: CouponAssignmentsRepository,
          useValue: {
            findActive: jest.fn(),
            incrementUsage: jest.fn(),
            model: fakeAssignmentModel,
          },
        },
        {
          provide: CouponRedemptionsRepository,
          useValue: {
            findByOrder: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: CouponAuditLogRepository,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getConnectionToken(),
          useValue: {
            startSession: jest.fn().mockResolvedValue({
              withTransaction: async (fn: () => Promise<void>) => fn(),
              endSession: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CouponsService>(CouponsService);
    coupons = module.get<CouponsRepository>(CouponsRepository);
    assignments = module.get<CouponAssignmentsRepository>(CouponAssignmentsRepository);
    redemptions = module.get<CouponRedemptionsRepository>(CouponRedemptionsRepository);

    jest.clearAllMocks();
  });

  describe('validateForUser', () => {
    it('applies a fixed discount for an assigned, active coupon', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue(mockCoupon as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(mockAssignment as any);

      const result = await service.validateForUser('user123', {
        couponCode: 'WELCOME50',
        orderAmount: 200,
      });

      expect(result).toEqual({
        couponId: mockCoupon._id,
        couponCode: 'WELCOME50',
        couponName: 'Welcome back',
        originalAmount: 200,
        discountAmount: 50,
        finalAmount: 150,
      });
    });

    it('caps a percentage discount at maximumDiscount', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        discountType: CouponDiscountType.PERCENTAGE,
        discountValue: 20,
        maximumDiscount: 30,
      } as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(mockAssignment as any);

      const result = await service.validateForUser('user123', {
        couponCode: 'WELCOME50',
        orderAmount: 500, // 20% would be 100, capped to 30
      });

      expect(result.discountAmount).toBe(30);
      expect(result.finalAmount).toBe(470);
    });

    it('throws NotFoundException when the coupon does not exist', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue(null);

      await expect(
        service.validateForUser('user123', { couponCode: 'NOPE', orderAmount: 200 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the coupon is not assigned to this user', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue(mockCoupon as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(null);

      await expect(
        service.validateForUser('user123', { couponCode: 'WELCOME50', orderAmount: 200 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the coupon has expired', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        expiryDate: new Date(now - 1000),
      } as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(mockAssignment as any);

      await expect(
        service.validateForUser('user123', { couponCode: 'WELCOME50', orderAmount: 200 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the coupon is disabled', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        status: CouponStatus.DISABLED,
      } as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(mockAssignment as any);

      await expect(
        service.validateForUser('user123', { couponCode: 'WELCOME50', orderAmount: 200 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the user already used up their allowance', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue(mockCoupon as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue({ ...mockAssignment, usedCount: 1 } as any);

      await expect(
        service.validateForUser('user123', { couponCode: 'WELCOME50', orderAmount: 200 }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when order amount is below the minimum', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue(mockCoupon as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(mockAssignment as any);

      await expect(
        service.validateForUser('user123', { couponCode: 'WELCOME50', orderAmount: 50 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('never discounts more than the order amount', async () => {
      jest.spyOn(coupons, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        discountValue: 500,
        minimumOrderAmount: 0,
      } as any);
      jest.spyOn(assignments, 'findActive').mockResolvedValue(mockAssignment as any);

      const result = await service.validateForUser('user123', {
        couponCode: 'WELCOME50',
        orderAmount: 200,
      });

      expect(result.discountAmount).toBe(200);
      expect(result.finalAmount).toBe(0);
    });

    it('rejects when not logged in', async () => {
      await expect(
        service.validateForUser('', { couponCode: 'WELCOME50', orderAmount: 200 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('finalizeRedemption', () => {
    const params = {
      orderId: 'order1',
      userId: 'user123',
      couponId: mockCoupon._id,
      couponCode: 'WELCOME50',
      discountAmount: 50,
    };

    it('is a no-op when the order was already redeemed', async () => {
      jest.spyOn(redemptions, 'findByOrder').mockResolvedValue({ _id: 'existing' } as any);

      const result = await service.finalizeRedemption(params);

      expect(result).toEqual({ redeemed: false });
      expect(redemptions.create).not.toHaveBeenCalled();
    });

    it('records the redemption and increments counters exactly once', async () => {
      jest.spyOn(redemptions, 'findByOrder').mockResolvedValue(null);
      jest.spyOn(redemptions, 'create').mockResolvedValue({} as any);
      fakeAssignmentModel.findOneAndUpdate.mockResolvedValue({ usedCount: 0 });
      fakeCouponModel.updateOne.mockResolvedValue({});

      const result = await service.finalizeRedemption(params);

      expect(result).toEqual({ redeemed: true });
      expect(redemptions.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order1', discountAmount: 50 }),
        expect.anything(),
      );
      expect(fakeCouponModel.updateOne).toHaveBeenCalledWith(
        { _id: mockCoupon._id },
        expect.objectContaining({
          $inc: expect.objectContaining({ usedCount: 1, totalDiscountGiven: 50, usedUsersCount: 1 }),
        }),
        expect.anything(),
      );
    });

    it('does not bump usedUsersCount on a user repeat redemption', async () => {
      jest.spyOn(redemptions, 'findByOrder').mockResolvedValue(null);
      jest.spyOn(redemptions, 'create').mockResolvedValue({} as any);
      fakeAssignmentModel.findOneAndUpdate.mockResolvedValue({ usedCount: 1 }); // already used once before
      fakeCouponModel.updateOne.mockResolvedValue({});

      await service.finalizeRedemption(params);

      expect(fakeCouponModel.updateOne).toHaveBeenCalledWith(
        { _id: mockCoupon._id },
        expect.objectContaining({
          $inc: expect.objectContaining({ usedUsersCount: 0 }),
        }),
        expect.anything(),
      );
    });

    it('does nothing when discountAmount is 0', async () => {
      const result = await service.finalizeRedemption({ ...params, discountAmount: 0 });
      expect(result).toEqual({ redeemed: false });
      expect(redemptions.findByOrder).not.toHaveBeenCalled();
    });
  });
});
