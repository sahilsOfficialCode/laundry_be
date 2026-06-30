import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OrdersService } from './orders.service';
import { Order } from './schemas/order.schema';
import { Cart } from '../cart/schemas/cart.schema';
import { LaundryService } from '../services/schemas/service.schema';
import { LocationsService } from '../locations/locations.service';
import { StandardTimeSlot } from '../standard-time-slots/schemas/standard-time-slot.schema';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { CloudflareImagesService } from './services/cloudflare-images.service';

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
        { provide: CloudflareImagesService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
