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
    const clothType = new this.clothTypeModel(createClothTypeDto);
    return clothType.save();
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
