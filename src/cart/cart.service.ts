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
    const { serviceId, quantity, category = 'instant' } = dto;

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

    // One order type at a time: Instant and Scheduled services cannot be
    // mixed in the same cart/order.
    if (quantity > 0) {
      const hasOtherCategory = cart.items.some(
        (item) => (item.category ?? 'instant') !== category,
      );
      if (hasOtherCategory) {
        throw new BadRequestException(
          category === 'instant'
            ? 'Your cart has Scheduled services. Please complete or clear that order before adding Instant services.'
            : 'Your cart has Instant services. Please complete or clear that order before adding Scheduled services.',
        );
      }
    }

    // Composite key: same service added from Instant tab vs Scheduled tab = separate line items
    const existingItem = cart.items.find(
      (item) =>
        item.serviceId.toString() === serviceId &&
        (item.category ?? 'instant') === category,
    );

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.subtotal =
        existingItem.quantity * existingItem.unitPriceSnapshot;
    } else {
      (cart.items as any[]).push({
        serviceId: service._id,
        serviceNameSnapshot: service.name,
        unitPriceSnapshot: service.price,
        quantity,
        subtotal: service.price * quantity,
        category,
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

    // Auto-clean items whose service has been deleted from the catalogue.
    // This prevents the user seeing "phantom" items they can never check out.
    const validItems: typeof cart.items = [];
    for (const item of cart.items) {
      const exists = await this.serviceModel.exists({ _id: item.serviceId });
      if (exists) {
        validItems.push(item);
      }
    }

    if (validItems.length !== cart.items.length) {
      cart.items = validItems;
      cart.totalAmount = validItems.reduce((s, i) => s + (i as any).subtotal, 0);
      await cart.save();
    }

    return cart;
  }

  /** Remove one specific line item identified by serviceId + category. */
  async removeItem(userId: string, serviceId: string, category?: string) {
    const cart = await this.cartModel.findOne({ userId });

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = cart.items.filter((item) => {
      if (item.serviceId.toString() !== serviceId) return true;
      // If category provided, only remove the matching category line
      if (category) return (item.category ?? 'instant') !== category;
      // No category → remove all lines for this service (legacy behaviour)
      return false;
    });

    cart.totalAmount = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

    return cart.save();
  }

  // Clear cart (used after checkout)
  async clearCart(userId: string) {
    return this.cartModel.updateOne({ userId }, { items: [], totalAmount: 0 });
  }
}
