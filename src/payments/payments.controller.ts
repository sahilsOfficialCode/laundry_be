import {
  Controller,
  Post,
  Param,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { OrdersService } from '../orders/orders.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus, PaymentStatus } from '../orders/schemas/order.schema';
import { CheckoutContextDto } from '../orders/dto/checkout-context.dto';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
    private readonly notificationsService: NotificationsService,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  /**
   * POST /payments/create-order  (legacy — kept for backward compat, not used in new flow)
   * Creates a new order from cart AND opens a Razorpay session in one step.
   */
  @Post('create-order')
  async createOrder(@Body() body: CheckoutContextDto, @GetUser() user: any) {
    const userId = user.sub;
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

  /**
   * POST /payments/initiate/:orderId
   * New endpoint — called after admin sets the bill (PROCESSING status).
   * Creates a Razorpay payment session for the confirmed bill amount.
   * Order must be in PROCESSING status and payment must be PENDING.
   */
  @Post('initiate/:orderId')
  async initiatePaymentForOrder(
    @Param('orderId') orderId: string,
    @GetUser() user: any,
  ) {
    const order = await this.orderModel.findById(orderId);
    if (!order || String(order.userId) !== String(user.sub)) {
      throw new BadRequestException('Order not found');
    }
    if (
      order.status !== OrderStatus.ITEMIZED &&
      order.status !== OrderStatus.PROCESSING
    ) {
      throw new BadRequestException('Payment can be made once your order is itemized and the bill is confirmed.');
    }
    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException('Payment has already been completed for this order.');
    }
    if (!order.billAmount || order.billAmount <= 0) {
      throw new BadRequestException('Bill amount has not been set by admin yet.');
    }

    const razorpayOrder = await this.paymentsService.createOrder(
      order.billAmount,
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

  /**
   * POST /payments/verify
   * Verifies Razorpay signature. On success:
   * - marks paymentStatus = COMPLETED
   * - generates a secure 4-digit delivery OTP (visible only to user + admin)
   */
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

    // Generate secure 4-digit OTP after payment — visible only to user and admin
    order.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));

    await order.save();

    // Fire payment success push notification (non-blocking)
    this.notificationsService
      .notifyPaymentSuccess(user.sub, order.orderNumber ?? '')
      .catch(() => { /* swallow — notification errors must not fail payment verification */ });

    // Admin notification bar: payment received (non-blocking)
    this.notificationsService
      .notifyAdmin({
        title: 'Payment Received 💳',
        body: `Payment confirmed for Order #${order.orderNumber ?? ''} — ₹${order.totalAmount ?? 0}.`,
        type: 'payment_success',
        orderId: order.orderNumber ?? '',
      })
      .catch(() => { /* swallow */ });

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
