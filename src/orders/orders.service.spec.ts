import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order, DeliveryType, PickupType } from './schemas/order.schema';
import { Cart } from '../cart/schemas/cart.schema';
import { LaundryService } from '../services/schemas/service.schema';
import { StandardTimeSlot } from '../standard-time-slots/schemas/standard-time-slot.schema';
import { LocationsService } from '../locations/locations.service';
import { Location } from '../locations/schemas/location.schema';
import { LocationClosure } from '../locations/schemas/location-closure.schema';
import { LocationAuditLog } from '../locations/schemas/location-audit-log.schema';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SupportEventsService } from '../support/support-events.service';
import { UploadService } from '../upload/upload.service';
import { ClothTypesService } from '../cloth-types/cloth-types.service';
import { ReferralService } from '../referrals/services/referral.service';
import { UsersService } from '../users/users.service';
import { CouponsService } from '../coupons/services/coupons.service';
import { isInstantAvailable } from '../common/instant-availability';

jest.mock('../common/instant-availability', () => ({
  ...jest.requireActual('../common/instant-availability'),
  isInstantAvailable: jest.fn().mockReturnValue(true),
}));

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: {} },
        { provide: getModelToken(Cart.name), useValue: {} },
        { provide: getModelToken(LaundryService.name), useValue: {} },
        { provide: getModelToken(StandardTimeSlot.name), useValue: {} },
        {
          provide: LocationsService,
          useValue: {
            countActiveLocations: jest.fn(),
            validateBookingEligibility: jest.fn(),
          },
        },
        { provide: ServiceZonesService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: SupportEventsService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ClothTypesService, useValue: {} },
        { provide: ReferralService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: CouponsService, useValue: { validateForUser: jest.fn() } },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('OrdersService — checkout delivery-date computation', () => {
  // Fixed "now" so instant-order math (pickup + instantTurnaroundMinutes) is
  // deterministic regardless of when the test runs.
  const PICKUP_DATE = '2026-01-10T10:00:00.000Z';

  /** Builds a fresh OrdersService with a mocked cart/service catalogue, so
   * each test can drive `checkout()` through the real delivery-schedule
   * logic in orders.service.ts without touching a real database. */
  async function buildService(opts: {
    category: 'instant' | 'scheduled';
    turnaroundHours?: number;
    instantTurnaroundMinutes?: number;
  }) {
    const savedOrders: any[] = [];

    // A mock Mongoose model that supports both `new this.orderModel(data)`
    // (order creation) and static methods (`countDocuments`, used by the
    // slot-capacity check).
    function MockOrderModel(this: any, data: any) {
      Object.assign(this, data);
      this.save = jest.fn().mockImplementation(async () => {
        savedOrders.push(this);
        return this;
      });
    }
    (MockOrderModel as any).countDocuments = jest.fn().mockResolvedValue(0);

    const mockCart = {
      items: [
        {
          serviceId: 'service-1',
          quantity: 1,
          category: opts.category,
        },
      ],
    };

    const mockService = {
      _id: 'service-1',
      name: 'Wash & Fold',
      price: 199,
      isAvailable: true,
      turnaroundHours: opts.turnaroundHours ?? 24,
      instantTurnaroundMinutes: opts.instantTurnaroundMinutes ?? 90,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: MockOrderModel },
        {
          provide: getModelToken(Cart.name),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockCart),
            updateOne: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getModelToken(LaundryService.name),
          useValue: {
            findById: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(mockService),
            }),
          },
        },
        {
          provide: getModelToken(StandardTimeSlot.name),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: LocationsService,
          useValue: {
            countActiveLocations: jest.fn().mockResolvedValue(0),
            // Instant orders derive deliveryDate from "now", which only gets
            // computed when a location was actually assigned (see
            // orders.service.ts's resolvedPickupDate) — resolve one so tests
            // that pass pickup coordinates exercise that path.
            validateBookingEligibility: jest.fn().mockResolvedValue({ _id: 'location-1' }),
          },
        },
        {
          provide: ServiceZonesService,
          useValue: { countActive: jest.fn().mockResolvedValue(0), assertCovered: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
            notifyAdmin: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: SupportEventsService, useValue: { emitNewOrder: jest.fn() } },
        { provide: UploadService, useValue: {} },
        { provide: ClothTypesService, useValue: {} },
        { provide: ReferralService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: CouponsService, useValue: { validateForUser: jest.fn() } },
      ],
    }).compile();

    return { service: module.get<OrdersService>(OrdersService), savedOrders };
  }

  // Instant orders anchor deliveryDate to the actual moment of placement
  // (see orders.service.ts's resolvedPickupDate), not the client-sent
  // pickupDate, and only once a location has been assigned — so these tests
  // pin "now" with fake timers and supply pickup coordinates to exercise
  // that path deterministically.
  it('Instant order: deliveryDate = pickupDate + instantTurnaroundMinutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date(PICKUP_DATE));
    try {
      const { service } = await buildService({
        category: 'instant',
        instantTurnaroundMinutes: 90,
      });

      const order = await service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'instant',
        pickupLatitude: 19.076,
        pickupLongitude: 72.8777,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any);

      const expected = new Date(PICKUP_DATE).getTime() + 90 * 60 * 1000;
      expect(new Date(order.deliveryDate).getTime()).toBe(expected);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Scheduled order: deliveryDate = pickupDate + turnaroundHours', async () => {
    const { service } = await buildService({
      category: 'scheduled',
      turnaroundHours: 48,
    });

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day', // in OPEN_SLOT_LABELS — skips the capacity check
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    const expected = new Date(PICKUP_DATE).getTime() + 48 * 60 * 60 * 1000;
    expect(new Date(order.deliveryDate).getTime()).toBe(expected);
  });

  it('Instant order defaults to 90 minutes when the service has no override', async () => {
    jest.useFakeTimers().setSystemTime(new Date(PICKUP_DATE));
    try {
      const { service } = await buildService({ category: 'instant' });

      const order = await service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'instant',
        pickupLatitude: 19.076,
        pickupLongitude: 72.8777,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any);

      const expected = new Date(PICKUP_DATE).getTime() + 90 * 60 * 1000;
      expect(new Date(order.deliveryDate).getTime()).toBe(expected);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Scheduled order defaults to 24 hours when the service has no override', async () => {
    const { service } = await buildService({ category: 'scheduled' });

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day',
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    const expected = new Date(PICKUP_DATE).getTime() + 24 * 60 * 60 * 1000;
    expect(new Date(order.deliveryDate).getTime()).toBe(expected);
  });

  describe('Instant cutoff at checkout', () => {
    afterEach(() => {
      (isInstantAvailable as jest.Mock).mockReturnValue(true);
    });

    it('rejects an Instant checkout after cutoff', async () => {
      (isInstantAvailable as jest.Mock).mockReturnValue(false);
      const { service } = await buildService({ category: 'instant' });

      await expect(
        service.checkout('user-1', {
          pickupDate: PICKUP_DATE,
          pickupSlot: 'instant',
          deliveryType: DeliveryType.SELF_PICKUP,
        } as any),
      ).rejects.toThrow('Instant not available');
    });

    // Regression test: Drop at Shop (and any other flow where the client falls
    // back to a non-"instant" slot label, e.g. because getAvailable() already
    // omitted the Instant slot) must still be rejected. The check has to key
    // off the cart's item category, not the slot label the client happens to
    // send — see orders.service.ts's `orderItems.some(i => i.category === 'instant')`.
    it('rejects an Instant cart after cutoff even when the client sends a non-"instant" slot label', async () => {
      (isInstantAvailable as jest.Mock).mockReturnValue(false);
      const { service } = await buildService({ category: 'instant' });

      await expect(
        service.checkout('user-1', {
          pickupDate: PICKUP_DATE,
          pickupSlot: 'Full Day', // stale-client / FE-fallback label, not 'instant'
          deliveryType: DeliveryType.SELF_PICKUP,
        } as any),
      ).rejects.toThrow('Instant not available');
    });

    it('does not affect scheduled checkout after cutoff', async () => {
      (isInstantAvailable as jest.Mock).mockReturnValue(false);
      const { service } = await buildService({ category: 'scheduled' });

      const order = await service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any);

      expect(order).toBeDefined();
    });

    it('allows an Instant checkout before cutoff', async () => {
      (isInstantAvailable as jest.Mock).mockReturnValue(true);
      const { service } = await buildService({ category: 'instant' });

      const order = await service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'instant',
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any);

      expect(order).toBeDefined();
    });
  });
});

