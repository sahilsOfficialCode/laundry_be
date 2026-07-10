import { Injectable, NotFoundException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClothType, ClothTypeDocument } from './schemas/cloth-type.schema';
import { CreateClothTypeDto } from './dto/create-cloth-type.dto';
import { UpdateClothTypeDto } from './dto/update-cloth-type.dto';

/**
 * Normalizes a cloth type name for duplicate comparison: trims, lowercases,
 * collapses whitespace, and strips spaces just inside parentheses — so
 * "Kurta ( Heavy )" and "Kurta (heavy)" are recognized as the same name
 * instead of silently creating two entries for the same garment.
 */
function normalizeClothTypeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
}

@Injectable()
export class ClothTypesService implements OnModuleInit {
  private readonly logger = new Logger(ClothTypesService.name);

  constructor(
    @InjectModel(ClothType.name)
    private clothTypeModel: Model<ClothTypeDocument>,
  ) {}

  /**
   * One-time self-healing migration: earlier versions of this schema had a
   * globally-unique index on `name` alone, which wrongly blocked the same
   * garment name from being reused across different services (e.g. "Shirt"
   * under both Ironing and Dry Cleaning). Mongoose's autoIndex only adds
   * indexes, it never drops ones removed from the schema — so the stale
   * index keeps enforcing the old (wrong) rule until explicitly dropped.
   */
  async onModuleInit() {
    try {
      const indexes = await this.clothTypeModel.collection.indexes();
      const staleNameIndex = indexes.find(
        (idx) =>
          idx.unique &&
          idx.key &&
          Object.keys(idx.key).length === 1 &&
          idx.key.name === 1 &&
          idx.name,
      );
      if (staleNameIndex?.name) {
        await this.clothTypeModel.collection.dropIndex(staleNameIndex.name);
        this.logger.log(
          `Dropped stale unique index "${staleNameIndex.name}" on cloth-types.name`,
        );
      }
    } catch (err) {
      this.logger.warn(`Could not check/drop stale name index: ${err.message}`);
    }
  }

  private async findDuplicate(
    name: string,
    category: string | undefined,
    subcategory: string | undefined,
    excludeId?: string,
  ) {
    const normalized = normalizeClothTypeName(name);
    const query: Record<string, unknown> = { category: category ?? null, subcategory: subcategory ?? null };
    if (excludeId) query._id = { $ne: excludeId };
    const candidates = await this.clothTypeModel.find(query);
    return candidates.find((c) => normalizeClothTypeName(c.name) === normalized);
  }

  async create(createClothTypeDto: CreateClothTypeDto) {
    const existing = await this.findDuplicate(
      createClothTypeDto.name,
      createClothTypeDto.category,
      createClothTypeDto.subcategory,
    );
    if (existing) {
      throw new BadRequestException(
        `"${createClothTypeDto.name}" already exists for this category/subcategory — edit the existing entry instead of creating a duplicate.`,
      );
    }
    this.validateDiscounts(
      createClothTypeDto.instantRate,
      createClothTypeDto.scheduledRate,
      createClothTypeDto.discountInstantRate,
      createClothTypeDto.discountScheduledRate,
    );
    const clothType = new this.clothTypeModel(createClothTypeDto);
    return clothType.save();
  }

  private validateDiscounts(
    instantRate: number,
    scheduledRate: number,
    discountInstantRate?: number,
    discountScheduledRate?: number,
  ) {
    if (discountInstantRate != null && discountInstantRate >= instantRate) {
      throw new BadRequestException(
        'Discount instant rate must be less than the instant rate',
      );
    }
    if (discountScheduledRate != null && discountScheduledRate >= scheduledRate) {
      throw new BadRequestException(
        'Discount scheduled rate must be less than the scheduled rate',
      );
    }
  }

  async findAll() {
    return this.clothTypeModel.find().sort({ name: 1 });
  }

  async findOne(id: string) {
    const clothType = await this.clothTypeModel.findById(id);
    if (!clothType) {
      throw new NotFoundException('Cloth type not found');
    }
    return clothType;
  }

  async update(id: string, updateClothTypeDto: UpdateClothTypeDto) {
    const clothType = await this.clothTypeModel.findById(id);
    if (!clothType) {
      throw new NotFoundException('Cloth type not found');
    }

    const effectiveName = updateClothTypeDto.name ?? clothType.name;
    const effectiveCategory = updateClothTypeDto.category ?? clothType.category;
    const effectiveSubcategory = updateClothTypeDto.subcategory ?? clothType.subcategory;
    const identityChanged =
      (updateClothTypeDto.name !== undefined && updateClothTypeDto.name !== clothType.name) ||
      (updateClothTypeDto.category !== undefined && updateClothTypeDto.category !== clothType.category) ||
      (updateClothTypeDto.subcategory !== undefined && updateClothTypeDto.subcategory !== clothType.subcategory);

    if (identityChanged) {
      const existing = await this.findDuplicate(effectiveName, effectiveCategory, effectiveSubcategory, id);
      if (existing) {
        throw new BadRequestException(
          `"${effectiveName}" already exists for this category/subcategory — edit the existing entry instead of creating a duplicate.`,
        );
      }
    }

    Object.assign(clothType, updateClothTypeDto);
    this.validateDiscounts(
      clothType.instantRate,
      clothType.scheduledRate,
      clothType.discountInstantRate,
      clothType.discountScheduledRate,
    );
    return clothType.save();
  }

  async remove(id: string) {
    const clothType = await this.clothTypeModel.findById(id);
    if (!clothType) {
      throw new NotFoundException('Cloth type not found');
    }
    return this.clothTypeModel.findByIdAndDelete(id);
  }

  async findByIds(ids: string[]) {
    return this.clothTypeModel
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
  }
}
