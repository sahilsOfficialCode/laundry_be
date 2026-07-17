import * as https from 'https';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
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
import { GeocodeCandidate, GeocodeQueryDto } from './dto/geocode.dto';
import { LocationImportResult, LocationImportRow } from './dto/import-location.dto';
import {
  EligibleLocationCheckDto,
  ResolveLocationDto,
} from './dto/resolve-location.dto';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/order.schema';
import {
  StandardTimeSlot,
  StandardTimeSlotDocument,
} from '../standard-time-slots/schemas/standard-time-slot.schema';
import {
  endOfDay,
  haversineDistanceKm,
  isPointInsidePolygon,
  isTimeWithinRange,
  startOfDay,
  toDayOfWeek,
} from './utils/location-utils';
import {
  INSTANT_ORDER_UNAVAILABLE_MESSAGE,
  isInstantAvailable,
} from '../common/instant-availability';

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
  | 'DAILY_CAPACITY_REACHED'
  | 'INSTANT_ORDERS_UNAVAILABLE'
  | 'LOCATION_NOT_FOUND';

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

/**
 * How a location was arrived at for eligibility checking — controls whether
 * the service-area/distance check applies, not just a loose boolean flag.
 *
 * AUTO_ASSIGN: the candidate came from resolveLocation's $geoNear scan (Home
 * Pickup/Reception/Delivery) — distance from the customer's coordinates is a
 * real eligibility requirement.
 *
 * DIRECT_SELECTION: the customer explicitly chose this exact location (Drop
 * at Shop) or it's being listed in a coordinate-less browse-all context —
 * distance is not applicable, every other check (active/open/slots/capacity)
 * still is.
 */
export enum LocationAssignmentMode {
  AUTO_ASSIGN = 'AUTO_ASSIGN',
  DIRECT_SELECTION = 'DIRECT_SELECTION',
}

