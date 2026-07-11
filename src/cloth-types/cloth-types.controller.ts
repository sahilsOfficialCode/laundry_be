import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ClothTypesService } from './cloth-types.service';
import { CreateClothTypeDto } from './dto/create-cloth-type.dto';
import { UpdateClothTypeDto } from './dto/update-cloth-type.dto';
import { Public } from '../auth/decorators/public.decorator';

@Controller('cloth-types')
export class ClothTypesController {
  constructor(private readonly clothTypesService: ClothTypesService) {}

  @Post()
  create(@Body() createClothTypeDto: CreateClothTypeDto) {
    return this.clothTypesService.create(createClothTypeDto);
  }

  /** Public — cloth types are a pricing catalogue, not user-specific data. */
  @Public()
  @Get()
  findAll() {
    return this.clothTypesService.findAll();
  }

  /** Public — same reasoning as findAll. */
  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clothTypesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateClothTypeDto: UpdateClothTypeDto) {
    return this.clothTypesService.update(id, updateClothTypeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clothTypesService.remove(id);
  }
}