describe('OrdersService — DIRECT_SELECTION (Drop at Shop) location assignment', () => {
  // A syntactically valid Mongo ObjectId — initiateCheckout only treats
  // checkoutContext.locationId as a real preferredLocationId when it passes
  // mongoose's isValidObjectId, matching how a real selected-shop id looks.
  const LOCATION_ID = '507f1f77bcf86cd799439011';
  const PICKUP_DATE = '2026-01-10T10:00:00.000Z';

  async function buildService(locationsOverrides: Record<string, jest.Mock>) {
    function MockOrderModel(this: any, data: any) {
      Object.assign(this, data);
      this.save = jest.fn().mockImplementation(async () => this);
    }
    (MockOrderModel as any).countDocuments = jest.fn().mockResolvedValue(0);

    const mockCart = {
      items: [{ serviceId: 'service-1', quantity: 1, category: 'scheduled' }],
    };
    const mockService = {
      _id: 'service-1',
      name: 'Wash & Fold',
      price: 199,
      isAvailable: true,
      turnaroundHours: 24,
      instantTurnaroundMinutes: 90,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: MockOrderModel },
        {
          provide: getModelToken(Cart.name),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockCart),
            updateOne: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getModelToken(LaundryService.name),
          useValue: {
            findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockService) }),
          },
        },
        { provide: getModelToken(StandardTimeSlot.name), useValue: { findOne: jest.fn() } },
        {
          provide: LocationsService,
          useValue: {
            countActiveLocations: jest.fn().mockResolvedValue(1),
            validateBookingEligibility: jest.fn(),
            validateSelectedLocation: jest.fn(),
            ...locationsOverrides,
          },
        },
        {
          provide: ServiceZonesService,
          useValue: { countActive: jest.fn().mockResolvedValue(0), assertCovered: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
            notifyAdmin: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: SupportEventsService, useValue: { emitNewOrder: jest.fn() } },
        { provide: UploadService, useValue: {} },
        { provide: ClothTypesService, useValue: {} },
        { provide: ReferralService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: CouponsService, useValue: { validateForUser: jest.fn() } },
      ],
    }).compile();

    return module.get<OrdersService>(OrdersService);
  }

  it('assigns exactly the customer-selected locationId — never a geo-resolved fallback', async () => {
    const validateSelectedLocation = jest.fn().mockResolvedValue({
      _id: LOCATION_ID,
      shopName: 'Whitefield Branch',
      fullAddress: '123 Main Rd',
      contactNumber: '9999999999',
      city: 'Bengaluru',
    });
    const service = await buildService({ validateSelectedLocation });

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day',
      serviceType: PickupType.DROP_AT_SHOP,
      locationId: LOCATION_ID,
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    expect(validateSelectedLocation).toHaveBeenCalledWith(LOCATION_ID, expect.any(Object));
    expect(order.locationId).toBe(LOCATION_ID);
    expect(order.locationSnapshot).toMatchObject({ shopName: 'Whitefield Branch' });
  });

  it('requires a locationId for Drop at Shop — rejects instead of falling back to geo-resolution', async () => {
    const validateSelectedLocation = jest.fn();
    const service = await buildService({ validateSelectedLocation });

    await expect(
      service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        serviceType: PickupType.DROP_AT_SHOP,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any),
    ).rejects.toThrow('Please select a branch');
    expect(validateSelectedLocation).not.toHaveBeenCalled();
  });

  it('propagates a branch-ineligibility error instead of silently reassigning to a different branch', async () => {
    const validateSelectedLocation = jest.fn().mockRejectedValue(
      new BadRequestException({ code: 'DAILY_CAPACITY_REACHED', message: 'No more slots available for today' }),
    );
    const service = await buildService({ validateSelectedLocation });

    await expect(
      service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        serviceType: PickupType.DROP_AT_SHOP,
        locationId: LOCATION_ID,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not require pickup coordinates for Drop at Shop, even when active locations exist', async () => {
    const validateSelectedLocation = jest.fn().mockResolvedValue({ _id: LOCATION_ID });
    const service = await buildService({ validateSelectedLocation });

    // No pickupLatitude/pickupLongitude at all — would throw "Service not
    // available in your area" under the old AUTO_ASSIGN-only branching.
    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day',
      serviceType: PickupType.DROP_AT_SHOP,
      locationId: LOCATION_ID,
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    expect(order).toBeDefined();
  });
});

