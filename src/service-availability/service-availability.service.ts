import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ServiceAvailabilityConfig,
  ServiceAvailabilityConfigDocument,
} from './schemas/service-availability-config.schema';
import { UpdateServiceAvailabilityDto } from './dto/update-service-availability.dto';

const SETTINGS_KEY = 'GLOBAL';

/** Current time as HH:MM in IST (UTC+5:30) — same convention every slot/cutoff check in this codebase uses. */
function toISTTimeString(date: Date): string {
  const nowMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  const h = Math.floor((nowMs / (60 * 60 * 1000)) % 24);
  const m = Math.floor((nowMs / (60 * 1000)) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function withinWindow(now: string, start: string, end: string): boolean {
  return now >= start && now < end;
}

/**
 * Single source of truth for whether Instant/Scheduled bookings are being
 * accepted right now. Replaces the old env-var-only INSTANT_ORDER_CUTOFF_TIME
 * check (common/instant-availability.ts) — every caller that used to import
 * isInstantAvailable() from there now injects this service instead, so there
 * is exactly one place (this config + these two methods) that decides
 * availability, admin-editable via the API below instead of a redeploy.
 */
@Injectable()
export class ServiceAvailabilityService {
  private cache: ServiceAvailabilityConfig | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs = 60_000;

  constructor(
    @InjectModel(ServiceAvailabilityConfig.name)
    private readonly configModel: Model<ServiceAvailabilityConfigDocument>,
  ) {}

  async getConfig(): Promise<ServiceAvailabilityConfig> {
    if (this.cache && Date.now() < this.cacheExpiresAt) {
      return this.cache;
    }
    let doc = await this.configModel.findOne({ key: SETTINGS_KEY }).lean();
    if (!doc) {
      doc = (await this.configModel.create({ key: SETTINGS_KEY })).toObject();
    }
    this.cache = doc as ServiceAvailabilityConfig;
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    return this.cache;
  }

  async updateConfig(dto: UpdateServiceAvailabilityDto): Promise<ServiceAvailabilityConfig> {
    const doc = await this.configModel.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: dto },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    this.cache = null;
    this.cacheExpiresAt = 0;
    return doc.toObject();
  }

  async isInstantAvailable(now: Date = new Date()): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.instantEnabled) return false;
    return withinWindow(toISTTimeString(now), config.instantStartTime, config.instantEndTime);
  }

  async isScheduledAvailable(now: Date = new Date()): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.scheduledEnabled) return false;
    return withinWindow(toISTTimeString(now), config.scheduledStartTime, config.scheduledEndTime);
  }
}
