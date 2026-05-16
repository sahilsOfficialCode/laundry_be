import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';

import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus } from './schemas/order.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) { }

  // 🔥 POST /orders/checkout
  @Post('checkout')
  async checkout(@GetUser() user: any) {
    return this.ordersService.checkout(user.sub);
  }

  // ADMIN: GET /orders
  @Get()
  @Roles(UserRole.ADMIN)
  async getAllOrders(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('status') status?: OrderStatus,
  ) {
    console.log("<><>working")
    console.log("<><>user role", UserRole);

    return this.ordersService.findAll(page, limit, status);
  }

  // 📄 GET /orders/my
  @Get('my')
  async getMyOrders(@GetUser() user: any) {
    return this.ordersService.findMyOrders(user.sub);
  }

  // 📄 GET /orders/:id
  @Get(':id')
  async getOrderById(@Param('id') orderId: string, @GetUser() user: any) {
    return this.ordersService.findById(orderId, user.sub);
  }

  // 🔥 ADMIN: PATCH /orders/:id/status
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async updateOrderStatus(
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(orderId, dto.status);
  }
}