describe('OrdersService + LocationsService — integration (location assignment)', () => {
  // Exercises the real LocationsService (not mocked) underneath OrdersService,
  // so these tests prove the full assignment behavior end-to-end rather than
  // just that OrdersService calls the right method name.
  const PICKUP_DATE = '2026-01-10T10:00:00.000Z';
  const SELECTED_BRANCH_ID = '507f1f77bcf86cd799439011';
  const OTHER_NEARBY_BRANCH_ID = '507f1f77bcf86cd799439099';

  const ALL_DAYS_OPEN = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  ].map((day) => ({ day, isOpen: true, openTime: '00:00', closeTime: '23:59' }));

  const ALL_DAYS_CLOSED = ALL_DAYS_OPEN.map((d) => ({ ...d, isOpen: false }));

  function baseBranch(overrides: Record<string, any> = {}) {
    return {
      _id: SELECTED_BRANCH_ID,
      isActive: true,
      workingSchedule: ALL_DAYS_OPEN,
      pickupSlots: [],
      deliverySlots: [],
      dailyBookingLimit: 0,
      serviceAreaType: 'radius',
      serviceRadiusKm: 50,
      geoPoint: { coordinates: [72.88, 19.08] },
      distanceMeters: 500,
      shopName: 'Test Branch',
      fullAddress: '1 Test Road',
      contactNumber: '9999999999',
      city: 'Mumbai',
      ...overrides,
    };
  }

  /** Builds OrdersService wired to a REAL LocationsService, backed by mocked
   * Mongoose models only — no HTTP layer, no mocked service-layer methods. */
  async function buildIntegrationService(locations: any[], opts: { bookedCount?: number } = {}) {
    function MockOrderModel(this: any, data: any) {
      Object.assign(this, data);
      this.save = jest.fn().mockImplementation(async () => this);
    }
    (MockOrderModel as any).countDocuments = jest.fn().mockResolvedValue(opts.bookedCount ?? 0);

    const locationModel = {
      aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(locations) }),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(locations.length) }),
      findById: jest.fn((id: string) => ({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(
          locations.find((l) => String(l._id) === String(id)) ?? null,
        ),
      })),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(locations),
      }),
    };

    const mockCart = { items: [{ serviceId: 'service-1', quantity: 1, category: 'scheduled' }] };
    const mockService = {
      _id: 'service-1', name: 'Wash & Fold', price: 199, isAvailable: true,
      turnaroundHours: 24, instantTurnaroundMinutes: 90,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        LocationsService, // real implementation — not mocked
        { provide: getModelToken(Order.name), useValue: MockOrderModel },
        {
          provide: getModelToken(Cart.name),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockCart),
            updateOne: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: getModelToken(LaundryService.name),
          useValue: { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(mockService) }) },
        },
        { provide: getModelToken(StandardTimeSlot.name), useValue: { findOne: jest.fn() } },
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
        {
          provide: ServiceZonesService,
          useValue: { countActive: jest.fn().mockResolvedValue(0), assertCovered: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
            notifyAdmin: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: SupportEventsService, useValue: { emitNewOrder: jest.fn() } },
        { provide: UploadService, useValue: {} },
        { provide: ClothTypesService, useValue: {} },
        { provide: ReferralService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: CouponsService, useValue: { validateForUser: jest.fn() } },
      ],
    }).compile();

    return module.get<OrdersService>(OrdersService);
  }

  it('Home Pickup (AUTO_ASSIGN): assigns the nearest eligible branch from address coordinates', async () => {
    const service = await buildIntegrationService([baseBranch()]);

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day',
      serviceType: PickupType.COLLECT_FROM_HOME,
      pickupLatitude: 19.08,
      pickupLongitude: 72.88,
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    expect(order.locationId).toBe(SELECTED_BRANCH_ID);
  });

  it('Drop at Shop (DIRECT_SELECTION): assigns exactly the selected branch, ignoring any other candidate the geo scan would have returned', async () => {
    // A "nearer"/first-in-list branch is present in the candidate pool the
    // aggregate mock would return, but DIRECT_SELECTION must never consult
    // it — this branch existing at all proves assignment isn't geo-derived.
    const otherBranch = baseBranch({ _id: OTHER_NEARBY_BRANCH_ID, shopName: 'Other Branch' });
    const selectedBranch = baseBranch({ shopName: 'Selected Branch' });
    const service = await buildIntegrationService([otherBranch, selectedBranch]);

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day',
      serviceType: PickupType.DROP_AT_SHOP,
      locationId: SELECTED_BRANCH_ID,
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    expect(order.locationId).toBe(SELECTED_BRANCH_ID);
    expect(order.locationSnapshot).toMatchObject({ shopName: 'Selected Branch' });
  });

  it('Drop at Shop: a closed branch is rejected with a typed error, not silently reassigned', async () => {
    const service = await buildIntegrationService([baseBranch({ workingSchedule: ALL_DAYS_CLOSED })]);

    await expect(
      service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        serviceType: PickupType.DROP_AT_SHOP,
        locationId: SELECTED_BRANCH_ID,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any),
    ).rejects.toMatchObject({ response: { code: 'LOCATION_CLOSED_TODAY' } });
  });

  it('Drop at Shop: a branch at daily capacity is rejected with a typed error, not silently reassigned', async () => {
    // dailyBookingLimit: 1 with 1 already booked today → branch reports full.
    const service = await buildIntegrationService(
      [baseBranch({ dailyBookingLimit: 1 })],
      { bookedCount: 1 },
    );

    await expect(
      service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        serviceType: PickupType.DROP_AT_SHOP,
        locationId: SELECTED_BRANCH_ID,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any),
    ).rejects.toMatchObject({ response: { code: 'DAILY_CAPACITY_REACHED' } });
  });

  it('Drop at Shop: an unknown/deleted locationId is rejected with LOCATION_NOT_FOUND, not silently reassigned to another branch', async () => {
    const service = await buildIntegrationService([baseBranch()]);

    await expect(
      service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        serviceType: PickupType.DROP_AT_SHOP,
        locationId: OTHER_NEARBY_BRANCH_ID, // valid ObjectId shape, but not in the location pool
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any),
    ).rejects.toMatchObject({ response: { code: 'LOCATION_NOT_FOUND' } });
  });

  describe('DROP_AT_SHOP_DIRECT_SELECTION kill switch', () => {
    const ORIGINAL_FLAG = process.env.DROP_AT_SHOP_DIRECT_SELECTION;

    afterEach(() => {
      if (ORIGINAL_FLAG === undefined) {
        delete process.env.DROP_AT_SHOP_DIRECT_SELECTION;
      } else {
        process.env.DROP_AT_SHOP_DIRECT_SELECTION = ORIGINAL_FLAG;
      }
    });

    it('falls back to requiring coordinates (pre-rollout AUTO_ASSIGN-only behavior) when disabled', async () => {
      process.env.DROP_AT_SHOP_DIRECT_SELECTION = 'false';
      const service = await buildIntegrationService([baseBranch()]);

      await expect(
        service.checkout('user-1', {
          pickupDate: PICKUP_DATE,
          pickupSlot: 'full day',
          serviceType: PickupType.DROP_AT_SHOP,
          locationId: SELECTED_BRANCH_ID,
          // No coordinates — this is exactly what today's DIRECT_SELECTION
          // path no longer requires, but the disabled flag must revert to
          // needing them, matching pre-rollout behavior.
          deliveryType: DeliveryType.SELF_PICKUP,
        } as any),
      ).rejects.toThrow('Service not available in your area');
    });

    it('still uses DIRECT_SELECTION when re-enabled', async () => {
      process.env.DROP_AT_SHOP_DIRECT_SELECTION = 'true';
      const service = await buildIntegrationService([baseBranch()]);

      const order = await service.checkout('user-1', {
        pickupDate: PICKUP_DATE,
        pickupSlot: 'full day',
        serviceType: PickupType.DROP_AT_SHOP,
        locationId: SELECTED_BRANCH_ID,
        deliveryType: DeliveryType.SELF_PICKUP,
      } as any);

      expect(order.locationId).toBe(SELECTED_BRANCH_ID);
    });
  });

  it('Backward compatibility: an old client sending address + coordinates alongside a Drop at Shop locationId still gets DIRECT_SELECTION, not AUTO_ASSIGN', async () => {
    // Proves new-backend/old-app compatibility: today's app never sends
    // coordinates for Drop at Shop, but if an old cached build did, the
    // branch must still be the customer-selected one, not geo-resolved.
    const otherBranch = baseBranch({ _id: OTHER_NEARBY_BRANCH_ID, shopName: 'Would-be geo match' });
    const selectedBranch = baseBranch({ shopName: 'Selected Branch' });
    const service = await buildIntegrationService([otherBranch, selectedBranch]);

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'full day',
      serviceType: PickupType.DROP_AT_SHOP,
      locationId: SELECTED_BRANCH_ID,
      address: '123 Old Cached Address',
      pickupLatitude: 19.08,
      pickupLongitude: 72.88,
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    expect(order.locationId).toBe(SELECTED_BRANCH_ID);
  });
});

