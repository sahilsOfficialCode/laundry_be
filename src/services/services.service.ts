import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LaundryService, LaundryServiceDocument } from './schemas/service.schema';
import { CreateServiceDto } from './dto/create-service.dto';
import { GetServicesFilterDto } from './dto/get-services-filter.dto';

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

  async findAll(filterDto: GetServicesFilterDto = {}): Promise<any> {
    const { search, page, limit } = filterDto;

    const query: any = { };
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    if (page && limit) {
      const skip = (page - 1) * limit;
      const data = await this.serviceModel
        .find(query)
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
    const data = await this.serviceModel.find(query).exec();
    return { data, total: data.length };
  }
}
