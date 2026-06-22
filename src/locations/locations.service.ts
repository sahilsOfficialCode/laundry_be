import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreateLocationDto,
  SetLocationStatusDto,
  TimeSlotDto,
  UpdateLocationDto,
} from './dto/location.dto';
import {
  Location,
  LocationDocument,
  ServiceAreaType,
} from './schemas/location.schema';
import {
  LocationClosure,
  LocationClosureDocument,
} from './schemas/location-closure.schema';
import {
  LocationAuditAction,
  LocationAuditLog,
  LocationAuditLogDocument,
} from './schemas/location-audit-log.schema';
import {
  CreateLocationClosureDto,
  UpdateLocationClosureDto,
} from './dto/location-closure.dto';
import { ListLocationsQueryDto } from './dto/list-locations.dto';
import {
  EligibleLocationCheckDto,
  ResolveLocationDto,
} from './dto/resolve-location.dto';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/order.schema';
import {
  endOfDay,
  haversineDistanceKm,
  isPointInsidePolygon,
  isTimeWithinRange,
  startOfDay,
  toDayOfWeek,
} from './utils/location-utils';

type RequestActor = {
  sub: string;
  role: string;
};

type LocationEligibilityReason =
  | 'LOCATION_INACTIVE'
  | 'LOCATION_CLOSED_TODAY'
  | 'LOCATION_CLOSED_THIS_TIME'
  | 'LOCATION_TEMPORARILY_UNAVAILABLE'
  | 'SERVICE_NOT_AVAILABLE_IN_AREA'
  | 'NO_PICKUP_SLOTS_AVAILABLE'
  | 'NO_DELIVERY_SLOTS_AVAILABLE'
  | 'DAILY_CAPACITY_REACHED';

export type LocationValidationMessage = {
  code: LocationEligibilityReason;
  message: string;
};

