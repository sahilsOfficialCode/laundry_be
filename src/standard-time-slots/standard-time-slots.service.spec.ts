import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StandardTimeSlotsService } from './standard-time-slots.service';
import { StandardTimeSlot } from './schemas/standard-time-slot.schema';
import { Order } from '../orders/schemas/order.schema';
import { isInstantAvailable } from '../common/instant-availability';

jest.mock('../common/instant-availability', () => ({
  isInstantAvailable: jest.fn(),
}));

describe('StandardTimeSlotsService — Instant availability', () => {
  let service: StandardTimeSlotsService;

  beforeEach(async () => {
    // No admin-created slots for these tests: getAvailable() falls back to
    // the "Full Day" default, and Instant is the only thing under test.
    const findChain = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StandardTimeSlotsService,
        { provide: getModelToken(StandardTimeSlot.name), useValue: findChain },
        {
          provide: getModelToken(Order.name),
          useValue: { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) },
        },
      ],
    }).compile();

    service = module.get<StandardTimeSlotsService>(StandardTimeSlotsService);
    jest.clearAllMocks();
  });

  it('includes the Instant slot before cutoff', async () => {
    (isInstantAvailable as jest.Mock).mockReturnValue(true);

    const result = await service.getAvailable('2026-07-12');

    expect(result.pickupSlots.some((s: any) => s.isInstant)).toBe(true);
    expect(result.deliverySlots.some((s: any) => s.isInstant)).toBe(true);
  });

  it('omits the Instant slot after cutoff', async () => {
    (isInstantAvailable as jest.Mock).mockReturnValue(false);

    const result = await service.getAvailable('2026-07-12');

    expect(result.pickupSlots.some((s: any) => s.isInstant)).toBe(false);
    expect(result.deliverySlots.some((s: any) => s.isInstant)).toBe(false);
    // Non-Instant behaviour (Full Day fallback) is unaffected.
    expect(result.pickupSlots.some((s: any) => s.label === 'Full Day')).toBe(true);
  });
});
