import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Cart, CartDocument } from './schemas/cart.schema';
import {
  LaundryService,
  LaundryServiceDocument,
} from '../services/schemas/service.schema';
import { AddToCartDto } from './dto/add-to-cart.dto';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(LaundryService.name)
    private serviceModel: Model<LaundryServiceDocument>,
  ) {}

  async addItem(userId: string, dto: AddToCartDto) {
    const { serviceId, quantity } = dto;

    const service = await this.serviceModel.findById(serviceId);

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    if (!service.isAvailable) {
      throw new BadRequestException('Service not available');
    }

    let cart = await this.cartModel.findOne({ userId });

    if (!cart) {
      cart = new this.cartModel({ userId, items: [], totalAmount: 0 });
    }

    const existingItem = cart.items.find(
      (item) => item.serviceId.toString() === serviceId,
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.subtotal =
        existingItem.quantity * existingItem.unitPriceSnapshot;
    } else {
      cart.items.push({
        serviceId: service._id,
        serviceNameSnapshot: service.name,
        unitPriceSnapshot: service.price,
        quantity,
        subtotal: service.price * quantity,
      });
    }

    cart.totalAmount = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

    return cart.save();
  }


  async getCart(userId: string) {
    const cart = await this.cartModel.findOne({ userId });

    if (!cart) {
      return { items: [], totalAmount: 0 };
    }

    return cart;
  }

  async removeItem(userId: string, serviceId: string) {
    const cart = await this.cartModel.findOne({ userId });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = cart.items.filter(
      (item) => item.serviceId.toString() !== serviceId,
    );

    cart.totalAmount = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

    return cart.save();
  }

  // Clear cart (used after checkout)
  async clearCart(userId: string) {
    return this.cartModel.updateOne({ userId }, { items: [], totalAmount: 0 });
  }
}
