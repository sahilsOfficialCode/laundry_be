import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ServiceZone,
  ServiceZoneDocument,
} from './schemas/service-zone.schema';
import {
  CheckCoverageDto,
  CreateServiceZoneDto,
  UpdateServiceZoneDto,
} from './dto/service-zone.dto';

/** Haversine formula — returns distance in km between two lat/lng points */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class ServiceZonesService {
  constructor(
    @InjectModel(ServiceZone.name)
    private readonly zoneModel: Model<ServiceZoneDocument>,
  ) {}

  // ── Admin ──────────────────────────────────────────────────────────────────

  async create(dto: CreateServiceZoneDto) {
    const zone = await this.zoneModel.create({
      zoneName: dto.zoneName.trim(),
      city: dto.city?.trim(),
      centerLatitude: dto.centerLatitude,
      centerLongitude: dto.centerLongitude,
      radiusKm: dto.radiusKm,
      isAvailable: dto.isAvailable ?? true,
    });
    return zone;
  }

  async findAll(city?: string, includeUnavailable = false) {
    const filter: Record<string, any> = {};
    if (!includeUnavailable) {
      filter.isAvailable = true;
    }
    if (city?.trim()) {
      filter.city = new RegExp(`^${this.escapeRegex(city.trim())}$`, 'i');
    }
    return this.zoneModel.find(filter).sort({ city: 1, zoneName: 1 }).lean().exec();
  }

  async findById(id: string) {
    const zone = await this.zoneModel.findById(id).exec();
    if (!zone) throw new NotFoundException('Service zone not found');
    return zone;
  }

  async update(id: string, dto: UpdateServiceZoneDto) {
    const zone = await this.findById(id);
    if (dto.zoneName !== undefined) zone.zoneName = dto.zoneName.trim();
    if (dto.city !== undefined) zone.city = dto.city?.trim();
    if (dto.centerLatitude !== undefined) zone.centerLatitude = dto.centerLatitude;
    if (dto.centerLongitude !== undefined) zone.centerLongitude = dto.centerLongitude;
    if (dto.radiusKm !== undefined) zone.radiusKm = dto.radiusKm;
    return zone.save();
  }

  async setAvailability(id: string, isAvailable: boolean) {
    const zone = await this.findById(id);
    zone.isAvailable = isAvailable;
    return zone.save();
  }

  async remove(id: string) {
    const zone = await this.findById(id);
    await zone.deleteOne();
    return { deleted: true };
  }

  // ── User / Shared ──────────────────────────────────────────────────────────

  /**
   * Checks whether the given coordinates fall inside at least one active
   * service zone. Returns the matched zone(s) so callers can surface them.
   */
  async checkCoverage(dto: CheckCoverageDto): Promise<{
    covered: boolean;
    zone: ServiceZoneDocument | null;
    distanceKm: number | null;
  }> {
    const filter: Record<string, any> = { isAvailable: true };
    if (dto.city?.trim()) {
      filter.city = new RegExp(`^${this.escapeRegex(dto.city.trim())}$`, 'i');
    }

    const zones = await this.zoneModel.find(filter).lean().exec();

    for (const zone of zones) {
      const dist = haversineKm(
        dto.latitude,
        dto.longitude,
        zone.centerLatitude,
        zone.centerLongitude,
      );
      if (dist <= zone.radiusKm) {
        return { covered: true, zone: zone as any, distanceKm: +dist.toFixed(2) };
      }
    }

    return { covered: false, zone: null, distanceKm: null };
  }

  /** Returns the number of active (available) service zones. */
  async countActive(): Promise<number> {
    return this.zoneModel.countDocuments({ isAvailable: true }).exec();
  }

  /**
   * Throws BadRequestException if the coordinates are not within any active
   * service zone. Used by OrdersService during checkout.
   */
  async assertCovered(latitude: number, longitude: number, city?: string) {
    const result = await this.checkCoverage({ latitude, longitude, city });
    if (!result.covered) {
      throw new BadRequestException(
        'Service is not available in your area. Please check coverage before placing an order.',
      );
    }
    return result;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
