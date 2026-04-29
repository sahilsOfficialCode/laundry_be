import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';
import { ORDER_STATUS_STAGES } from './schemas/order.schema';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('statuses')
  getStatusStages() {
    return ORDER_STATUS_STAGES;
  }

  @Get('cart')
  getCart(@Req() request: AuthenticatedRequest) {
    return this.ordersService.getCart(request.user);
  }

  @Post('cart/items')
  addCartItem(
    @Req() request: AuthenticatedRequest,
    @Body() addCartItemDto: AddCartItemDto,
  ) {
    return this.ordersService.addCartItem(request.user, addCartItemDto);
  }

  @Patch('cart/items/:serviceId')
  updateCartItem(
    @Req() request: AuthenticatedRequest,
    @Param('serviceId') serviceId: string,
    @Body() updateCartItemDto: UpdateCartItemDto,
  ) {
    return this.ordersService.updateCartItem(
      request.user,
      serviceId,
      updateCartItemDto,
    );
  }

  @Delete('cart/items/:serviceId')
  removeCartItem(
    @Req() request: AuthenticatedRequest,
    @Param('serviceId') serviceId: string,
  ) {
    return this.ordersService.removeCartItem(request.user, serviceId);
  }

  @Delete('cart')
  clearCart(@Req() request: AuthenticatedRequest) {
    return this.ordersService.clearCart(request.user);
  }

  @Post('checkout')
  checkoutCart(@Req() request: AuthenticatedRequest) {
    return this.ordersService.checkoutCart(request.user);
  }

  @Post()
  createOrder(
    @Req() request: AuthenticatedRequest,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(request.user, createOrderDto);
  }

  @Get()
  listOrders(@Req() request: AuthenticatedRequest) {
    return this.ordersService.listOrders(request.user);
  }

  @Get(':orderId/status')
  getOrderStatus(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getOrderStatus(request.user, orderId);
  }

  @Patch(':orderId/status')
  updateOrderStatus(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Body() updateOrderStatusDto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(
      request.user,
      orderId,
      updateOrderStatusDto,
    );
  }

  @Get(':orderId')
  getOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.getOrder(request.user, orderId);
  }

  @Patch(':orderId')
  updateOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.ordersService.updateOrder(
      request.user,
      orderId,
      updateOrderDto,
    );
  }
}
