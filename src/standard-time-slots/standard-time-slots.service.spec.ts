import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StandardTimeSlotsService } from './standard-time-slots.service';
import { StandardTimeSlot } from './schemas/standard-time-slot.schema';
import { Order } from '../orders/schemas/order.schema';
import { ServiceAvailabilityService } from '../service-availability/service-availability.service';

describe('StandardTimeSlotsService — Instant availability', () => {
  let service: StandardTimeSlotsService;
  let serviceAvailability: { isInstantAvailable: jest.Mock; isScheduledAvailable: jest.Mock };

  beforeEach(async () => {
    // No admin-created slots for these tests: getAvailable() falls back to
    // the "Full Day" default, and Instant is the only thing under test.
    const findChain = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    serviceAvailability = {
      isInstantAvailable: jest.fn().mockResolvedValue(true),
      isScheduledAvailable: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StandardTimeSlotsService,
        { provide: getModelToken(StandardTimeSlot.name), useValue: findChain },
        {
          provide: getModelToken(Order.name),
          useValue: { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) },
        },
        { provide: ServiceAvailabilityService, useValue: serviceAvailability },
      ],
    }).compile();

    service = module.get<StandardTimeSlotsService>(StandardTimeSlotsService);
  });

  it('includes the Instant slot before cutoff', async () => {
    serviceAvailability.isInstantAvailable.mockResolvedValue(true);

    const result = await service.getAvailable('2026-07-12');

    expect(result.pickupSlots.some((s: any) => s.isInstant)).toBe(true);
    expect(result.deliverySlots.some((s: any) => s.isInstant)).toBe(true);
  });

  it('omits the Instant slot after cutoff', async () => {
    serviceAvailability.isInstantAvailable.mockResolvedValue(false);

    const result = await service.getAvailable('2026-07-12');

    expect(result.pickupSlots.some((s: any) => s.isInstant)).toBe(false);
    expect(result.deliverySlots.some((s: any) => s.isInstant)).toBe(false);
    // Non-Instant behaviour (Full Day fallback) is unaffected.
    expect(result.pickupSlots.some((s: any) => s.label === 'Full Day')).toBe(true);
  });

  it('hides every non-instant slot (including the Full Day fallback) when Scheduled service is disabled', async () => {
    serviceAvailability.isScheduledAvailable.mockResolvedValue(false);

    const result = await service.getAvailable('2026-07-12');

    expect(result.pickupSlots.some((s: any) => s.label === 'Full Day')).toBe(false);
    expect(result.deliverySlots.some((s: any) => s.label === 'Full Day')).toBe(false);
    // Instant is unaffected by the Scheduled toggle.
    expect(result.pickupSlots.some((s: any) => s.isInstant)).toBe(true);
  });
});
