import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesFilterDto } from './dto/get-services-filter.dto';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  async create(@GetUser() user: any, @Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(user.sub, createServiceDto);
  }

  /** Public — services are a catalogue, not user-specific data. */
  @Public()
  @Get()
  async findAll(@Query() filterDto: GetServicesFilterDto) {
    return this.servicesService.findAll(filterDto);
  }

  /** Admin: edit a service (incl. isPopular / popularOrder for the home page row). */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(id, updateServiceDto);
  }
}
