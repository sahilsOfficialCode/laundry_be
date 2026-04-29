import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LaundryService,
  LaundryServiceDocument,
} from '../services/schemas/service.schema';
import { AuthenticatedUser } from '../auth/authenticated-request';
import { UserRole } from '../users/schemas/user.schema';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderItemDto } from './dto/order-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { Cart, CartDocument, CartItem } from './schemas/cart.schema';
import {
  ORDER_STATUS_STAGES,
  Order,
  OrderDocument,
  OrderItem,
  OrderStatus,
} from './schemas/order.schema';

interface NormalizedItemInput {
  serviceId: string;
  quantity: number;
}

type ItemSnapshot = Pick<
  OrderItem,
  'serviceId' | 'serviceName' | 'price' | 'quantity'
>;

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Cart.name)
    private readonly cartModel: Model<CartDocument>,
    @InjectModel(LaundryService.name)
    private readonly serviceModel: Model<LaundryServiceDocument>,
  ) {}

  async getCart(user: AuthenticatedUser): Promise<CartDocument> {
    return this.findOrCreateCart(user.sub);
  }

  async addCartItem(
    user: AuthenticatedUser,
    addCartItemDto: AddCartItemDto,
  ): Promise<CartDocument> {
    const cart = await this.findOrCreateCart(user.sub);
    const [item] = await this.buildAvailableItemSnapshots([
      {
        serviceId: addCartItemDto.serviceId,
        quantity: addCartItemDto.quantity,
      },
    ]);

    const items = [...cart.items];
    const existingIndex = items.findIndex(
      (cartItem) => String(cartItem.serviceId) === String(item.serviceId),
    );

    if (existingIndex >= 0) {
      const existingItem = items[existingIndex];
      items[existingIndex] = {
        ...item,
        quantity: existingItem.quantity + addCartItemDto.quantity,
      } as CartItem;
    } else {
      items.push(item as CartItem);
    }

    cart.items = items;
    cart.totalAmount = this.calculateTotal(items);
    return cart.save();
  }

  async updateCartItem(
    user: AuthenticatedUser,
    serviceId: string,
    updateCartItemDto: UpdateCartItemDto,
  ): Promise<CartDocument> {
    this.assertObjectId(serviceId, 'serviceId');

    if (updateCartItemDto.quantity === 0) {
      return this.removeCartItem(user, serviceId);
    }

    const cart = await this.findOrCreateCart(user.sub);
    const [item] = await this.buildAvailableItemSnapshots([
      {
        serviceId,
        quantity: updateCartItemDto.quantity,
      },
    ]);

    const items = [...cart.items];
    const existingIndex = items.findIndex(
      (cartItem) => String(cartItem.serviceId) === serviceId,
    );

    if (existingIndex >= 0) {
      items[existingIndex] = item as CartItem;
    } else {
      items.push(item as CartItem);
    }

    cart.items = items;
    cart.totalAmount = this.calculateTotal(items);
    return cart.save();
  }

  async removeCartItem(
    user: AuthenticatedUser,
    serviceId: string,
  ): Promise<CartDocument> {
    this.assertObjectId(serviceId, 'serviceId');

    const cart = await this.findOrCreateCart(user.sub);
    cart.items = cart.items.filter(
      (cartItem) => String(cartItem.serviceId) !== serviceId,
    );
    cart.totalAmount = this.calculateTotal(cart.items);
    return cart.save();
  }

  async clearCart(user: AuthenticatedUser): Promise<CartDocument> {
    const cart = await this.findOrCreateCart(user.sub);
    cart.items = [];
    cart.totalAmount = 0;
    return cart.save();
  }

  async checkoutCart(user: AuthenticatedUser): Promise<OrderDocument> {
    const cart = await this.findOrCreateCart(user.sub);

    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const order = await this.createOrderFromItems(
      user.sub,
      cart.items.map((item) => ({
        serviceId: String(item.serviceId),
        quantity: item.quantity,
      })),
    );

    cart.items = [];
    cart.totalAmount = 0;
    await cart.save();

    return order;
  }

  async createOrder(
    user: AuthenticatedUser,
    createOrderDto: CreateOrderDto,
  ): Promise<OrderDocument> {
    return this.createOrderFromItems(user.sub, createOrderDto.items);
  }

  async listOrders(user: AuthenticatedUser): Promise<OrderDocument[]> {
    const query =
      user.role === UserRole.ADMIN
        ? {}
        : { userId: new Types.ObjectId(user.sub) };

    return this.orderModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async getOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderDocument> {
    return this.findOrderForUser(user, orderId);
  }

  async updateOrder(
    user: AuthenticatedUser,
    orderId: string,
    updateOrderDto: UpdateOrderDto,
  ): Promise<OrderDocument> {
    const order = await this.findOrderForUser(user, orderId);

    if (!updateOrderDto.items) {
      return order;
    }

    const items = await this.buildAvailableItemSnapshots(updateOrderDto.items);
    order.items = items as OrderItem[];
    order.totalAmount = this.calculateTotal(items);
    return order.save();
  }

  async updateOrderStatus(
    user: AuthenticatedUser,
    orderId: string,
    updateOrderStatusDto: UpdateOrderStatusDto,
  ): Promise<OrderDocument> {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can update order status');
    }

    const order = await this.findOrderForUser(user, orderId);
    const currentStageIndex = this.getStatusStageIndex(order.status);
    const nextStageIndex = this.getStatusStageIndex(updateOrderStatusDto.status);

    if (nextStageIndex < currentStageIndex) {
      throw new BadRequestException('Order status cannot move backwards');
    }

    if (order.status === updateOrderStatusDto.status) {
      return order;
    }

    order.status = updateOrderStatusDto.status;
    order.statusHistory.push({
      status: updateOrderStatusDto.status,
      label: this.getStatusLabel(updateOrderStatusDto.status),
      changedAt: new Date(),
    });

    return order.save();
  }

  async getOrderStatus(user: AuthenticatedUser, orderId: string) {
    const order = await this.findOrderForUser(user, orderId);
    const currentStageIndex = this.getStatusStageIndex(order.status);

    return {
      orderId: String(order._id),
      status: order.status,
      statusLabel: this.getStatusLabel(order.status),
      currentStage: currentStageIndex + 1,
      totalStages: ORDER_STATUS_STAGES.length,
      stages: ORDER_STATUS_STAGES.map((stage, index) => ({
        status: stage.status,
        label: stage.label,
        stage: index + 1,
        isCurrent: index === currentStageIndex,
        isCompleted: index <= currentStageIndex,
      })),
      statusHistory: order.statusHistory,
    };
  }

  private async createOrderFromItems(
    userId: string,
    orderItems: OrderItemDto[],
  ): Promise<OrderDocument> {
    const items = await this.buildAvailableItemSnapshots(orderItems);
    const placedStatus = ORDER_STATUS_STAGES[0];

    return this.orderModel.create({
      userId: new Types.ObjectId(userId),
      items,
      totalAmount: this.calculateTotal(items),
      status: OrderStatus.PLACED,
      statusHistory: [
        {
          status: placedStatus.status,
          label: placedStatus.label,
          changedAt: new Date(),
        },
      ],
    });
  }

  private async findOrCreateCart(userId: string): Promise<CartDocument> {
    return this.cartModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            items: [],
            totalAmount: 0,
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec();
  }

  private async findOrderForUser(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderDocument> {
    this.assertObjectId(orderId, 'orderId');

    const query =
      user.role === UserRole.ADMIN
        ? { _id: new Types.ObjectId(orderId) }
        : {
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(user.sub),
          };

    const order = await this.orderModel.findOne(query).exec();
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private async buildAvailableItemSnapshots(
    orderItems: OrderItemDto[],
  ): Promise<ItemSnapshot[]> {
    const normalizedItems = this.normalizeItems(orderItems);
    const services = await this.serviceModel
      .find({
        _id: {
          $in: normalizedItems.map(
            (item) => new Types.ObjectId(item.serviceId),
          ),
        },
      })
      .exec();

    const servicesById = new Map(
      services.map((service) => [String(service._id), service]),
    );

    return normalizedItems.map((item) => {
      const service = servicesById.get(item.serviceId);

      if (!service) {
        throw new NotFoundException(`Service ${item.serviceId} was not found`);
      }

      if (service.isAvailable === false) {
        throw new BadRequestException(
          `${service.name} is not available right now`,
        );
      }

      return {
        serviceId: new Types.ObjectId(item.serviceId),
        serviceName: service.name,
        price: service.price,
        quantity: item.quantity,
      };
    });
  }

  private normalizeItems(orderItems: OrderItemDto[]): NormalizedItemInput[] {
    const mergedItems = new Map<string, number>();

    for (const item of orderItems) {
      this.assertObjectId(item.serviceId, 'serviceId');
      mergedItems.set(
        item.serviceId,
        (mergedItems.get(item.serviceId) ?? 0) + item.quantity,
      );
    }

    return [...mergedItems.entries()].map(([serviceId, quantity]) => ({
      serviceId,
      quantity,
    }));
  }

  private calculateTotal(items: Pick<OrderItem, 'price' | 'quantity'>[]) {
    return items.reduce(
      (total, item) => total + item.price * item.quantity,
      0,
    );
  }

  private getStatusLabel(status: OrderStatus): string {
    return (
      ORDER_STATUS_STAGES.find((stage) => stage.status === status)?.label ??
      status
    );
  }

  private getStatusStageIndex(status: OrderStatus): number {
    const index = ORDER_STATUS_STAGES.findIndex(
      (stage) => stage.status === status,
    );

    if (index === -1) {
      throw new BadRequestException('Unknown order status');
    }

    return index;
  }

  private assertObjectId(id: string, fieldName: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`${fieldName} must be a valid Mongo id`);
    }
  }
}
