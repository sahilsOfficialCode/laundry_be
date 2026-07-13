import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OrdersService } from './orders.service';
import { Order, DeliveryType } from './schemas/order.schema';
import { Cart } from '../cart/schemas/cart.schema';
import { LaundryService } from '../services/schemas/service.schema';
import { StandardTimeSlot } from '../standard-time-slots/schemas/standard-time-slot.schema';
import { LocationsService } from '../locations/locations.service';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SupportEventsService } from '../support/support-events.service';
import { UploadService } from '../upload/upload.service';
import { ClothTypesService } from '../cloth-types/cloth-types.service';
import { ReferralService } from '../referrals/services/referral.service';
import { UsersService } from '../users/users.service';
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
