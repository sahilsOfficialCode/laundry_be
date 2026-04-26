import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { GetServicesFilterDto } from './dto/get-services-filter.dto';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  async create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Get()
  async findAll(@Query() filterDto: GetServicesFilterDto) {
    return this.servicesService.findAll(filterDto);
  }
}
