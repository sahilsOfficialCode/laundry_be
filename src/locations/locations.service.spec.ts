import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { Location } from './schemas/location.schema';
import { LocationClosure } from './schemas/location-closure.schema';
import { LocationAuditLog } from './schemas/location-audit-log.schema';
import { Order } from '../orders/schemas/order.schema';
import { StandardTimeSlot } from '../standard-time-slots/schemas/standard-time-slot.schema';
import { isInstantAvailable } from '../common/instant-availability';

jest.mock('../common/instant-availability', () => ({
  isInstantAvailable: jest.fn(),
  INSTANT_ORDER_UNAVAILABLE_MESSAGE:
    "Instant orders are unavailable after today's cutoff time. Please choose a scheduled pickup.",
}));

describe('LocationsService — Instant checkout validation', () => {
  let service: LocationsService;

  const candidateLocation = {
    _id: 'location-1',
    isActive: true,
    workingSchedule: [],
    pickupSlots: [],
    deliverySlots: [],
    dailyBookingLimit: 0,
    serviceAreaType: 'radius',
    geoPoint: { coordinates: [72.8, 19.0] },
    distanceMeters: 1000,
    serviceRadiusKm: 50,
  };

  const bookingPayload = {
    latitude: 19.0,
    longitude: 72.8,
    pickupSlot: 'instant',
    deliverySlot: 'instant',
    requestedDate: '2026-07-12',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: getModelToken(Location.name),
          useValue: {
            aggregate: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([candidateLocation]),
            }),
          },
        },
        {
          provide: getModelToken(LocationClosure.name),
          useValue: {
            findOne: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnThis(),
              exec: jest.fn().mockResolvedValue(null),
            }),
          },
        },
        { provide: getModelToken(LocationAuditLog.name), useValue: {} },
        {
          provide: getModelToken(Order.name),
          useValue: { countDocuments: jest.fn().mockResolvedValue(0) },
        },
        { provide: getModelToken(StandardTimeSlot.name), useValue: {} },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
    jest.clearAllMocks();
  });

  it('Instant checkout succeeds before cutoff', async () => {
    (isInstantAvailable as jest.Mock).mockReturnValue(true);

    const location = await service.validateBookingEligibility(bookingPayload as any);

    expect(location).toBeDefined();
  });

  it('Instant checkout is rejected after cutoff', async () => {
    (isInstantAvailable as jest.Mock).mockReturnValue(false);

    await expect(
      service.validateBookingEligibility(bookingPayload as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.validateBookingEligibility(bookingPayload as any),
    ).rejects.toThrow(
      "Instant orders are unavailable after today's cutoff time. Please choose a scheduled pickup.",
    );
  });

  it('does not affect non-Instant (scheduled) bookings', async () => {
    (isInstantAvailable as jest.Mock).mockReturnValue(false);

    const location = await service.validateBookingEligibility({
      ...bookingPayload,
      pickupSlot: 'full day',
      deliverySlot: 'full day',
    } as any);

    expect(location).toBeDefined();
  });
});
