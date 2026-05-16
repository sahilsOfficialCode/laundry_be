import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Order, OrderDocument, OrderStatus } from './schemas/order.schema';
import { Cart, CartDocument } from '../cart/schemas/cart.schema';
import {
  LaundryService,
  LaundryServiceDocument,
} from '../services/schemas/service.schema';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,

    @InjectModel(Cart.name)
    private cartModel: Model<CartDocument>,

    @InjectModel(LaundryService.name)
    private serviceModel: Model<LaundryServiceDocument>,
  ) {}

  // Create Order (legacy/direct)
  async checkout(userId: string) {
    const order = await this.initiateCheckout(userId);
    await this.clearCart(userId);
    return order;
  }

  // Initiate Checkout (doesn't clear cart)
  async initiateCheckout(userId: string) {
    //Load cart
    const cartCount = await this.cartModel.countDocuments();
    console.log(`[OrdersService] Total carts in DB: ${cartCount}`);
    console.log(`[OrdersService] Searching for cart with userId: "${userId}" (Type: ${typeof userId})`);
    
    const cart = await this.cartModel.findOne({ userId });

    if (!cart) {
      const allCarts = await this.cartModel.find().limit(5);
      console.log(`[OrdersService] No cart found. Sample User IDs in DB:`, allCarts.map(c => c.userId));
      throw new BadRequestException('Cart is empty');
    }

    if (cart.items.length === 0) {
      console.log(`[OrdersService] Cart found but items are empty for userId: ${userId}`);
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

    // Calculate total
    const totalAmount = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    // Create order
    const order = new this.orderModel({
      userId,
      items: orderItems,
      totalAmount,
      status: OrderStatus.ORDER_PLACED,
    });

    return order.save();
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
      [OrderStatus.PICKUP_ASSIGNED]: [OrderStatus.PROCESSING],
      [OrderStatus.PROCESSING]: [OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.COMPLETED],
      [OrderStatus.COMPLETED]: [],
      [OrderStatus.CANCELLED]: [],
    };

    return transitions[current]?.includes(next) || false;
  }
}