export type LocationResolutionResult = {
  isEligible: boolean;
  selectedLocation?: any;
  reasons: LocationValidationMessage[];
  suggestions: any[];
};

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name)
    private readonly locationModel: Model<LocationDocument>,
    @InjectModel(LocationClosure.name)
    private readonly locationClosureModel: Model<LocationClosureDocument>,
    @InjectModel(LocationAuditLog.name)
    private readonly locationAuditLogModel: Model<LocationAuditLogDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  async createLocation(dto: CreateLocationDto, actor: RequestActor) {
    const normalized = this.normalizeLocationPayload(dto);
    const created = await this.locationModel.create(normalized);

    await this.logAudit({
      locationId: String(created._id),
      action: LocationAuditAction.CREATED,
      actor,
      after: created.toObject(),
    });

    return created;
  }

  async updateLocation(
    locationId: string,
    dto: UpdateLocationDto,
    actor: RequestActor,
  ) {
    const location = await this.findLocationById(locationId);
    const before = location.toObject();

    const normalized = this.normalizeLocationPayload(dto);
    Object.assign(location, normalized);
    const updated = await location.save();

    await this.logAudit({
      locationId,
      action: LocationAuditAction.UPDATED,
      actor,
      before,
      after: updated.toObject(),
    });

    return updated;
  }

  async setLocationStatus(
    locationId: string,
    dto: SetLocationStatusDto,
    actor: RequestActor,
  ) {
    const location = await this.findLocationById(locationId);
    const before = location.toObject();
    location.isActive = dto.isActive;
    const updated = await location.save();

    await this.logAudit({
      locationId,
      action: dto.isActive
        ? LocationAuditAction.ACTIVATED
        : LocationAuditAction.DEACTIVATED,
      actor,
      before,
      after: updated.toObject(),
    });

    return updated;
  }

  async getLocationById(locationId: string) {
    return this.findLocationById(locationId);
  }

  async listLocations(query: ListLocationsQueryDto) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const limit = Number(query.limit) > 0 ? Number(query.limit) : 20;
    const includeInactive = query.includeInactive === 'true';

    const filter: Record<string, any> = {};
    if (!includeInactive) {
      filter.isActive = true;
    }
    if (query.city?.trim()) {
      filter.city = new RegExp(`^${this.escapeRegex(query.city.trim())}$`, 'i');
    }
    if (query.search?.trim()) {
      const pattern = new RegExp(this.escapeRegex(query.search.trim()), 'i');
      filter.$or = [
        { shopName: pattern },
        { fullAddress: pattern },
        { city: pattern },
      ];
    }

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.locationModel
        .find(filter)
        .sort({ city: 1, shopName: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.locationModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createClosure(
    locationId: string,
    dto: CreateLocationClosureDto,
    actor: RequestActor,
  ) {
    await this.findLocationById(locationId);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (startDate > endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const closure = await this.locationClosureModel.create({
      locationId,
      startDate,
      endDate,
      reason: dto.reason.trim(),
      note: dto.note?.trim(),
      isActive: true,
    });

    await this.logAudit({
      locationId,
      action: LocationAuditAction.CLOSURE_CREATED,
      actor,
      after: closure.toObject(),
    });

    return closure;
  }

  async updateClosure(
    locationId: string,
    closureId: string,
    dto: UpdateLocationClosureDto,
    actor: RequestActor,
  ) {
    await this.findLocationById(locationId);

    const closure = await this.locationClosureModel
      .findOne({ _id: closureId, locationId })
      .exec();
    if (!closure) {
      throw new NotFoundException('Closure not found');
    }

    const before = closure.toObject();

    if (dto.startDate) {
      closure.startDate = new Date(dto.startDate);
    }
    if (dto.endDate) {
      closure.endDate = new Date(dto.endDate);
    }
    if (closure.startDate > closure.endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    if (dto.reason !== undefined) {
      closure.reason = dto.reason.trim();
    }
    if (dto.note !== undefined) {
      closure.note = dto.note?.trim();
    }
    if (dto.isActive !== undefined) {
      closure.isActive = dto.isActive;
    }

    const updated = await closure.save();

    await this.logAudit({
      locationId,
      action: dto.isActive === false
        ? LocationAuditAction.CLOSURE_DEACTIVATED
        : LocationAuditAction.CLOSURE_UPDATED,
      actor,
      before,
      after: updated.toObject(),
    });

    return updated;
  }

  async listClosures(locationId: string) {
    await this.findLocationById(locationId);
    return this.locationClosureModel
      .find({ locationId })
      .sort({ startDate: -1 })
      .lean()
      .exec();
  }

  async listAuditLogs(locationId: string, page = 1, limit = 25) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.locationAuditLogModel
        .find({ locationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.locationAuditLogModel.countDocuments({ locationId }).exec(),
    ]);

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async resolveLocation(payload: ResolveLocationDto): Promise<LocationResolutionResult> {
    const nearestCandidates = await this.fetchNearestCandidates(payload);
    if (nearestCandidates.length === 0) {
      return {
        isEligible: false,
        reasons: [
          {
            code: 'SERVICE_NOT_AVAILABLE_IN_AREA',
            message: 'Service not available in your area',
          },
        ],
        suggestions: [],
      };
    }

    const requestedDate = payload.requestedDate
      ? new Date(payload.requestedDate)
      : new Date();

    const preferredFirst = this.reorderCandidates(
      nearestCandidates,
      payload.preferredLocationId,
    );

    const evaluated = await Promise.all(
      preferredFirst.map((candidate) =>
        this.evaluateLocationEligibility(candidate, payload, requestedDate),
      ),
    );

    const selected = evaluated.find((item) => item.isEligible);
    if (selected) {
      return {
        isEligible: true,
        selectedLocation: selected.location,
        reasons: [],
        suggestions: evaluated
          .filter(
            (item) =>
              item.isEligible &&
              String(item.location._id) !== String(selected.location._id),
          )
          .slice(0, 3)
          .map((item) => item.location),
      };
    }

    const primaryReasons = evaluated[0]?.reasons ?? [
      {
        code: 'SERVICE_NOT_AVAILABLE_IN_AREA',
        message: 'Service not available in your area',
      },
    ];

    return {
      isEligible: false,
      reasons: primaryReasons,
      suggestions: evaluated
        .filter((item) => item.canSuggest)
        .slice(0, 3)
        .map((item) => item.location),
    };
  }

  async validateBookingEligibility(payload: EligibleLocationCheckDto) {
    const resolved = await this.resolveLocation(payload);
    if (!resolved.isEligible || !resolved.selectedLocation) {
      const readable = resolved.reasons[0]?.message ?? 'Booking unavailable';
      throw new BadRequestException(readable);
    }

    return resolved.selectedLocation;
  }

  async countActiveLocations() {
    return this.locationModel.countDocuments({ isActive: true }).exec();
  }

  private normalizeLocationPayload(
    payload: Partial<CreateLocationDto | UpdateLocationDto>,
  ) {
    const next: Record<string, any> = {};

    if (payload.shopName !== undefined) {
      next.shopName = payload.shopName.trim();
    }
    if (payload.city !== undefined) {
      next.city = payload.city.trim();
    }
    if (payload.fullAddress !== undefined) {
      next.fullAddress = payload.fullAddress.trim();
    }
    if (payload.contactNumber !== undefined) {
      next.contactNumber = payload.contactNumber.trim();
    }
    if (payload.geoPoint) {
      this.validateBranchCoordinates(payload.geoPoint);
      next.geoPoint = {
        type: 'Point',
        coordinates: [payload.geoPoint.longitude, payload.geoPoint.latitude],
      };
    }
    if (payload.serviceAreaType !== undefined) {
      next.serviceAreaType = payload.serviceAreaType;
    }
    if (payload.serviceRadiusKm !== undefined) {
      next.serviceRadiusKm = payload.serviceRadiusKm;
    }
    if (payload.servicePolygon !== undefined) {
      next.servicePolygon = this.normalizePolygon(payload.servicePolygon);
    }
    const maybeIsActive = (payload as any).isActive;
    if (maybeIsActive !== undefined) {
      next.isActive = maybeIsActive;
    }
    if (payload.timezone !== undefined) {
      next.timezone = payload.timezone;
    }
    if (payload.workingSchedule !== undefined) {
      next.workingSchedule = this.normalizeWorkingSchedule(payload.workingSchedule);
    }
    if (payload.pickupSlots !== undefined) {
      next.pickupSlots = this.normalizeSlots(payload.pickupSlots);
    }
    if (payload.deliverySlots !== undefined) {
      next.deliverySlots = this.normalizeSlots(payload.deliverySlots);
    }
    if (payload.dailyBookingLimit !== undefined) {
      next.dailyBookingLimit = payload.dailyBookingLimit;
    }
    if (payload.pricingProfileKey !== undefined) {
      next.pricingProfileKey = payload.pricingProfileKey?.trim();
    }
    if (payload.supportedServiceIds !== undefined) {
      next.supportedServiceIds = payload.supportedServiceIds.map((item) => item.trim());
    }
    if (payload.enabledPaymentMethods !== undefined) {
      next.enabledPaymentMethods = payload.enabledPaymentMethods.map((item) => item.trim());
    }

    this.validateServiceAreaConsistency(next);
    return next;
  }

  private validateBranchCoordinates(geoPoint: {
    latitude?: number;
    longitude?: number;
  }) {
    if (geoPoint.latitude === undefined || geoPoint.latitude === null) {
      throw new BadRequestException('geoPoint.latitude is required');
    }

    if (geoPoint.longitude === undefined || geoPoint.longitude === null) {
      throw new BadRequestException('geoPoint.longitude is required');
    }

    if (
      typeof geoPoint.latitude !== 'number' ||
      !Number.isFinite(geoPoint.latitude)
    ) {
      throw new BadRequestException('geoPoint.latitude must be a finite number');
    }

    if (
      typeof geoPoint.longitude !== 'number' ||
      !Number.isFinite(geoPoint.longitude)
    ) {
      throw new BadRequestException('geoPoint.longitude must be a finite number');
    }

    if (geoPoint.latitude === 0 && geoPoint.longitude === 0) {
      throw new BadRequestException(
        'geoPoint coordinates cannot be [0,0] for a branch location',
      );
    }
  }

  private validateServiceAreaConsistency(next: Record<string, any>) {
    if (next.serviceAreaType === ServiceAreaType.RADIUS && !next.serviceRadiusKm) {
      throw new BadRequestException('serviceRadiusKm is required for radius type');
    }

    if (next.serviceAreaType === ServiceAreaType.POLYGON && !next.servicePolygon) {
      throw new BadRequestException('servicePolygon is required for polygon type');
    }
  }

  private normalizePolygon(polygon: number[][][]) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      throw new BadRequestException('servicePolygon must contain polygon rings');
    }

    const ring = polygon[0];
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new BadRequestException('servicePolygon outer ring must have at least 4 points');
    }

    const closedRing = [...ring.map((point) => [Number(point[0]), Number(point[1])])];
    const first = closedRing[0];
    const last = closedRing[closedRing.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      closedRing.push([first[0], first[1]]);
    }

    return {
      type: 'Polygon' as const,
      coordinates: [closedRing],
    };
  }

  private normalizeWorkingSchedule(schedule: any[]) {
    const dayMap = new Map<string, any>();
    for (const item of schedule) {
      if (dayMap.has(item.day)) {
        throw new BadRequestException(`Duplicate schedule for day ${item.day}`);
      }

      if (item.isOpen) {
        if (!item.openTime || !item.closeTime) {
          throw new BadRequestException(
            `openTime and closeTime are required for open day ${item.day}`,
          );
        }

        if (item.openTime >= item.closeTime) {
          throw new BadRequestException(
            `openTime must be before closeTime for day ${item.day}`,
          );
        }
      }

      dayMap.set(item.day, item);
    }

    return Array.from(dayMap.values());
  }

  private normalizeSlots(slots: TimeSlotDto[]) {
    const labels = new Set<string>();
    const normalized = slots.map((slot) => {
      const key = slot.label.trim().toLowerCase();
      if (labels.has(key)) {
        throw new BadRequestException(`Duplicate slot label: ${slot.label}`);
      }
      labels.add(key);

      if (slot.startTime >= slot.endTime) {
        throw new BadRequestException(
          `slot startTime must be before endTime for ${slot.label}`,
        );
      }

      return {
        label: slot.label.trim(),
        startTime: slot.startTime,
        endTime: slot.endTime,
        capacity: slot.capacity,
      };
    });

    return normalized;
  }

  private async evaluateLocationEligibility(
    candidate: any,
    payload: ResolveLocationDto,
    requestedDate: Date,
  ) {
    const reasons: LocationValidationMessage[] = [];

    if (!candidate.isActive) {
      reasons.push({
        code: 'LOCATION_INACTIVE',
        message: 'Branch temporarily unavailable',
      });
    }

    const day = toDayOfWeek(requestedDate);
    const schedule = (candidate.workingSchedule || []).find((item: any) => item.day === day);
    if (!schedule || !schedule.isOpen) {
      reasons.push({
        code: 'LOCATION_CLOSED_TODAY',
        message: 'Location closed today',
      });
    } else if (
      payload.requestedTime &&
      schedule.openTime &&
      schedule.closeTime &&
      !isTimeWithinRange(payload.requestedTime, schedule.openTime, schedule.closeTime)
    ) {
      reasons.push({
        code: 'LOCATION_CLOSED_THIS_TIME',
        message: 'Location is closed at selected time',
      });
    }

    const closure = await this.locationClosureModel
      .findOne({
        locationId: String(candidate._id),
        isActive: true,
        startDate: { $lte: endOfDay(requestedDate) },
        endDate: { $gte: startOfDay(requestedDate) },
      })
      .lean()
      .exec();

    if (closure) {
      reasons.push({
        code: 'LOCATION_TEMPORARILY_UNAVAILABLE',
        message: 'Branch temporarily unavailable',
      });
    }

    const inServiceArea = this.isPointInsideServiceArea(candidate, payload.latitude, payload.longitude);
    if (!inServiceArea) {
      reasons.push({
        code: 'SERVICE_NOT_AVAILABLE_IN_AREA',
        message: 'Service not available in your area',
      });
    }

    if (payload.pickupSlot) {
      const hasPickupSlot = (candidate.pickupSlots || []).some(
        (slot: any) => slot.label === payload.pickupSlot,
      );
      if (!hasPickupSlot) {
        reasons.push({
          code: 'NO_PICKUP_SLOTS_AVAILABLE',
          message: 'No pickup slots available',
        });
      }
    }

    if (payload.deliverySlot) {
      const hasDeliverySlot = (candidate.deliverySlots || []).some(
        (slot: any) => slot.label === payload.deliverySlot,
      );
      if (!hasDeliverySlot) {
        reasons.push({
          code: 'NO_DELIVERY_SLOTS_AVAILABLE',
          message: 'No pickup slots available',
        });
      }
    }

    const dayStart = startOfDay(requestedDate);
    const dayEnd = endOfDay(requestedDate);
    const bookedCount = await this.orderModel.countDocuments({
      locationId: String(candidate._id),
      pickupDate: { $gte: dayStart, $lte: dayEnd },
      status: { $ne: OrderStatus.CANCELLED },
    });

    if (bookedCount >= (candidate.dailyBookingLimit || 0)) {
      reasons.push({
        code: 'DAILY_CAPACITY_REACHED',
        message: 'No pickup slots available',
      });
    }

    if (payload.pickupSlot) {
      const matchedSlot = (candidate.pickupSlots || []).find(
        (slot: any) => slot.label === payload.pickupSlot,
      );
      if (matchedSlot?.capacity) {
        const slotBookedCount = await this.orderModel.countDocuments({
          locationId: String(candidate._id),
          pickupDate: { $gte: dayStart, $lte: dayEnd },
          pickupSlot: payload.pickupSlot,
          status: { $ne: OrderStatus.CANCELLED },
        });

        if (slotBookedCount >= matchedSlot.capacity) {
          reasons.push({
            code: 'NO_PICKUP_SLOTS_AVAILABLE',
            message: 'No pickup slots available',
          });
        }
      }
    }

    return {
      location: {
        ...candidate,
        remainingCapacity: Math.max(0, (candidate.dailyBookingLimit || 0) - bookedCount),
      },
      reasons,
      isEligible: reasons.length === 0,
      canSuggest:
        candidate.isActive &&
        reasons.every((reason) => reason.code !== 'SERVICE_NOT_AVAILABLE_IN_AREA'),
    };
  }

  private isPointInsideServiceArea(
    location: any,
    latitude: number,
    longitude: number,
  ) {
    if (location.serviceAreaType === ServiceAreaType.RADIUS) {
      const [lng, lat] = location.geoPoint?.coordinates || [];
      if (lat == null || lng == null || !location.serviceRadiusKm) {
        return false;
      }

      const distanceKm = haversineDistanceKm(latitude, longitude, lat, lng);
      return distanceKm <= location.serviceRadiusKm;
    }

    const ring = location.servicePolygon?.coordinates?.[0];
    if (!ring || !Array.isArray(ring)) {
      return false;
    }

    return isPointInsidePolygon(longitude, latitude, ring);
  }

  private async fetchNearestCandidates(payload: ResolveLocationDto) {
    const query: Record<string, any> = { isActive: true };
    if (payload.city?.trim()) {
      query.city = new RegExp(`^${this.escapeRegex(payload.city.trim())}$`, 'i');
    }

    const maxDistanceMeters =
      (payload.searchRadiusKm && payload.searchRadiusKm > 0
        ? payload.searchRadiusKm
        : 50) * 1000;

    const point = {
      type: 'Point' as const,
      coordinates: [payload.longitude, payload.latitude] as [number, number],
    };

    const nearest = await this.locationModel
      .aggregate([
        {
          $geoNear: {
            near: point,
            distanceField: 'distanceMeters',
            spherical: true,
            key: 'geoPoint',
            maxDistance: maxDistanceMeters,
            query,
          },
        },
        { $limit: 40 },
      ])
      .exec();

    return nearest;
  }

  private reorderCandidates(candidates: any[], preferredLocationId?: string) {
    if (!preferredLocationId) {
      return candidates;
    }

    const preferred = candidates.find(
      (item) => String(item._id) === preferredLocationId,
    );
    if (!preferred) {
      return candidates;
    }

    return [
      preferred,
      ...candidates.filter((item) => String(item._id) !== preferredLocationId),
    ];
  }

  private async findLocationById(locationId: string) {
    const location = await this.locationModel.findById(locationId).exec();
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location;
  }

  private async logAudit(params: {
    locationId: string;
    action: LocationAuditAction;
    actor: RequestActor;
    before?: Record<string, any>;
    after?: Record<string, any>;
  }) {
    await this.locationAuditLogModel.create({
      locationId: params.locationId,
      action: params.action,
      actorId: params.actor.sub,
      actorRole: params.actor.role,
      before: params.before,
      after: params.after,
    });
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
