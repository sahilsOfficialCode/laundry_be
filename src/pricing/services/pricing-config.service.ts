import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PricingConfig,
  PricingConfigDocument,
} from '../schemas/pricing-config.schema';

const SETTINGS_KEY = 'GLOBAL';

/**
 * Owns the singleton pricing settings document. Reads are cached in-memory
 * for a short TTL because settings are read on every checkout/itemization
 * call but change rarely. Mirrors ReferralSettingsService's pattern.
 */
@Injectable()
export class PricingConfigService {
  private cache: PricingConfig | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs = 60_000; // 1 minute

  constructor(
    @InjectModel(PricingConfig.name)
    private readonly configModel: Model<PricingConfigDocument>,
  ) {}

  /** Get settings, seeding defaults on first access. Cached for cacheTtlMs. */
  async get(): Promise<PricingConfig> {
    if (this.cache && Date.now() < this.cacheExpiresAt) {
      return this.cache;
    }

    let doc = await this.configModel.findOne({ key: SETTINGS_KEY }).lean();
    if (!doc) {
      doc = (await this.configModel.create({ key: SETTINGS_KEY })).toObject();
    }

    this.cache = doc as PricingConfig;
    this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
    return this.cache;
  }

  /** Admin partial update; invalidates the cache. */
  async update(dto: Partial<PricingConfig>): Promise<PricingConfig> {
    const doc = await this.configModel.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: dto },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    this.cache = null;
    this.cacheExpiresAt = 0;
    return doc.toObject();
  }
}
