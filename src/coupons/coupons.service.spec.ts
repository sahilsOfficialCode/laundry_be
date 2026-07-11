import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CouponsService } from './services/coupons.service';
import { CouponsRepository } from './repositories/coupons.repository';

describe('CouponsService', () => {
  let service: CouponsService;
  let repository: CouponsRepository;

  const mockCoupon = {
    _id: '507f1f77bcf86cd799439011',
    code: 'WELCOME50',
    description: 'Welcome discount',
    discountType: 'fixed',
    discountAmount: 50,
    discountPercentage: null,
    minOrderAmount: 100,
    maxRedemptions: 100,
    totalRedemptions: 0,
    expiryDate: new Date(Date.now() + 86_400_000), // Tomorrow
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        {
          provide: CouponsRepository,
          useValue: {
            findByCode: jest.fn(),
            findActiveCoupons: jest.fn(),
            recordUsage: jest.fn(),
            incrementRedemptions: jest.fn(),
            findUsageByOrder: jest.fn(),
            getAllCoupons: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            deactivate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CouponsService>(CouponsService);
    repository = module.get<CouponsRepository>(CouponsRepository);
  });

  describe('applyCoupon', () => {
    it('should apply valid fixed discount coupon', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(mockCoupon as any);

      const result = await service.applyCoupon({
        couponCode: 'WELCOME50',
        orderAmount: 200,
      });

      expect(result).toEqual({
        couponCode: 'WELCOME50',
        originalAmount: 200,
        discountAmount: 50,
        finalAmount: 150,
      });
    });

    it('should apply valid percentage discount coupon', async () => {
      const percentageCoupon = {
        ...mockCoupon,
        discountType: 'percentage',
        discountPercentage: 10,
      };
      jest.spyOn(repository, 'findByCode').mockResolvedValue(percentageCoupon as any);

      const result = await service.applyCoupon({
        couponCode: 'DISCOUNT10',
        orderAmount: 200,
      });

      expect(result.discountAmount).toBe(20); // 10% of 200
      expect(result.finalAmount).toBe(180);
    });

    it('should throw if coupon code is invalid format', async () => {
      await expect(
        service.applyCoupon({
          couponCode: 'AB', // Too short
          orderAmount: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if coupon is not found', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(null);

      await expect(
        service.applyCoupon({
          couponCode: 'INVALID',
          orderAmount: 200,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if coupon is inactive', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        isActive: false,
      } as any);

      await expect(
        service.applyCoupon({
          couponCode: 'WELCOME50',
          orderAmount: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if coupon is expired', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        expiryDate: new Date(Date.now() - 86_400_000), // Yesterday
      } as any);

      await expect(
        service.applyCoupon({
          couponCode: 'WELCOME50',
          orderAmount: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if order amount is below minimum', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(mockCoupon as any);

      await expect(
        service.applyCoupon({
          couponCode: 'WELCOME50',
          orderAmount: 50, // Below minimum of 100
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if max redemptions reached', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        maxRedemptions: 10,
        totalRedemptions: 10,
      } as any);

      await expect(
        service.applyCoupon({
          couponCode: 'WELCOME50',
          orderAmount: 200,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should cap discount to order amount', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        discountAmount: 500, // Larger than order
      } as any);

      const result = await service.applyCoupon({
        couponCode: 'WELCOME50',
        orderAmount: 200,
      });

      expect(result.discountAmount).toBe(200);
      expect(result.finalAmount).toBe(0);
    });

    it('should handle invalid order amount', async () => {
      await expect(
        service.applyCoupon({
          couponCode: 'WELCOME50',
          orderAmount: -50,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordUsage', () => {
    it('should record coupon usage successfully', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(mockCoupon as any);
      jest.spyOn(repository, 'findUsageByOrder').mockResolvedValue(null);
      jest.spyOn(repository, 'recordUsage').mockResolvedValue({} as any);
      jest.spyOn(repository, 'incrementRedemptions').mockResolvedValue(undefined);

      const result = await service.recordUsage(
        {
          couponCode: 'WELCOME50',
          orderId: '507f1f77bcf86cd799439011',
          discountAmount: 50,
        },
        'user123',
      );

      expect(result.success).toBe(true);
      expect(repository.recordUsage).toHaveBeenCalled();
      expect(repository.incrementRedemptions).toHaveBeenCalled();
    });

    it('should throw if coupon not found', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(null);

      await expect(
        service.recordUsage(
          {
            couponCode: 'INVALID',
            orderId: '507f1f77bcf86cd799439011',
            discountAmount: 50,
          },
          'user123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should prevent duplicate recording', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(mockCoupon as any);
      jest.spyOn(repository, 'findUsageByOrder').mockResolvedValue({} as any);

      await expect(
        service.recordUsage(
          {
            couponCode: 'WELCOME50',
            orderId: '507f1f77bcf86cd799439011',
            discountAmount: 50,
          },
          'user123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw if coupon is inactive', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        isActive: false,
      } as any);

      await expect(
        service.recordUsage(
          {
            couponCode: 'WELCOME50',
            orderId: '507f1f77bcf86cd799439011',
            discountAmount: 50,
          },
          'user123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAvailable', () => {
    it('should return list of available coupons', async () => {
      jest
        .spyOn(repository, 'findActiveCoupons')
        .mockResolvedValue([mockCoupon as any]);

      const result = await service.getAvailable();

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('WELCOME50');
      expect(result[0].isActive).toBe(true);
    });

    it('should return empty array on error', async () => {
      jest.spyOn(repository, 'findActiveCoupons').mockRejectedValue(new Error());

      const result = await service.getAvailable();

      expect(result).toEqual([]);
    });
  });

  describe('Security Tests', () => {
    it('should sanitize coupon code', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(mockCoupon as any);

      await service.applyCoupon({
        couponCode: '  welcome50  ', // With spaces
        orderAmount: 200,
      });

      expect(repository.findByCode).toHaveBeenCalledWith('WELCOME50');
    });

    it('should prevent integer overflow', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue(mockCoupon as any);

      const result = await service.applyCoupon({
        couponCode: 'WELCOME50',
        orderAmount: 999_999_999_999, // Large number
      });

      expect(result.originalAmount).toBeLessThanOrEqual(9_999_999);
    });

    it('should validate percentage bounds', async () => {
      jest.spyOn(repository, 'findByCode').mockResolvedValue({
        ...mockCoupon,
        discountType: 'percentage',
        discountPercentage: 150, // Invalid: > 100
      } as any);

      await expect(
        service.applyCoupon({
          couponCode: 'INVALID',
          orderAmount: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
