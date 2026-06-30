import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { Order, OrderDocument, OrderStatus } from './schemas/order.schema';
import { Cart, CartDocument } from '../cart/schemas/cart.schema';
import {
  LaundryService,
  LaundryServiceDocument,
} from '../services/schemas/service.schema';
import {
  StandardTimeSlot,
  StandardTimeSlotDocument,
} from '../standard-time-slots/schemas/standard-time-slot.schema';
import { CheckoutContextDto } from './dto/checkout-context.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { LocationsService } from '../locations/locations.service';
import { ServiceZonesService } from '../service-zones/service-zones.service';

/** Labels that are never subject to slot-level capacity checks. */
const OPEN_SLOT_LABELS = new Set(['instant', 'full day', 'full-day']);

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name)
    private orderModel: Model<OrderDocument>,

    @InjectModel(Cart.name)
    private cartModel: Model<CartDocument>,

    @InjectModel(LaundryService.name)
    private serviceModel: Model<LaundryServiceDocument>,

    @InjectModel(StandardTimeSlot.name)
    private standardSlotModel: Model<StandardTimeSlotDocument>,

    private readonly locationsService: LocationsService,
    private readonly serviceZonesService: ServiceZonesService,
  ) {}

  // Create Order (legacy/direct)
  async checkout(userId: string, context?: CheckoutContextDto) {
    const order = await this.initiateCheckout(userId, context);
    await this.clearCart(userId);
    return order;
  }

  // Initiate Checkout (doesn't clear cart)
  async initiateCheckout(userId: string, context?: CheckoutContextDto) {
    const checkoutContext = context ?? {};

    let assignedLocation: any = null;

    // Service-zone coverage check:
    // Only enforced when at least one active service zone is configured.
    // If no zones exist, coverage is determined by the location's own
    // serviceRadiusKm / servicePolygon instead.
    const activeZoneCount = await this.serviceZonesService.countActive();
    if (
      activeZoneCount > 0 &&
      checkoutContext.pickupLatitude != null &&
      checkoutContext.pickupLongitude != null
    ) {
      await this.serviceZonesService.assertCovered(
        checkoutContext.pickupLatitude,
        checkoutContext.pickupLongitude,
        checkoutContext.city,
      );
    }

    const activeLocationCount =
      await this.locationsService.countActiveLocations();

    // Guard: 'default' and any non-ObjectId string come from the frontend's
    // CheckoutOptions.assumed() fallback — they mean the serviceability check
    // failed before the order was placed. Reject early with a clear message
    // instead of letting an invalid ID propagate into a $geoNear query crash.
    const rawLocationId = checkoutContext.locationId;
    const preferredLocationId =
      rawLocationId && isValidObjectId(rawLocationId) ? rawLocationId : undefined;

    if (rawLocationId && !preferredLocationId) {
      throw new BadRequestException(
        'Service is not available at your location yet. ' +
        'Please verify your address and try again.',
      );
    }

    if (
      checkoutContext.pickupLatitude != null &&
      checkoutContext.pickupLongitude != null
    ) {
      const requestedDate =
        checkoutContext.pickupDate ?? new Date().toISOString();
      assignedLocation = await this.locationsService.validateBookingEligibility(
        {
          latitude: checkoutContext.pickupLatitude,
          longitude: checkoutContext.pickupLongitude,
          city: checkoutContext.city,
          preferredLocationId,
          requestedDate,
          requestedTime: checkoutContext.pickupTime,
          pickupSlot: checkoutContext.pickupSlot,
          deliverySlot: checkoutContext.deliverySlot,
        },
      );

      // ── Standard slot capacity check ─────────────────────────────────────────
      // If the user selected a standard (admin-managed) pickup slot that has a
      // capacity set, verify that slot still has room. This is a belt-and-
      // suspenders check — the /standard-time-slots/available endpoint already
      // hides full slots, but we re-validate at order creation to handle race
      // conditions (two users booking the last spot at the same time).
      if (
        checkoutContext.pickupSlot &&
        !OPEN_SLOT_LABELS.has(checkoutContext.pickupSlot.trim().toLowerCase())
      ) {
        const stdSlot = await this.standardSlotModel
          .findOne({ label: checkoutContext.pickupSlot })
          .lean()
          .exec();

        if (stdSlot && stdSlot.capacity && stdSlot.capacity > 0) {
          const dateISO = new Date(requestedDate).toISOString().slice(0, 10);
          const dayStart = new Date(dateISO + 'T00:00:00.000Z');
          const dayEnd   = new Date(dateISO + 'T23:59:59.999Z');

          const slotBookedCount = await this.orderModel.countDocuments({
            pickupDate: { $gte: dayStart, $lte: dayEnd },
            pickupSlot: checkoutContext.pickupSlot,
            status: { $ne: OrderStatus.CANCELLED },
          });

          if (slotBookedCount >= stdSlot.capacity) {
            throw new BadRequestException(
              `The "${checkoutContext.pickupSlot}" slot is fully booked for today. Please choose a different slot.`,
            );
          }
        }
      }
    } else if (activeLocationCount > 0) {
      throw new BadRequestException(
        'Service not available in your area. Please share pickup address coordinates.',
      );
    }

    // Load cart
    const cart = await this.cartModel.findOne({ userId });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Validate + transform items. Skip any whose service was deleted from the
    // catalogue — auto-clean them from the cart so the user doesn't hit this
    // repeatedly. Unavailable or zero-qty items are also silently dropped.
    const staleServiceIds: string[] = [];
    const resolvedItems = await Promise.all(
      cart.items.map(async (item) => {
        if (item.quantity <= 0) return null;

        const service = await this.serviceModel.findById(item.serviceId).lean();

        if (!service) {
          staleServiceIds.push(item.serviceId.toString());
          return null; // will be filtered below
        }

        if (!service.isAvailable) return null;

        return {
          serviceId: item.serviceId,
          serviceName: service.name,
          quantity: item.quantity,
          price: service.price,
          category: (item as any).category ?? 'instant',
        };
      }),
    );

    // Auto-remove stale items so the cart is clean going forward
    if (staleServiceIds.length > 0) {
      cart.items = cart.items.filter(
        (i) => !staleServiceIds.includes(i.serviceId.toString()),
      );
      cart.totalAmount = cart.items.reduce((s, i) => s + (i as any).subtotal, 0);
      await cart.save();
    }

    const orderItems = resolvedItems.filter(Boolean) as NonNullable<typeof resolvedItems[number]>[];

    if (orderItems.length === 0) {
      throw new BadRequestException(
        'None of the items in your cart are currently available. ' +
        'Please add services and try again.',
      );
    }

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
      orderNumber: 'LB' + Date.now().toString().slice(-5),
      locationId: assignedLocation?._id?.toString(),
      locationSnapshot: assignedLocation
        ? {
            shopName: assignedLocation.shopName,
            fullAddress: assignedLocation.fullAddress,
            contactNumber: assignedLocation.contactNumber,
            city: assignedLocation.city,
          }
        : undefined,
      address: checkoutContext.address,
      pickupDate: checkoutContext.pickupDate
        ? new Date(checkoutContext.pickupDate)
        : assignedLocation
          ? new Date()
          : undefined,
      pickupSlot: checkoutContext.pickupSlot,
      deliverySlot: checkoutContext.deliverySlot,
      pickupTime: checkoutContext.pickupTime,
      pickupCoordinates:
        checkoutContext.pickupLatitude != null &&
        checkoutContext.pickupLongitude != null
          ? [checkoutContext.pickupLongitude, checkoutContext.pickupLatitude]
          : undefined,
      // Seed status history with the initial placement event
      statusHistory: [{ status: OrderStatus.ORDER_PLACED, timestamp: new Date() }],
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

    return { data, total, page, limit };
  }

  // Get single order (owner only)
  async findById(orderId: string, userId: string) {
    const order = await this.orderModel.findOne({ _id: orderId, userId });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // Get single order (admin — no ownership check)
  async findByIdAdmin(orderId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ADMIN: Update status with optional tracking fields
  async updateStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    if (!this.isValidTransition(order.status, dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${order.status} to ${dto.status}`,
      );
    }

    order.status = dto.status;

    // Record timestamp for this status change
    order.statusHistory = [
      ...(order.statusHistory ?? []),
      { status: dto.status, timestamp: new Date() },
    ];

    // PICKUP_ASSIGNED → set driver details
    if (dto.status === OrderStatus.PICKUP_ASSIGNED) {
      if (dto.driverName)  order.driverName  = dto.driverName.trim();
      if (dto.driverPhone) order.driverPhone = dto.driverPhone.trim();
    }

    // ITEMIZED → set weight / item count / bill
    if (dto.status === OrderStatus.ITEMIZED) {
      if (dto.weightKg  != null) order.weightKg  = dto.weightKg;
      if (dto.itemCount != null) order.itemCount  = dto.itemCount;
      if (dto.billAmount != null) order.billAmount = dto.billAmount;
    }

    // OUT_FOR_DELIVERY → auto-generate 4-digit OTP + tracking fields
    if (dto.status === OrderStatus.OUT_FOR_DELIVERY) {
      order.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
      if (dto.etaMinutes       != null) order.etaMinutes       = dto.etaMinutes;
      if (dto.driverDistanceKm != null) order.driverDistanceKm = dto.driverDistanceKm;
    }

    return order.save();
  }

  // USER: Get order stats summary
  async getMyOrdersSummary(userId: string) {
    const [activeCount, completedCount, cancelledCount, completedOrders] =
      await Promise.all([
        this.orderModel.countDocuments({
          userId,
          status: { $nin: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
        }),
        this.orderModel.countDocuments({ userId, status: OrderStatus.COMPLETED }),
        this.orderModel.countDocuments({ userId, status: OrderStatus.CANCELLED }),
        this.orderModel
          .find({ userId, status: OrderStatus.COMPLETED }, { totalAmount: 1 })
          .lean(),
      ]);

    // totalSaved: 10% of all completed orders' totals (loyalty savings estimate)
    const totalSaved = Math.round(
      completedOrders.reduce((sum, o) => sum + (o.totalAmount ?? 0), 0) * 0.1,
    );

    return { activeCount, completedCount, cancelledCount, totalSaved };
  }

  // USER: Rate a completed order
  async rateOrder(
    orderId: string,
    userId: string,
    rating: number,
    comment?: string,
  ) {
    const order = await this.orderModel.findOne({ _id: orderId, userId });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Only completed orders can be rated');
    }
    order.rating = rating;
    if (comment) order.ratingComment = comment.trim();
    return order.save();
  }

  // USER: Confirm delivery with OTP
  async confirmDelivery(orderId: string, otp: string, userId: string) {
    const order = await this.orderModel.findOne({ _id: orderId, userId });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      throw new BadRequestException('Order is not awaiting delivery confirmation');
    }

    if (order.deliveryOtp !== otp.trim()) {
      throw new BadRequestException('Invalid OTP. Please check with your delivery partner.');
    }

    order.status = OrderStatus.COMPLETED;
    order.statusHistory = [
      ...(order.statusHistory ?? []),
      { status: OrderStatus.COMPLETED, timestamp: new Date() },
    ];
    return order.save();
  }

  // Status transition rules
  private isValidTransition(current: OrderStatus, next: OrderStatus): boolean {
    const transitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.ORDER_PLACED]:     [OrderStatus.PICKUP_ASSIGNED, OrderStatus.CANCELLED],
      [OrderStatus.PICKUP_ASSIGNED]:  [OrderStatus.ITEMIZED, OrderStatus.CANCELLED],
      [OrderStatus.ITEMIZED]:         [OrderStatus.PROCESSING],
      [OrderStatus.PROCESSING]:       [OrderStatus.OUT_FOR_DELIVERY],
      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.COMPLETED],
      [OrderStatus.COMPLETED]:        [],
      [OrderStatus.CANCELLED]:        [],
    };
    return transitions[current]?.includes(next) ?? false;
  }
}
