import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserAddressDto } from './dto/user-address.dto';
import { GetAddressesFilterDto } from './dto/get-addresses-filter.dto';
import { UsersService } from './users.service';

@Controller('user/addresses')
export class UserAddressesController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@GetUser() user: any, @Query() filter: GetAddressesFilterDto) {
    return this.usersService.getAddresses(user.sub, filter);
  }

  @Post()
  async create(@GetUser() user: any, @Body() dto: UserAddressDto) {
    return this.usersService.addAddress(user.sub, dto);
  }

  @Put(':id')
  async update(
    @GetUser() user: any,
    @Param('id') addressId: string,
    @Body() dto: UserAddressDto,
  ) {
    return this.usersService.updateAddress(user.sub, addressId, dto);
  }

  @Delete(':id')
  async remove(@GetUser() user: any, @Param('id') addressId: string) {
    await this.usersService.deleteAddress(user.sub, addressId);
    return { success: true };
  }

  @Put(':id/default')
  async setDefault(@GetUser() user: any, @Param('id') addressId: string) {
    return this.usersService.setDefaultAddress(user.sub, addressId);
  }
}
