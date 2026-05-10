import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';

import { OrdersService } from './orders.service';
import { AuthService } from '../auth/auth.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly authService: AuthService,
  ) {}

  // 🔐 Helper (reuse everywhere)
  private async getUserFromRequest(request: Request) {
    let token = request.cookies?.access_token;

    if (!token && request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new ForbiddenException('No token provided');
    }

    const result = await this.authService.verifyToken(token);
    return result.user;
  }

  // 🔥 POST /orders/checkout
  @Post('checkout')
  async checkout(@Req() request: Request) {
    const user = await this.getUserFromRequest(request);
    return this.ordersService.checkout(user.sub);
  }

  // ADMIN: GET /orders
  @Get()
  async getAllOrders(@Req() request: Request) {
    const user = await this.getUserFromRequest(request);

    if (user.role !== 'admin') {
      throw new ForbiddenException('Only admin can view all orders');
    }

    return this.ordersService.findAll();
  }

  // 📄 GET /orders/my
  @Get('my')
  async getMyOrders(@Req() request: Request) {
    const user = await this.getUserFromRequest(request);
    return this.ordersService.findMyOrders(user.sub);
  }

  // 📄 GET /orders/:id
  @Get(':id')
  async getOrderById(@Param('id') orderId: string, @Req() request: Request) {
    const user = await this.getUserFromRequest(request);
    return this.ordersService.findById(orderId, user.sub);
  }

  // 🔥 ADMIN: PATCH /orders/:id/status
  @Patch(':id/status')
  async updateOrderStatus(
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() request: Request,
  ) {
    const user = await this.getUserFromRequest(request);

    //Admin check
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only admin can update order status');
    }

    return this.ordersService.updateStatus(orderId, dto.status);
  }
}