describe('OrdersService — findAssignedToPartner customer contact exposure', () => {
  // Chainable stand-in for Mongoose's find().sort().limit() — resolves to
  // `result` when awaited, regardless of which chain methods are called.
  function chainable<T>(result: T) {
    const chain: any = {
      sort: () => chain,
      limit: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  function makeOrderDoc(fields: Record<string, any>) {
    return {
      ...fields,
      toObject() {
        const { toObject, ...rest } = this;
        return rest;
      },
    };
  }

  it('exposes only { name, phone, address } on `customer`, and formats address with the deliveryAddress → address fallback — never leaking password/wallet/tokens', async () => {
    const activeOrders = [
      // deliveryAddress present → should be preferred over the stale pickup `address`.
      makeOrderDoc({
        _id: 'order-a',
        userId: 'user-1',
        status: 'OUT_FOR_DELIVERY',
        address: 'STALE PICKUP ADDRESS — should not be used',
        deliveryAddress: {
          houseNo: '12',
          buildingName: '',
          street: 'Palm St',
          area: 'Andheri',
          landmark: '',
          city: 'Mumbai',
          state: 'MH',
          pincode: '400001',
        },
      }),
      // no deliveryAddress → falls back to the plain pickup `address` string.
      makeOrderDoc({
        _id: 'order-b',
        userId: 'user-2',
        status: 'OUT_FOR_DELIVERY',
        address: 'Plain pickup address, Pune',
      }),
    ];
    const completedOrders = [
      // neither deliveryAddress nor address → customer.address must be undefined, not throw.
      makeOrderDoc({ _id: 'order-c', userId: 'user-1', status: 'COMPLETED' }),
    ];

    const orderModel: any = {
      find: jest.fn((filter: any) =>
        filter.status === 'COMPLETED' ? chainable(completedOrders) : chainable(activeOrders),
      ),
    };

    // Simulates a `User` document leaking sensitive fields all the way up to
    // this lookup (e.g. a future regression in UsersService.findNamesByIds'
    // `.select()` clause) — the assertions below prove OrdersService's own
    // mapping allowlists only name/mobileNumber regardless.
    const findNamesByIds = jest.fn().mockResolvedValue(
      new Map([
        [
          'user-1',
          {
            name: 'Asha Rao',
            mobileNumber: '9000000001',
            password: '$2b$10$leaked-hash-should-never-appear',
            walletBalance: 500,
            fcmTokens: ['device-token-should-never-appear'],
          } as any,
        ],
        ['user-2', { name: 'Rohit Iyer', mobileNumber: '9000000002' } as any],
      ]),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(Cart.name), useValue: {} },
        { provide: getModelToken(LaundryService.name), useValue: {} },
        { provide: getModelToken(StandardTimeSlot.name), useValue: {} },
        { provide: LocationsService, useValue: {} },
        { provide: ServiceZonesService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: SupportEventsService, useValue: {} },
        { provide: UploadService, useValue: {} },
        { provide: ClothTypesService, useValue: {} },
        { provide: ReferralService, useValue: {} },
        { provide: UsersService, useValue: { findNamesByIds } },
        { provide: CouponsService, useValue: { validateForUser: jest.fn() } },
      ],
    }).compile();

    const service = module.get<OrdersService>(OrdersService);
    const result = await service.findAssignedToPartner('partner-1');

    // Exactly one batched user lookup for both active + completed lists.
    expect(findNamesByIds).toHaveBeenCalledTimes(1);

    expect(result.active[0].customer).toEqual({
      name: 'Asha Rao',
      phone: '9000000001',
      address: '12, Palm St, Andheri, Mumbai, MH, 400001',
    });
    expect(result.active[1].customer).toEqual({
      name: 'Rohit Iyer',
      phone: '9000000002',
      address: 'Plain pickup address, Pune',
    });
    expect(result.completed[0].customer).toEqual({
      name: 'Asha Rao',
      phone: '9000000001',
      address: undefined,
    });

    const forbiddenKeys = ['password', 'walletBalance', 'fcmTokens', 'email', 'sessionsValidFrom'];
    const serialized = JSON.stringify(result);
    for (const key of forbiddenKeys) {
      expect(serialized).not.toContain(key);
    }
    expect(serialized.toLowerCase()).not.toContain('leaked');
    expect(serialized.toLowerCase()).not.toContain('should never appear');
    expect(Object.keys(result.active[0].customer).sort()).toEqual(['address', 'name', 'phone']);
  });
});
