import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserAddressDto } from './dto/user-address.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from './schemas/user.schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch('profile')
  async updateProfile(
    @GetUser() user: any,
    @Body('name') name?: string,
    @Body('photoUrl') photoUrl?: string,
  ) {
    return this.usersService.updateProfile(user.sub, { name, photoUrl });
  }

  @Patch(':id/role')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async changeRole(
    @Param('id') id: string,
    @Body('role') role: UserRole,
  ) {
    return this.usersService.changeRole(id, role);
  }

  @Post(':id/block')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async block(@Param('id') id: string) {
    return this.usersService.blockUser(id);
  }

  @Post(':id/unblock')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async unblock(@Param('id') id: string) {
    return this.usersService.unblockUser(id);
  }

  // Note: must stay registered after the literal 'profile' route above so
  // that route continues to match '/users/profile' rather than being
  // shadowed by this ':id' wildcard.
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUserByAdmin(id, dto);
  }

  // ── Admin: manage addresses for any user ────────────────────────────────

  @Get(':id/addresses')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async listAddresses(@Param('id') id: string) {
    return this.usersService.getAddresses(id, {});
  }

  @Post(':id/addresses')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async addAddress(@Param('id') id: string, @Body() dto: UserAddressDto) {
    return this.usersService.addAddress(id, dto);
  }

  @Put(':id/addresses/:addressId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body() dto: UserAddressDto,
  ) {
    return this.usersService.updateAddress(id, addressId, dto);
  }

  @Delete(':id/addresses/:addressId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ) {
    await this.usersService.deleteAddress(id, addressId);
    return { success: true };
  }

  @Put(':id/addresses/:addressId/default')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async setDefaultAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ) {
    return this.usersService.setDefaultAddress(id, addressId);
  }
}
