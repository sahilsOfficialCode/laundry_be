import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClothType, ClothTypeDocument } from './schemas/cloth-type.schema';
import { CreateClothTypeDto } from './dto/create-cloth-type.dto';
import { UpdateClothTypeDto } from './dto/update-cloth-type.dto';

@Injectable()
export class ClothTypesService {
  constructor(
    @InjectModel(ClothType.name)
    private clothTypeModel: Model<ClothTypeDocument>,
  ) {}

  async create(createClothTypeDto: CreateClothTypeDto) {
    const existing = await this.clothTypeModel.findOne({
      name: createClothTypeDto.name,
    });
    if (existing) {
      throw new BadRequestException('Cloth type with this name already exists');
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

    if (updateClothTypeDto.name && updateClothTypeDto.name !== clothType.name) {
      const existing = await this.clothTypeModel.findOne({
        name: updateClothTypeDto.name,
      });
      if (existing) {
        throw new BadRequestException('Cloth type with this name already exists');
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
