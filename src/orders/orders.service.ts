import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Order, OrderDocument, OrderStatus, PaymentStatus } from './schemas/order.schema';
import { Cart, CartDocument } from '../cart/schemas/cart.schema';
import {
  LaundryService,
  LaundryServiceDocument,
} from '../services/schemas/service.schema';
import { CheckoutContextDto } from './dto/checkout.dto';
import { LocationsService } from '../locations/locations.service';
import { PaymentMethod } from '../locations/schemas/location.schema';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,

    @InjectModel(Cart.name)
    private cartModel: Model<CartDocument>,

    @InjectModel(LaundryService.name)
    private serviceModel: Model<LaundryServiceDocument>,

    private locationsService: LocationsService,
  ) {}

  // Create Order (legacy/direct)
  async checkout(userId: string) {
    const order = await this.initiateCheckout(userId);
    await this.clearCart(userId);
    return order;
  }

  // Initiate Checkout (doesn't clear cart)
  async initiateCheckout(userId: string) {
    const { orderItems, totalAmount } = await this.buildOrderItems(userId);

    const order = new this.orderModel({
      userId,
      items: orderItems,
      totalAmount,
      status: OrderStatus.ORDER_PLACED,
    });

    return order.save();
  }

  async createOrderFromCheckout(userId: string, dto: CheckoutContextDto) {
    const { orderItems, totalAmount } = await this.buildOrderItems(userId);
    this.assertAmountMatches(totalAmount, dto.expectedAmount);

    const assignment = await this.locationsService.validateCheckoutContext({
      serviceType: dto.serviceType,
      pickupAddress: dto.pickupAddress,
      selectedShopId: dto.selectedShopId,
      pickupSlot: dto.pickupSlot,
      deliverySlot: dto.deliverySlot,
      paymentMethod: dto.paymentMethod,
    });

    const status =
      dto.paymentMethod === PaymentMethod.CASH_ON_DELIVERY
        ? OrderStatus.ORDER_PLACED
        : OrderStatus.PENDING_PAYMENT;
    const paymentStatus =
      dto.paymentMethod === PaymentMethod.CASH_ON_DELIVERY
        ? PaymentStatus.PENDING
        : PaymentStatus.PENDING;

    const order = new this.orderModel({
      userId,
      items: orderItems,
      totalAmount,
      status,
      paymentStatus,
      serviceType: dto.serviceType,
      assignedShopId: assignment.shop._id.toString(),
      assignedShopName: assignment.shop.shopName,
      assignedShopAddress: assignment.shop.fullAddress,
      distanceKm: assignment.distanceKm,
      address: dto.pickupAddress?.fullAddress || assignment.shop.fullAddress,
      pickupAddress: dto.pickupAddress,
      receptionDetails: dto.receptionDetails,
      pickupSlot: dto.pickupSlot,
      deliverySlot: dto.deliverySlot,
      paymentMethod: dto.paymentMethod,
    });

    const saved = await order.save();

    if (dto.paymentMethod === PaymentMethod.CASH_ON_DELIVERY) {
      await this.clearCart(userId);
    }

    return saved;
  }

  async markOrderPaid(orderId: string, data: { razorpayPaymentId: string }) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new BadRequestException('Order not found');

    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      return order;
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Order is not awaiting payment');
    }

    order.paymentStatus = PaymentStatus.COMPLETED;
    order.status = OrderStatus.ORDER_PLACED;
    order.razorpayPaymentId = data.razorpayPaymentId;
    await order.save();
    await this.clearCart(order.userId);
    return order;
  }

  async markPaymentFailed(orderId: string) {
    await this.orderModel.findByIdAndUpdate(orderId, {
      paymentStatus: PaymentStatus.FAILED,
      status: OrderStatus.CANCELLED,
    });
  }

  private async buildOrderItems(userId: string) {
    const cart = await this.cartModel.findOne({ userId });

    if (!cart) {
      throw new BadRequestException('Cart is empty');
    }

    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Validate + transform items (ONLY schema fields)
    const orderItems = await Promise.all(
      cart.items.map(async (item) => {
        const service = await this.serviceModel.findById(item.serviceId);

        if (!service) {
          throw new NotFoundException(`Service not found: ${item.serviceId.toString()}`);
        }

        if (!service.isAvailable) {
          throw new BadRequestException(
            `Service not available: ${service.name}`,
          );
        }

        if (item.quantity <= 0) {
          throw new BadRequestException('Invalid quantity');
        }

        return {
          serviceId: item.serviceId,
          serviceName: service.name,
          icon: service.icon,
          quantity: item.quantity,
          price: service.price, 
        };
      }),
    );

    const totalAmount = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    return { orderItems, totalAmount };
  }

  private assertAmountMatches(totalAmount: number, expectedAmount: number) {
    if (Math.round(totalAmount * 100) !== Math.round(expectedAmount * 100)) {
      throw new BadRequestException('Payment amount does not match order total');
    }
  }

  async clearCart(userId: string) {
    await this.cartModel.updateOne({ userId }, { items: [], totalAmount: 0 });
  }

  // Get all orders for user
  async findMyOrders(userId: string) {
    return this.orderModel.find({ userId }).sort({ createdAt: -1 });
  }

  // ADMIN: Get all orders (paginated)
  async findAll(page: number = 1, limit: number = 10, status?: OrderStatus) {
    const skip = (page - 1) * limit;
    const filter = status ? { status } : {};
    
    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.orderModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  // Get single order (owner only)
  async findById(orderId: string, userId: string) {
    const order = await this.orderModel.findOne({
      _id: orderId,
      userId,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  // ADMIN: Update status
  async updateStatus(orderId: string, status: OrderStatus) {
    const order = await this.orderModel.findById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!this.isValidTransition(order.status, status)) {
      throw new BadRequestException('Invalid status transition');
    }

    order.status = status;
    return order.save();
  }

  // Status transition rules (MATCHES YOUR ENUM)
  private isValidTransition(current: OrderStatus, next: OrderStatus): boolean {
    const transitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.ORDER_PLACED]: [
        OrderStatus.PICKUP_ASSIGNED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.PENDING_PAYMENT]: [
        OrderStatus.ORDER_PLACED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.PICKUP_ASSIGNED]: [OrderStatus.PROCESSING],
      [OrderStatus.PROCESSING]: [OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.COMPLETED],
      [OrderStatus.COMPLETED]: [],
      [OrderStatus.CANCELLED]: [],
    };

    return transitions[current]?.includes(next) || false;
  }
}
