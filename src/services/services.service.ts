import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LaundryService, LaundryServiceDocument } from './schemas/service.schema';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectModel(LaundryService.name)
    private serviceModel: Model<LaundryServiceDocument>,
  ) {}

  async create(createDto: CreateServiceDto): Promise<LaundryService> {
    const createdService = new this.serviceModel(createDto);
    return createdService.save();
  }

  async findAll(): Promise<LaundryService[]> {
    return this.serviceModel.find().exec();
  }
}
