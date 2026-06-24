import {
  Controller,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, PaymentStatus } from '../orders/schemas/order.schema';
import { CheckoutContextDto } from '../orders/dto/checkout-context.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  @Post('create-order')
  async createOrder(@Body() body: CheckoutContextDto, @GetUser() user: any) {
    const userId = user.sub;
    console.log('Creating order for user:', userId, 'with body:', body);
    // We initiate the checkout but don't clear the cart yet?
    // Or we just calculate the total from the cart.
    const order = await this.ordersService.initiateCheckout(userId, body);
    console.log("<><>working 2");
    
    const razorpayOrder = await this.paymentsService.createOrder(
      order.totalAmount,
      order._id.toString(),
    );
console.log("<><>working 3");
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();
console.log("<><>working 4");
    return {
      orderId: order._id,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    };
  }

  @Post('verify')
  async verifyPayment(@Body() body, @GetUser() user: any) {
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
    if (String(order.userId) !== String(user.sub)) {
      throw new BadRequestException('Order not found');
    }

    order.paymentStatus = PaymentStatus.COMPLETED;
    order.razorpayPaymentId = razorpayPaymentId;
    await order.save();

    // Now clear the cart
    await this.ordersService.clearCart(order.userId);

    return { success: true, order };
  }

  @Post('failed')
  async markPaymentFailed(@Body('orderId') orderId: string, @GetUser() user: any) {
    const order = await this.orderModel.findById(orderId);
    if (!order || String(order.userId) !== String(user.sub)) {
      throw new BadRequestException('Order not found');
    }

    order.paymentStatus = PaymentStatus.FAILED;
    await order.save();

    return { success: true, order };
  }
}
