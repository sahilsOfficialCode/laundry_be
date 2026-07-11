import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LaundryService, LaundryServiceDocument } from './schemas/service.schema';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesFilterDto } from './dto/get-services-filter.dto';

/** Max number of services shown in the "Popular" row on the user home page. */
const MAX_POPULAR = 3;

@Injectable()
export class ServicesService {
  constructor(
    @InjectModel(LaundryService.name)
    private serviceModel: Model<LaundryServiceDocument>,
  ) {}

  async create(userId: string, createDto: CreateServiceDto): Promise<LaundryService> {
    const createdService = new this.serviceModel({ ...createDto, userId });
    return createdService.save();
  }

  async update(id: string, updateDto: UpdateServiceDto): Promise<LaundryService> {
    // Enforce the popular-row limit (3 cards max)
    if (updateDto.isPopular === true) {
      const popularCount = await this.serviceModel.countDocuments({
        isPopular: true,
        _id: { $ne: id },
      });
      if (popularCount >= MAX_POPULAR) {
        throw new BadRequestException(
          `Only ${MAX_POPULAR} services can be popular. Remove one first.`,
        );
      }
    }

    const update: any = { ...updateDto };
    // Clearing popular also clears its position
    if (updateDto.isPopular === false) {
      update.popularOrder = null;
    }

    const updated = await this.serviceModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException('Service not found');
    }
    return updated;
  }

  async findAll(filterDto: GetServicesFilterDto = {}): Promise<any> {
    const { search, page, limit, popular } = filterDto;

    const query: any = {};
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    // Popular row: only admin-selected services, in admin-defined order
    if (popular) {
      const data = await this.serviceModel
        .find({ ...query, isPopular: true, isAvailable: true })
        .sort({ popularOrder: 1 })
        .limit(MAX_POPULAR)
        .exec();
      return { data, total: data.length };
    }

    if (page && limit) {
      const skip = (page - 1) * limit;
      const data = await this.serviceModel
        .find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const total = await this.serviceModel.countDocuments(query);
      return {
        data,
        total,
        page,
        limit,
      };
    }
    // Default behavior if no pagination requested
    const data = await this.serviceModel.find(query).sort({ name: 1 }).exec();
    return { data, total: data.length };
  }
}
