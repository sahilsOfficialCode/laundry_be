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
            validateBookingEligibility: jest.fn(),
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
      ],
    }).compile();

    return { service: module.get<OrdersService>(OrdersService), savedOrders };
  }

  it('Instant order: deliveryDate = pickupDate + instantTurnaroundMinutes', async () => {
    const { service } = await buildService({
      category: 'instant',
      instantTurnaroundMinutes: 90,
    });

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'instant',
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    const expected = new Date(PICKUP_DATE).getTime() + 90 * 60 * 1000;
    expect(new Date(order.deliveryDate).getTime()).toBe(expected);
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
    const { service } = await buildService({ category: 'instant' });

    const order = await service.checkout('user-1', {
      pickupDate: PICKUP_DATE,
      pickupSlot: 'instant',
      deliveryType: DeliveryType.SELF_PICKUP,
    } as any);

    const expected = new Date(PICKUP_DATE).getTime() + 90 * 60 * 1000;
    expect(new Date(order.deliveryDate).getTime()).toBe(expected);
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
});