@Injectable()
export class LocationsService implements OnModuleInit {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    @InjectModel(Location.name)
    private readonly locationModel: Model<LocationDocument>,
    @InjectModel(LocationClosure.name)
    private readonly locationClosureModel: Model<LocationClosureDocument>,
    @InjectModel(LocationAuditLog.name)
    private readonly locationAuditLogModel: Model<LocationAuditLogDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(StandardTimeSlot.name)
    private readonly standardSlotModel: Model<StandardTimeSlotDocument>,
  ) {}

  /**
   * Admin-managed standard slots (added dynamically via the admin portal)
   * are valid at every branch — location-level slot lists only restrict
   * further when the label is not a known standard slot.
   */
  private async isActiveStandardSlot(slotKey: string): Promise<boolean> {
    const escaped = slotKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const slot = await this.standardSlotModel
      .findOne({
        isActive: true,
        label: { $regex: `^${escaped}$`, $options: 'i' },
      })
      .lean()
      .exec();
    return !!slot;
  }

  /**
   * Ensure the 2dsphere index on geoPoint exists at startup.
   * Mongoose defines it in the schema but does NOT create it automatically
   * when the collection already exists (e.g. legacy data or autoIndex:false).
   * Without this index every $geoNear aggregation throws MongoError code 291.
   */
  async onModuleInit() {
    try {
      await this.locationModel.syncIndexes();
      this.logger.log('Location indexes synced (2dsphere on geoPoint confirmed)');
    } catch (err: any) {
      this.logger.error(
        'Failed to sync location indexes — $geoNear queries will fail. ' +
        'Run: db.locations.createIndex({ geoPoint: "2dsphere" }) manually.',
        err?.message,
      );
    }
  }

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

  /**
   * DIRECT_SELECTION assignment mode (Drop at Shop): confirms the branch the
   * customer explicitly chose is usable (active, open, has slots, under
   * capacity) — never a different, geographically-nearer one.
   *
   * INVARIANT: for a DIRECT_SELECTION order, the assigned location must
   * always equal the customer-selected locationId. This method either
   * returns that exact location or throws a typed { code, message } error
   * naming the specific reason (LOCATION_NOT_FOUND / LOCATION_INACTIVE /
   * DAILY_CAPACITY_REACHED / etc.) so the caller can send the customer back
   * to branch selection. It must never silently substitute or fall back to
   * a different location — do not add auto-reassignment logic here.
   */
  async validateSelectedLocation(
    locationId: string,
    params: {
      requestedDate: string;
      requestedTime?: string;
      pickupSlot?: string;
      deliverySlot?: string;
    },
  ) {
    const location = await this.locationModel.findById(locationId).lean().exec();
    if (!location) {
      throw new BadRequestException({
        code: 'LOCATION_NOT_FOUND',
        message: 'Selected branch could not be found.',
      });
    }

    const requestedDate = new Date(params.requestedDate);
    const evaluated = await this.evaluateLocationEligibility(
      location,
      {
        requestedTime: params.requestedTime,
        pickupSlot: params.pickupSlot,
        deliverySlot: params.deliverySlot,
      },
      requestedDate,
      LocationAssignmentMode.DIRECT_SELECTION,
    );

    if (evaluated.reasons.length > 0) {
      const reason = evaluated.reasons[0];
      // Log-based analytics (see PaymentAlertsService for the same
      // pattern) — no analytics SDK exists in this project yet; this is a
      // grep-able line any log pipeline can aggregate by `code` to answer
      // "how often is Drop-at-Shop blocked, and why" without new infra.
      this.logger.warn(
        JSON.stringify({
          event: 'LOCATION_UNAVAILABLE',
          code: reason.code,
          locationId,
          timestamp: new Date().toISOString(),
        }),
      );
      throw new BadRequestException({ code: reason.code, message: reason.message });
    }

    return evaluated.location;
  }

  /**
   * Returns today's booking usage for a location:
   *   { limit, usedToday, remainingToday, isUnlimited }
   * Used by the admin panel to show capacity at a glance.
   */
  async getCapacityStats(locationId: string, date: string) {
    const location = await this.findLocationById(locationId);
    const requestedDate = date ? new Date(date) : new Date();
    const dayStart = startOfDay(requestedDate);
    const dayEnd   = endOfDay(requestedDate);

    const usedToday = await this.orderModel.countDocuments({
      locationId,
      pickupDate: { $gte: dayStart, $lte: dayEnd },
      status: { $ne: 'CANCELLED' },
    });

    const limit = location.dailyBookingLimit ?? 0;
    const isUnlimited = limit === 0;

    return {
      locationId,
      date: requestedDate.toISOString().slice(0, 10),
      limit,
      usedToday,
      remainingToday: isUnlimited ? null : Math.max(0, limit - usedToday),
      isUnlimited,
      isFull: !isUnlimited && usedToday >= limit,
    };
  }

  // ── Serviceability endpoint ────────────────────────────────────────────────

  /**
   * Returns the nearest eligible location's slots and payment methods for
   * the given coordinates/date. Used by the frontend checkout flow.
   *
   * preferredLocationId: when supplied, that branch is evaluated first so its
   * slots are returned even when it is not the geographically nearest one.
   * Used by the "Drop at Shop" flow after the user selects a specific branch.
   */
  async getServiceability(
    latitude: number,
    longitude: number,
    date: string,
    city?: string,
    preferredLocationId?: string,
  ) {
    const resolved = await this.resolveLocation({
      latitude,
      longitude,
      city,
      requestedDate: date,
      preferredLocationId,
    });

    const loc = resolved.selectedLocation;
    if (!loc) {
      const firstReason = resolved.reasons[0];
      const reasonCode = firstReason?.code ?? 'SERVICE_NOT_AVAILABLE_IN_AREA';

      // When the shop EXISTS but is temporarily unavailable (capacity reached,
      // closed today, etc.), include basic shop info so the frontend can still
      // enable "Proceed to Pay". The backend will re-validate at order creation.
      // Do NOT include the shop when the user is simply outside any service area.
      const nearestSuggestion = resolved.suggestions?.[0];
      const nearestShop = reasonCode !== 'SERVICE_NOT_AVAILABLE_IN_AREA' && nearestSuggestion
        ? {
            _id:           String(nearestSuggestion._id),
            shopName:      nearestSuggestion.shopName,
            fullAddress:   nearestSuggestion.fullAddress,
            city:          nearestSuggestion.city,
            contactNumber: nearestSuggestion.contactNumber ?? null,
            isOpen:        false,
            recommended:   false,
          }
        : null;

      return {
        eligible: false,
        reasonCode,
        reason: firstReason?.message ?? 'No laundry service is available at your address yet',
        ...(nearestShop && { nearestShop }),
      };
    }

    const adminPickupSlots = (loc.pickupSlots || []).map((s: any) => ({
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      remainingCapacity: s.capacity ?? null,
    }));

    const adminDeliverySlots = (loc.deliverySlots || []).map((s: any) => ({
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      remainingCapacity: s.capacity ?? null,
    }));

    // This endpoint (checkout's slot/payment options) has its own slot list
    // separate from standard-time-slots.service.ts's — it wasn't injecting
    // the Instant meta-slot at all, so Instant carts never saw an Instant
    // option here regardless of INSTANT_ORDER_CUTOFF_TIME. Mirror the same
    // cutoff-gated injection used there.
    const instantSlot = isInstantAvailable()
      ? [{
          _id: 'instant',
          label: 'Instant',
          startTime: null,
          endTime: null,
          remainingCapacity: null,
          isInstant: true,
        }]
      : [];

    const pickupSlots = [...instantSlot, ...adminPickupSlots];
    const deliverySlots = [...instantSlot, ...adminDeliverySlots];

    const paymentMethods: string[] =
      (loc.enabledPaymentMethods || []).length > 0
        ? loc.enabledPaymentMethods
        : ['upi', 'credit_card', 'debit_card', 'net_banking', 'cash_on_delivery'];

    return {
      shop: {
        _id: String(loc._id),
        shopName: loc.shopName,
        fullAddress: loc.fullAddress,
        city: loc.city,
        contactNumber: loc.contactNumber,
        distanceKm: loc.distanceMeters != null
          ? +(loc.distanceMeters / 1000).toFixed(2)
          : null,
        isOpen: true,
        recommended: true,
      },
      distanceKm: loc.distanceMeters != null
        ? +(loc.distanceMeters / 1000).toFixed(2)
        : null,
      estimatedPickupTime: '2–3 hrs',
      pickupSlots,
      deliverySlots,
      paymentMethods,
    };
  }

  /**
   * Returns a list of active shops, ordered by distance when coordinates are
   * supplied. Used by the frontend's "Drop at Shop" flow.
   *
   * latitude/longitude are optional: a customer with no saved address and no
   * GPS permission can still browse every active shop (sorted by name,
   * optionally narrowed by city) and pick one directly — DIRECT_SELECTION
   * assignment mode doesn't require distance at all, so shop *discovery*
   * shouldn't either.
   */
  async getNearbyShops(
    latitude: number | undefined,
    longitude: number | undefined,
    date: string,
    city?: string,
  ) {
    const hasCoordinates = latitude != null && longitude != null;

    const candidates = hasCoordinates
      ? await this.fetchNearestCandidates({ latitude, longitude, city, requestedDate: date })
      : await this.fetchAllActiveCandidates(city);

    const requestedDate = new Date(date);

    const results = await Promise.all(
      candidates.map(async (loc) => {
        const eval_ = await this.evaluateLocationEligibility(
          loc,
          { latitude, longitude, requestedDate: date },
          requestedDate,
          // No coordinates → browse-all listing, same "distance doesn't
          // apply" reasoning as a DIRECT_SELECTION checkout.
          hasCoordinates ? LocationAssignmentMode.AUTO_ASSIGN : LocationAssignmentMode.DIRECT_SELECTION,
        );
        const isOpen = eval_.reasons.every(
          (r) => r.code !== 'LOCATION_INACTIVE' &&
                  r.code !== 'LOCATION_CLOSED_TODAY' &&
                  r.code !== 'LOCATION_TEMPORARILY_UNAVAILABLE',
        );
        // GeoJSON stores coordinates as [longitude, latitude]
        const [shopLng, shopLat] = loc.geoPoint?.coordinates ?? [null, null];
        return {
          shop: {
            _id: String(loc._id),
            shopName: loc.shopName,
            fullAddress: loc.fullAddress,
            city: loc.city,
            contactNumber: loc.contactNumber,
            // Expose shop coordinates so the frontend can use them for
            // Drop at Shop slot loading (avoids service-area blocking walk-ins).
            latitude: shopLat ?? null,
            longitude: shopLng ?? null,
          },
          distanceKm: loc.distanceMeters != null
            ? +(loc.distanceMeters / 1000).toFixed(2)
            : null,
          isOpen,
          recommended: eval_.isEligible,
          unavailableReason: isOpen ? null : eval_.reasons[0]?.message,
        };
      }),
    );

    return hasCoordinates
      ? results.slice(0, 10)
      : results.sort((a, b) => a.shop.shopName.localeCompare(b.shop.shopName)).slice(0, 40);
  }

  /** Browse-all fallback for getNearbyShops when no coordinates are supplied. */
  private async fetchAllActiveCandidates(city?: string) {
    const query: Record<string, any> = { isActive: true };
    if (city?.trim()) {
      query.city = new RegExp(`^${this.escapeRegex(city.trim())}$`, 'i');
    }
    return this.locationModel
      .find(query)
      .sort({ shopName: 1 })
      .limit(40)
      .lean()
      .exec();
  }

  // ── Bulk import from JSON file ─────────────────────────────────────────────

  async bulkImportFromJson(
    fileBuffer: Buffer,
    actor: RequestActor,
  ): Promise<LocationImportResult> {
    let rows: unknown;
    try {
      rows = JSON.parse(fileBuffer.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON — could not parse uploaded file');
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException(
        'JSON file must contain a non-empty array of location objects',
      );
    }

    const result: LocationImportResult = { imported: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as LocationImportRow;
      try {
        this.validateImportRow(row, i + 1);
        const dto = this.importRowToCreateDto(row);
        await this.createLocation(dto as any, actor);
        result.imported++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: i + 1,
          shopName: (row as any)?.shopName,
          reason: err?.message ?? 'Unknown error',
        });
      }
    }

    return result;
  }

  private validateImportRow(row: LocationImportRow, rowNum: number) {
    const miss: string[] = [];
    if (!row.shopName?.trim()) miss.push('shopName');
    if (!row.city?.trim()) miss.push('city');
    if (!row.fullAddress?.trim()) miss.push('fullAddress');
    if (!row.contactNumber?.trim()) miss.push('contactNumber');
    if (row.latitude == null || !Number.isFinite(Number(row.latitude))) miss.push('latitude');
    if (row.longitude == null || !Number.isFinite(Number(row.longitude))) miss.push('longitude');

    if (miss.length) {
      throw new BadRequestException(
        `Row ${rowNum}: missing or invalid fields: ${miss.join(', ')}`,
      );
    }

    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (lat === 0 && lng === 0) {
      throw new BadRequestException(`Row ${rowNum}: coordinates cannot be [0,0]`);
    }

    const areaType = row.serviceAreaType ?? 'radius';
    if (areaType === 'radius' && !row.serviceRadiusKm) {
      throw new BadRequestException(
        `Row ${rowNum}: serviceRadiusKm is required for radius type`,
      );
    }
    if (areaType === 'polygon' && !row.servicePolygon) {
      throw new BadRequestException(
        `Row ${rowNum}: servicePolygon is required for polygon type`,
      );
    }
  }

  private importRowToCreateDto(row: LocationImportRow) {
    return {
      shopName: row.shopName.trim(),
      city: row.city.trim(),
      fullAddress: row.fullAddress.trim(),
      contactNumber: row.contactNumber.trim(),
      geoPoint: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
      },
      serviceAreaType: row.serviceAreaType ?? 'radius',
      serviceRadiusKm: row.serviceRadiusKm,
      servicePolygon: row.servicePolygon,
      timezone: row.timezone ?? 'Asia/Kolkata',
      dailyBookingLimit: row.dailyBookingLimit ?? 200,
      isActive: row.isActive ?? true,
      pricingProfileKey: row.pricingProfileKey,
      supportedServiceIds: row.supportedServiceIds ?? [],
      enabledPaymentMethods: row.enabledPaymentMethods ?? [],
      workingSchedule: row.workingSchedule ?? [],
      pickupSlots: row.pickupSlots ?? [],
      deliverySlots: row.deliverySlots ?? [],
    };
  }

  // ── Auto-fetch coordinates via OpenStreetMap Nominatim ────────────────────

  async geocodeAddress(dto: GeocodeQueryDto): Promise<GeocodeCandidate[]> {
    const q = dto.city?.trim()
      ? `${dto.query.trim()}, ${dto.city.trim()}`
      : dto.query.trim();

    const limit = dto.limit ?? 5;
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(q)}&format=json&limit=${limit}&addressdetails=1`;

    let raw: any[];
    try {
      raw = await this.httpsGet<any[]>(url, {
        'User-Agent': 'LaundryApp/1.0 (admin geocode)',
        Accept: 'application/json',
      });
    } catch (err: any) {
      this.logger.error('Nominatim request failed', err?.message);
      throw new BadRequestException(
        'Geocoding service unavailable — please try again',
      );
    }

    if (!Array.isArray(raw)) return [];

    return raw.map((item) => ({
      displayName: item.display_name ?? '',
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      city:
        item.address?.city ??
        item.address?.town ??
        item.address?.village ??
        item.address?.county ??
        null,
      country: item.address?.country ?? null,
      type: item.type ?? item.class ?? 'place',
    }));
  }

  private httpsGet<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Geocode request timed out'));
      });
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private normalizeLocationPayload(
    payload: Partial<CreateLocationDto | UpdateLocationDto>,
  ) {
    const next: Record<string, any> = {};

    if (payload.shopName !== undefined) next.shopName = payload.shopName.trim();
    if (payload.city !== undefined) next.city = payload.city.trim();
    if (payload.fullAddress !== undefined) next.fullAddress = payload.fullAddress.trim();
    if (payload.contactNumber !== undefined) next.contactNumber = payload.contactNumber.trim();
    if (payload.geoPoint) {
      this.validateBranchCoordinates(payload.geoPoint);
      next.geoPoint = {
        type: 'Point',
        coordinates: [payload.geoPoint.longitude, payload.geoPoint.latitude],
      };
    }
    if (payload.serviceAreaType !== undefined) next.serviceAreaType = payload.serviceAreaType;
    if (payload.serviceRadiusKm !== undefined) next.serviceRadiusKm = payload.serviceRadiusKm;
    if (payload.servicePolygon !== undefined) {
      next.servicePolygon = this.normalizePolygon(payload.servicePolygon);
    }
    const maybeIsActive = (payload as any).isActive;
    if (maybeIsActive !== undefined) next.isActive = maybeIsActive;
    if (payload.timezone !== undefined) next.timezone = payload.timezone;
    if (payload.workingSchedule !== undefined) {
      next.workingSchedule = this.normalizeWorkingSchedule(payload.workingSchedule);
    }
    if (payload.pickupSlots !== undefined) next.pickupSlots = this.normalizeSlots(payload.pickupSlots);
    if (payload.deliverySlots !== undefined) next.deliverySlots = this.normalizeSlots(payload.deliverySlots);
    if (payload.dailyBookingLimit !== undefined) next.dailyBookingLimit = payload.dailyBookingLimit;
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

  private validateBranchCoordinates(geoPoint: { latitude?: number; longitude?: number }) {
    if (geoPoint.latitude === undefined || geoPoint.latitude === null) {
      throw new BadRequestException('geoPoint.latitude is required');
    }
    if (geoPoint.longitude === undefined || geoPoint.longitude === null) {
      throw new BadRequestException('geoPoint.longitude is required');
    }
    if (typeof geoPoint.latitude !== 'number' || !Number.isFinite(geoPoint.latitude)) {
      throw new BadRequestException('geoPoint.latitude must be a finite number');
    }
    if (typeof geoPoint.longitude !== 'number' || !Number.isFinite(geoPoint.longitude)) {
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
      throw new BadRequestException(
        'servicePolygon outer ring must have at least 4 points',
      );
    }
    const closedRing = [...ring.map((point) => [Number(point[0]), Number(point[1])])];
    const first = closedRing[0];
    const last = closedRing[closedRing.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      closedRing.push([first[0], first[1]]);
    }
    return { type: 'Polygon' as const, coordinates: [closedRing] };
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
    return slots.map((slot) => {
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
  }

  private async evaluateLocationEligibility(
    candidate: any,
    payload: Partial<ResolveLocationDto>,
    requestedDate: Date,
    mode: LocationAssignmentMode = LocationAssignmentMode.AUTO_ASSIGN,
  ) {
    const reasons: LocationValidationMessage[] = [];

    if (!candidate.isActive) {
      reasons.push({ code: 'LOCATION_INACTIVE', message: 'Branch temporarily unavailable' });
    }

    // Only enforce working schedule when the location has one configured.
    // An empty schedule means the location accepts orders any time.
    const hasSchedule = (candidate.workingSchedule || []).length > 0;
    if (hasSchedule) {
      const day = toDayOfWeek(requestedDate);
      const schedule = candidate.workingSchedule.find((item: any) => item.day === day);
      if (!schedule || !schedule.isOpen) {
        reasons.push({ code: 'LOCATION_CLOSED_TODAY', message: 'Location closed today' });
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

    // DIRECT_SELECTION (e.g. Drop at Shop) skips the distance check — the
    // customer walked in and chose this exact branch, so distance from a
    // pickup address is irrelevant; every other check here still applies.
    if (mode === LocationAssignmentMode.AUTO_ASSIGN) {
      const inServiceArea = this.isPointInsideServiceArea(
        candidate,
        payload.latitude!,
        payload.longitude!,
      );
      if (!inServiceArea) {
        reasons.push({
          code: 'SERVICE_NOT_AVAILABLE_IN_AREA',
          message: 'Service not available in your area',
        });
      }
    }

    // Instant orders stop being accepted after today's cutoff (see
    // INSTANT_ORDER_CUTOFF_TIME / isInstantAvailable). Reject here so a stale
    // client that already had Instant selected can't bypass the UI cutoff.
    const requestedSlots = [payload.pickupSlot, payload.deliverySlot]
      .filter((s): s is string => !!s)
      .map((s) => s.trim().toLowerCase());
    if (requestedSlots.includes('instant') && !isInstantAvailable()) {
      reasons.push({
        code: 'INSTANT_ORDERS_UNAVAILABLE',
        message: INSTANT_ORDER_UNAVAILABLE_MESSAGE,
      });
    }

    // Only enforce pickup/delivery slot matching when the location has slots
    // configured. An empty slots array means the location accepts any slot label.
    // "Instant" and "Full Day" are global meta-slots that are always valid.
    const OPEN_SLOTS = new Set(['instant', 'full day', 'full-day']);

    const locationPickupSlots: any[] = candidate.pickupSlots || [];
    const locationDeliverySlots: any[] = candidate.deliverySlots || [];

    if (payload.pickupSlot && locationPickupSlots.length > 0) {
      const slotKey = payload.pickupSlot.trim().toLowerCase();
      if (!OPEN_SLOTS.has(slotKey)) {
        const hasPickupSlot =
          locationPickupSlots.some(
            (slot) => slot.label.trim().toLowerCase() === slotKey,
          ) || (await this.isActiveStandardSlot(slotKey));
        if (!hasPickupSlot) {
          reasons.push({ code: 'NO_PICKUP_SLOTS_AVAILABLE', message: 'Selected pickup slot is not available at this branch' });
        }
      }
    }


    if (payload.deliverySlot && locationDeliverySlots.length > 0) {
      const slotKey = payload.deliverySlot.trim().toLowerCase();
      if (!OPEN_SLOTS.has(slotKey)) {
        // Delivery mirrors the pickup slot for scheduled orders (next day,
        // same slot) — so a standard pickup slot label is also valid here.
        const hasDeliverySlot =
          locationDeliverySlots.some(
            (slot) => slot.label.trim().toLowerCase() === slotKey,
          ) ||
          payload.pickupSlot?.trim().toLowerCase() === slotKey ||
          (await this.isActiveStandardSlot(slotKey));
        if (!hasDeliverySlot) {
          reasons.push({
            code: 'NO_DELIVERY_SLOTS_AVAILABLE',
            message: 'Selected delivery slot is not available at this branch',
          });
        }
      }
    }

    const dayStart = startOfDay(requestedDate);
    const dayEnd = endOfDay(requestedDate);
    const bookedCount = await this.orderModel.countDocuments({
      locationId: String(candidate._id),
      pickupDate: { $gte: dayStart, $lte: dayEnd },
      status: { $ne: OrderStatus.CANCELLED },
    });

    // Only enforce daily limit when it is explicitly set (> 0).
    const dailyLimit = candidate.dailyBookingLimit ?? 0;
    if (dailyLimit > 0 && bookedCount >= dailyLimit) {
      reasons.push({ code: 'DAILY_CAPACITY_REACHED', message: 'No more slots available for today' });
    }

    // Per-slot capacity check (only when location has slots AND slot has a capacity set).
    if (payload.pickupSlot && locationPickupSlots.length > 0) {
      const matchedSlot = locationPickupSlots.find(
        (slot) => slot.label === payload.pickupSlot,
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
            message: 'Selected pickup slot is fully booked for today',
          });
        }
      }
    }

    return {
      location: {
        ...candidate,
        remainingCapacity: dailyLimit > 0
          ? Math.max(0, dailyLimit - bookedCount)
          : null,
      },
      reasons,
      isEligible: reasons.length === 0,
      canSuggest:
        candidate.isActive &&
        reasons.every((reason) => reason.code !== 'SERVICE_NOT_AVAILABLE_IN_AREA'),
    };
  }

  private isPointInsideServiceArea(location: any, latitude: number, longitude: number) {
    if (location.serviceAreaType === ServiceAreaType.RADIUS) {
      const [lng, lat] = location.geoPoint?.coordinates || [];
      // No shop coordinates → cannot check → accept (soft fail open)
      if (lat == null || lng == null) return true;
      // Use radius from location; fall back to 50 km if unset
      const radius = location.serviceRadiusKm ?? 50;
      // Prefer the geoNear-computed distance (already available, no extra calc)
      const distanceKm =
        location.distanceMeters != null
          ? location.distanceMeters / 1000
          : haversineDistanceKm(latitude, longitude, lat, lng);
      return distanceKm <= radius;
    }
    // Polygon area
    const ring = location.servicePolygon?.coordinates?.[0];
    // No polygon ring → cannot check → accept (soft fail open)
    if (!ring || !Array.isArray(ring)) return true;
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

    try {
      return await this.locationModel
        .aggregate([
          {
            $geoNear: {
              near: {
                type: 'Point' as const,
                coordinates: [payload.longitude, payload.latitude] as [number, number],
              },
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
    } catch (err: any) {
      // MongoDB error 291: NoQueryExecutionPlans — 2dsphere index missing.
      // onModuleInit attempts syncIndexes() at startup; this catch handles the
      // race where the first request fires before the index is created.
      const isIndexMissing =
        err?.code === 291 ||
        (typeof err?.message === 'string' &&
          err.message.includes('unable to find index for $geoNear'));

      if (isIndexMissing) {
        this.logger.error(
          'Missing 2dsphere index on locations.geoPoint. ' +
          'Attempting emergency index creation…',
        );
        try {
          // Attempt to create the index inline so subsequent requests succeed.
          await this.locationModel.collection.createIndex(
            { geoPoint: '2dsphere' },
            { background: true },
          );
          this.logger.log('2dsphere index created successfully.');
        } catch (idxErr: any) {
          this.logger.error('Emergency index creation failed', idxErr?.message);
        }
        throw new BadRequestException(
          'Location service is initialising — please retry in a few seconds.',
        );
      }

      // Re-throw anything else unchanged.
      throw err;
    }
  }

  private reorderCandidates(candidates: any[], preferredLocationId?: string) {
    if (!preferredLocationId) return candidates;
    const preferred = candidates.find(
      (item) => String(item._id) === preferredLocationId,
    );
    if (!preferred) return candidates;
    return [
      preferred,
      ...candidates.filter((item) => String(item._id) !== preferredLocationId),
    ];
  }

  private async findLocationById(locationId: string) {
    const location = await this.locationModel.findById(locationId).exec();
    if (!location) throw new NotFoundException('Location not found');
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
