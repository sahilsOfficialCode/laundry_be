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
  INSTANT_ORDER_UNAVAILABLE_MESSAGE: 'Instant not available',
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
    ).rejects.toThrow('Instant not available');
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

describe('LocationsService — validateSelectedLocation (DIRECT_SELECTION mode)', () => {
  let service: LocationsService;
  let locationModel: { findById: jest.Mock };
  let orderModel: { countDocuments: jest.Mock };

  const baseLocation = {
    _id: 'shop-1',
    isActive: true,
    workingSchedule: [],
    pickupSlots: [],
    deliverySlots: [],
    dailyBookingLimit: 0,
    serviceAreaType: 'radius',
    // Deliberately far from any test-supplied coordinate — proves the
    // service-area/distance check is skipped for DIRECT_SELECTION.
    geoPoint: { coordinates: [0, 0] },
    serviceRadiusKm: 1,
  };

  const params = { requestedDate: '2026-07-16' };

  beforeEach(async () => {
    locationModel = { findById: jest.fn() };
    orderModel = { countDocuments: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: getModelToken(Location.name), useValue: locationModel },
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
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(StandardTimeSlot.name), useValue: {} },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);
    (isInstantAvailable as jest.Mock).mockReturnValue(true);
  });

  function mockFoundLocation(location: any) {
    locationModel.findById.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(location),
    });
  }

  it('confirms an eligible, directly-selected branch without any distance check', async () => {
    mockFoundLocation(baseLocation);

    const result = await service.validateSelectedLocation('shop-1', params);

    expect(result).toBeDefined();
    expect(String(result._id)).toBe('shop-1');
  });

  async function expectReasonCode(promise: Promise<any>, code: string) {
    expect.assertions(2);
    try {
      await promise;
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code });
    }
  }

  it('throws LOCATION_NOT_FOUND for an unknown/deleted locationId — never falls back to a different branch', async () => {
    mockFoundLocation(null);
    await expectReasonCode(service.validateSelectedLocation('missing-id', params), 'LOCATION_NOT_FOUND');
  });

  it('throws LOCATION_INACTIVE for an inactive selected branch', async () => {
    mockFoundLocation({ ...baseLocation, isActive: false });
    await expectReasonCode(service.validateSelectedLocation('shop-1', params), 'LOCATION_INACTIVE');
  });

  it('throws DAILY_CAPACITY_REACHED when the branch is full — does not silently reassign', async () => {
    orderModel.countDocuments.mockResolvedValue(5);
    mockFoundLocation({ ...baseLocation, dailyBookingLimit: 5 });
    await expectReasonCode(service.validateSelectedLocation('shop-1', params), 'DAILY_CAPACITY_REACHED');
  });
});
