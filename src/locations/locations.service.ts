import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Location,
  LocationClosure,
  LocationClosureDocument,
  LocationDocument,
  PaymentMethod,
  ServiceAreaType,
  TimeSlot,
} from './schemas/location.schema';
import {
  CreateClosureDto,
  CreateLocationDto,
  UpdateClosureDto,
  UpdateLocationDto,
} from './dto/location.dto';
import { CheckoutServiceType } from '../orders/dto/checkout.dto';
import { Order, OrderDocument } from '../orders/schemas/order.schema';

type Coordinates = { latitude: number; longitude: number };
type SlotWithCapacity = TimeSlot & { remainingCapacity: number };
type EligibleShop = {
  shop: LocationDocument;
  distanceKm: number;
  estimatedPickupTime?: string;
  pickupSlots: SlotWithCapacity[];
  deliverySlots: SlotWithCapacity[];
};

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name) private locationModel: Model<LocationDocument>,
    @InjectModel(LocationClosure.name)
    private closureModel: Model<LocationClosureDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  async create(dto: CreateLocationDto) {
    const location = new this.locationModel(this.toLocationPayload(dto));
    return location.save();
  }

  async findAll(params: {
    city?: string;
    search?: string;
    page?: number;
    limit?: number;
    includeInactive?: boolean;
  }) {
    const page = Number(params.page || 1);
    const limit = Number(params.limit || 20);
    const filter: Record<string, unknown> = {};

    if (!params.includeInactive) filter.isActive = true;
    if (params.city) filter.city = new RegExp(params.city, 'i');
    if (params.search) {
      filter.$or = [
        { shopName: new RegExp(params.search, 'i') },
        { fullAddress: new RegExp(params.search, 'i') },
      ];
    }

    const [items, total] = await Promise.all([
      this.locationModel
        .find(filter)
        .sort({ city: 1, shopName: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.locationModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(id: string, dto: Partial<UpdateLocationDto>) {
    const location = await this.locationModel.findByIdAndUpdate(
      id,
      this.toLocationPayload(dto),
      { new: true, runValidators: true },
    );

    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async setStatus(id: string, isActive: boolean) {
    const location = await this.locationModel.findByIdAndUpdate(
      id,
      { isActive },
      { new: true },
    );

    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  async createClosure(locationId: string, dto: CreateClosureDto) {
    await this.ensureLocation(locationId);
    const closure = new this.closureModel({
      locationId,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      reason: dto.reason,
      note: dto.note,
      isActive: true,
    });
    return closure.save();
  }

  async findClosures(locationId: string) {
    await this.ensureLocation(locationId);
    return this.closureModel.find({ locationId }).sort({ startDate: -1 });
  }

  async updateClosure(locationId: string, closureId: string, dto: UpdateClosureDto) {
    await this.ensureLocation(locationId);
    const payload: Record<string, unknown> = { ...dto };
    if (dto.startDate) payload.startDate = new Date(dto.startDate);
    if (dto.endDate) payload.endDate = new Date(dto.endDate);

    const closure = await this.closureModel.findOneAndUpdate(
      { _id: closureId, locationId },
      payload,
      { new: true, runValidators: true },
    );

    if (!closure) throw new NotFoundException('Closure not found');
    return closure;
  }

  async listAvailableShops(params: {
    latitude?: number;
    longitude?: number;
    date?: string;
  }) {
    const shops = await this.locationModel.find({ isActive: true }).sort({ shopName: 1 });
    const withStatus = await Promise.all(
      shops.map(async (shop) => {
        const distanceKm =
          params.latitude !== undefined && params.longitude !== undefined
            ? this.distanceKm(
                { latitude: params.latitude, longitude: params.longitude },
                this.locationCoordinates(shop),
              )
            : undefined;
        const status = await this.getAvailability(shop, params.date || this.today());

        return {
          shop,
          distanceKm,
          isOpen: status.isOpen,
          unavailableReason: status.reason,
          recommended: false,
        };
      }),
    );

    const available = withStatus
      .filter((entry) => entry.isOpen)
      .sort((a, b) => (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER));

    if (available[0]) available[0].recommended = true;
    return available;
  }

  async findEligibleShop(params: {
    serviceType: CheckoutServiceType;
    latitude: number;
    longitude: number;
    date: string;
  }) {
    const shops = await this.locationModel.find({ isActive: true });
    const eligible: EligibleShop[] = [];

    for (const shop of shops) {
      const distanceKm = this.distanceKm(params, this.locationCoordinates(shop));
      const inServiceArea = this.isInServiceArea(shop, params, distanceKm);
      const availability = await this.getAvailability(shop, params.date);
      const pickupSlots = await this.availableSlots(shop, params.date, 'pickup');
      const deliverySlots = await this.availableSlots(shop, params.date, 'delivery');

      if (inServiceArea && availability.isOpen && pickupSlots.length > 0) {
        eligible.push({
          shop,
          distanceKm,
          estimatedPickupTime: pickupSlots[0].label,
          pickupSlots,
          deliverySlots,
        });
      }
    }

    eligible.sort((a, b) => a.distanceKm - b.distanceKm);
    return eligible[0] || null;
  }

  async getCheckoutOptions(params: {
    serviceType: CheckoutServiceType;
    latitude?: number;
    longitude?: number;
    selectedShopId?: string;
    date: string;
  }) {
    let shop: LocationDocument | null = null;
    let distanceKm: number | undefined;
    let estimatedPickupTime: string | undefined;

    if (params.selectedShopId) {
      shop = await this.locationModel.findById(params.selectedShopId);
      if (!shop || !shop.isActive) throw new BadRequestException('Selected shop is unavailable');
      const availability = await this.getAvailability(shop, params.date);
      if (!availability.isOpen) throw new BadRequestException(availability.reason || 'Shop unavailable');
      if (params.latitude !== undefined && params.longitude !== undefined) {
        distanceKm = this.distanceKm(params as Coordinates, this.locationCoordinates(shop));
      }
    } else if (params.latitude !== undefined && params.longitude !== undefined) {
      const eligible = await this.findEligibleShop({
        serviceType: params.serviceType,
        latitude: params.latitude,
        longitude: params.longitude,
        date: params.date,
      });
      if (!eligible) return null;
      shop = eligible.shop;
      distanceKm = eligible.distanceKm;
      estimatedPickupTime = eligible.estimatedPickupTime;
    }

    if (!shop) throw new BadRequestException('A shop or serviceable address is required');

    const [pickupSlots, deliverySlots] = await Promise.all([
      this.availableSlots(shop, params.date, 'pickup'),
      this.availableSlots(shop, params.date, 'delivery'),
    ]);

    return {
      shop,
      distanceKm,
      estimatedPickupTime: estimatedPickupTime || pickupSlots[0]?.label,
      pickupSlots,
      deliverySlots,
      paymentMethods: shop.enabledPaymentMethods,
    };
  }

  async validateCheckoutContext(params: {
    serviceType: CheckoutServiceType;
    pickupAddress?: Coordinates;
    selectedShopId?: string;
    pickupSlot: TimeSlot & { date: string };
    deliverySlot: TimeSlot & { date: string };
    paymentMethod: PaymentMethod;
  }) {
    const requiresAddress =
      params.serviceType === CheckoutServiceType.COLLECT_FROM_HOME ||
      params.serviceType === CheckoutServiceType.HOME_RECEPTION;

    if (requiresAddress && !params.pickupAddress) {
      throw new BadRequestException('Pickup address is required');
    }

    const options = await this.getCheckoutOptions({
      serviceType: params.serviceType,
      latitude: params.pickupAddress?.latitude,
      longitude: params.pickupAddress?.longitude,
      selectedShopId: params.selectedShopId,
      date: params.pickupSlot.date,
    });

    if (!options) throw new BadRequestException('Service is currently unavailable in your area.');

    if (!options.paymentMethods.includes(params.paymentMethod)) {
      throw new BadRequestException('Payment method is not available for this location');
    }

    await this.assertSlotAvailable(options.shop, params.pickupSlot, 'pickup');
    await this.assertSlotAvailable(options.shop, params.deliverySlot, 'delivery');

    return options;
  }

  private async ensureLocation(locationId: string) {
    const location = await this.locationModel.findById(locationId);
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  private toLocationPayload(dto: Partial<CreateLocationDto>) {
    const payload: Record<string, unknown> = { ...dto };
    if (dto.geoPoint) {
      payload.geoPoint = {
        type: 'Point',
        coordinates: [dto.geoPoint.longitude, dto.geoPoint.latitude],
      };
    }
    if (dto.servicePolygon) {
      payload.servicePolygon = {
        type: 'Polygon',
        coordinates: dto.servicePolygon,
      };
    }
    return payload;
  }

  private async getAvailability(location: LocationDocument, date: string) {
    const day = this.dayKey(date);
    const schedule = location.workingSchedule.find((item) => item.day === day);
    if (!schedule?.isOpen) return { isOpen: false, reason: 'Closed on selected date' };

    const target = this.dateOnly(date);
    const closure = await this.closureModel.findOne({
      locationId: location._id.toString(),
      isActive: true,
      startDate: { $lte: target.end },
      endDate: { $gte: target.start },
    });

    if (closure) return { isOpen: false, reason: closure.reason || 'Temporarily closed' };
    return { isOpen: true };
  }

  private async availableSlots(
    location: LocationDocument,
    date: string,
    type: 'pickup' | 'delivery',
  ): Promise<SlotWithCapacity[]> {
    const source = type === 'pickup' ? location.pickupSlots : location.deliverySlots;
    const usable: SlotWithCapacity[] = [];
    for (const slot of source) {
      const booked = await this.countBookings(location._id.toString(), date, type, slot.label);
      const capacity = slot.capacity || location.dailyBookingLimit;
      if (booked < capacity) {
        usable.push({
          label: slot.label,
          startTime: slot.startTime,
          endTime: slot.endTime,
          capacity: slot.capacity,
          remainingCapacity: capacity - booked,
        });
      }
    }
    return usable;
  }

  private async assertSlotAvailable(
    location: LocationDocument,
    slot: TimeSlot & { date: string },
    type: 'pickup' | 'delivery',
  ) {
    const slots = type === 'pickup' ? location.pickupSlots : location.deliverySlots;
    const configured = slots.find(
      (item) =>
        item.label === slot.label &&
        item.startTime === slot.startTime &&
        item.endTime === slot.endTime,
    );
    if (!configured) throw new BadRequestException(`${type} slot is not configured for this shop`);

    const booked = await this.countBookings(location._id.toString(), slot.date, type, slot.label);
    const capacity = configured.capacity || location.dailyBookingLimit;
    if (booked >= capacity) throw new BadRequestException(`${type} slot is fully booked`);
  }

  private async countBookings(locationId: string, date: string, type: 'pickup' | 'delivery', label: string) {
    return this.orderModel.countDocuments({
      assignedShopId: locationId,
      paymentStatus: { $ne: 'FAILED' },
      [`${type}Slot.date`]: date,
      [`${type}Slot.label`]: label,
    });
  }

  private isInServiceArea(location: LocationDocument, point: Coordinates, distanceKm: number) {
    if (location.serviceAreaType === ServiceAreaType.POLYGON && location.servicePolygon?.coordinates?.[0]) {
      return this.pointInPolygon(
        [point.longitude, point.latitude],
        location.servicePolygon.coordinates[0],
      );
    }

    return distanceKm <= (location.serviceRadiusKm || 0);
  }

  private locationCoordinates(location: LocationDocument): Coordinates {
    const [longitude, latitude] = location.geoPoint.coordinates;
    return { latitude, longitude };
  }

  private distanceKm(a: Coordinates, b: Coordinates) {
    const radius = 6371;
    const dLat = this.toRad(b.latitude - a.latitude);
    const dLon = this.toRad(b.longitude - a.longitude);
    const lat1 = this.toRad(a.latitude);
    const lat2 = this.toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  private pointInPolygon(point: [number, number], polygon: number[][]) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  private toRad(value: number) {
    return (value * Math.PI) / 180;
  }

  private dayKey(date: string) {
    const keys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return keys[new Date(date).getDay()];
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }

  private dateOnly(date: string) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);
    return { start, end };
  }
}
