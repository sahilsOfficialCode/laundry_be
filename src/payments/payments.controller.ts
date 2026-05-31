import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request as Req,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { AuthService } from '../auth/auth.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, PaymentStatus } from '../orders/schemas/order.schema';
import type { Request } from 'express';
import { CheckoutContextDto } from '../orders/dto/checkout-context.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
    private readonly authService: AuthService,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  // 🔐 Helper (reuse everywhere)
  private async getUserFromRequest(request: Request) {
    let token = request.cookies?.access_token;

    if (!token && request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new BadRequestException('No token provided');
    }

    const result = await this.authService.verifyToken(token);
    return result.user;
  }

  @Post('create-order')
  async createOrder(@Body() body: CheckoutContextDto, @Req() request: Request) {
    const user = await this.getUserFromRequest(request);
    const userId = user.sub;
    // We initiate the checkout but don't clear the cart yet?
    // Or we just calculate the total from the cart.
    const order = await this.ordersService.initiateCheckout(userId, body);
    
    const razorpayOrder = await this.paymentsService.createOrder(
      order.totalAmount,
      order._id.toString(),
    );

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    return {
      orderId: order._id,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    };
  }

  @Post('verify')
  async verifyPayment(@Body() body) {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;

    const isValid = this.paymentsService.verifyPayment(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid payment signature');
    }

    const order = await this.orderModel.findById(orderId);
    if (!order) {
      throw new BadRequestException('Order not found');
    }

    order.paymentStatus = PaymentStatus.COMPLETED;
    order.razorpayPaymentId = razorpayPaymentId;
    await order.save();

    // Now clear the cart
    await this.ordersService.clearCart(order.userId);

    return { success: true, order };
  }
}
