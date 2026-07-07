import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReferralSettings,
  ReferralSettingsDocument,
} from '../schemas/referral-settings.schema';
import { UpdateReferralSettingsDto } from '../dto/admin-referral.dto';

const SETTINGS_KEY = 'GLOBAL';

/**
 * Owns the singleton settings document. Reads are cached in-memory for a short
 * TTL because settings are read on every validate/apply call but change rarely.
 */
@Injectable()
export class ReferralSettingsService {
  private cache: ReferralSettings | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs = 60_000; // 1 minute

  constructor(
    @InjectModel(ReferralSettings.name)
    private readonly settingsModel: Model<ReferralSettingsDocument>,
  ) {}

  /** Get settings, seeding defaults on first access. Cached for cacheTtlMs. */
  async get(): Promise<ReferralSettings> {
    if (this.cache && Date.now() < this.cacheExpiresAt) {
      return this.cache;
    }

    let doc = await this.settingsModel.findOne({ key: SETTINGS_KEY }).lean();
    if (!doc) {
      // Seed defaults on first ever read.
      doc = (
        await this.settingsModel.create({ key: SETTINGS_KEY })
      ).toObject();
    }

    this.cache = doc as ReferralSettings;
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    return this.cache;
  }

  /** Admin partial update; invalidates the cache. */
  async update(dto: UpdateReferralSettingsDto): Promise<ReferralSettings> {
    const doc = await this.settingsModel.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: dto },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    this.cache = null; // force refresh
    this.cacheExpiresAt = 0;
    return doc.toObject();
  }
}
