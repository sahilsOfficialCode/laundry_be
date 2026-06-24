import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { GetServicesFilterDto } from './dto/get-services-filter.dto';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  async create(@GetUser() user: any, @Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(user.sub, createServiceDto);
  }

  @Get()
  async findAll(@GetUser() user: any, @Query() filterDto: GetServicesFilterDto) {
    return this.servicesService.findAll(user.sub, filterDto);
  }
}
