import {

  Injectable,

  BadRequestException,

  NotFoundException,

} from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';

import { Model, isValidObjectId } from 'mongoose';



import { Order, OrderDocument, OrderStatus, DeliveryType, PickupType, PaymentStatus } from './schemas/order.schema';

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

import {
  INSTANT_ORDER_UNAVAILABLE_MESSAGE,
  SCHEDULED_ORDER_UNAVAILABLE_MESSAGE,
} from '../common/instant-availability';

import { ServiceAvailabilityService } from '../service-availability/service-availability.service';

import { isDropAtShopDirectSelectionEnabled } from '../common/feature-flags';

import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

import { UpdateDeliveryDetailsDto } from './dto/update-delivery-details.dto';

import { LocationsService } from '../locations/locations.service';

import { ServiceZonesService } from '../service-zones/service-zones.service';

import { NotificationsService } from '../notifications/notifications.service';

import { SupportEventsService } from '../support/support-events.service';

import { UploadService } from '../upload/upload.service';

import { ClothTypesService } from '../cloth-types/cloth-types.service';

import { ReferralService } from '../referrals/services/referral.service';

import { UsersService } from '../users/users.service';

import { CouponsService } from '../coupons/services/coupons.service';

import { PricingService, PricingSnapshotReason } from '../pricing/pricing.service';

import { PricingUnit } from '../pricing/pricing-unit.enum';



export type OrderPhotoType = 'damage' | 'weighing';



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

    private readonly notificationsService: NotificationsService,

    private readonly socketEvents: SupportEventsService,

    private readonly uploadService: UploadService,

    private readonly clothTypesService: ClothTypesService,

    private readonly referralService: ReferralService,

    private readonly usersService: UsersService,

    private readonly couponsService: CouponsService,

    private readonly pricingService: PricingService,

    private readonly serviceAvailabilityService: ServiceAvailabilityService,

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



    const requestedDateForAssignment =

      checkoutContext.pickupDate ?? new Date().toISOString();



    // ── Location assignment: two explicit, non-overlapping modes ───────────
    // DIRECT_SELECTION (Drop at Shop): the customer walked in and picked this
    // exact branch — it is authoritative. Validated (active/open/slots/
    // capacity) but never silently swapped for a different, "nearer" branch.
    // AUTO_ASSIGN (Home Pickup/Reception/Delivery): unchanged — resolves the
    // nearest eligible branch from the customer's address coordinates.
    //
    // INVARIANT: for a DIRECT_SELECTION order, order.locationId must equal
    // the customer-selected locationId at every stage — here and afterward
    // (status updates, delivery-detail edits, payment, retries). No code
    // path may reassign it to a different location. If the selected branch
    // becomes unusable, checkout must fail with a typed error instead of
    // silently falling back to another branch.
    if (checkoutContext.serviceType === PickupType.DROP_AT_SHOP && isDropAtShopDirectSelectionEnabled()) {

      if (!preferredLocationId) {
        throw new BadRequestException(
          'Please select a branch to drop your laundry at.',
        );
      }

      assignedLocation = await this.locationsService.validateSelectedLocation(
        preferredLocationId,
        {
          requestedDate: requestedDateForAssignment,
          requestedTime: checkoutContext.pickupTime,
          pickupSlot: checkoutContext.pickupSlot,
          deliverySlot: checkoutContext.deliverySlot,
        },
      );

    } else if (

      checkoutContext.pickupLatitude != null &&

      checkoutContext.pickupLongitude != null

    ) {

      assignedLocation = await this.locationsService.validateBookingEligibility(

        {

          latitude: checkoutContext.pickupLatitude,

          longitude: checkoutContext.pickupLongitude,

          city: checkoutContext.city,

          preferredLocationId,

          requestedDate: requestedDateForAssignment,

          requestedTime: checkoutContext.pickupTime,

          pickupSlot: checkoutContext.pickupSlot,

          deliverySlot: checkoutContext.deliverySlot,

        },

      );

    } else if (activeLocationCount > 0) {

      throw new BadRequestException(

        'Service not available in your area. Please share pickup address coordinates.',

      );

    }



    // ── Standard slot capacity check ─────────────────────────────────────────

    // If the user selected a standard (admin-managed) pickup slot that has a

    // capacity set, verify that slot still has room. This is a belt-and-

    // suspenders check — the /standard-time-slots/available endpoint already

    // hides full slots, but we re-validate at order creation to handle race

    // conditions (two users booking the last spot at the same time). Runs for

    // both assignment modes — it's a global admin-slot check, not a geo one.

    if (

      assignedLocation &&

      checkoutContext.pickupSlot &&

      !OPEN_SLOT_LABELS.has(checkoutContext.pickupSlot.trim().toLowerCase())

    ) {

      const stdSlot = await this.standardSlotModel

        .findOne({ label: checkoutContext.pickupSlot })

        .lean()

        .exec();



      if (stdSlot && stdSlot.capacity && stdSlot.capacity > 0) {

        const dateISO = new Date(requestedDateForAssignment).toISOString().slice(0, 10);

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

          unit: service.unit ?? PricingUnit.KG,

          turnaroundHours: service.turnaroundHours ?? 24,

          instantTurnaroundMinutes: service.instantTurnaroundMinutes ?? 90,

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



    // Instant/Scheduled service can each be disabled or windowed by admin
    // (ServiceAvailabilityService). Checked against the cart item category
    // rather than checkoutContext.pickupSlot so this covers every
    // serviceType (Drop at Shop included) — a stale/fallback slot label
    // can't bypass it the way a slot-only check could.
    if (
      orderItems.some((i) => i.category === 'instant') &&
      !(await this.serviceAvailabilityService.isInstantAvailable())
    ) {
      throw new BadRequestException(INSTANT_ORDER_UNAVAILABLE_MESSAGE);
    }

    if (
      orderItems.some((i) => i.category === 'scheduled') &&
      !(await this.serviceAvailabilityService.isScheduledAvailable())
    ) {
      throw new BadRequestException(SCHEDULED_ORDER_UNAVAILABLE_MESSAGE);
    }



    // Calculate total

    const cartTotalAmount = orderItems.reduce(

      (sum, item) => sum + item.price * item.quantity,

      0,

    );

    // ── Coupon ("Have a Coupon?" at checkout) ───────────────────────────────
    // Always re-validated server-side against this specific user's
    // assignments — the coupon code is never trusted as-is. A rejected
    // coupon fails checkout with the same messages the /customer/coupon
    // endpoints return, so the FE can show one consistent error surface.
    let couponPreview: Awaited<ReturnType<typeof this.couponsService.validateForUser>> | null = null;
    if (checkoutContext.couponCode?.trim()) {
      couponPreview = await this.couponsService.validateForUser(userId, {
        couponCode: checkoutContext.couponCode,
        orderAmount: cartTotalAmount,
      });
    }

    // ── Centralized pricing engine ──────────────────────────────────────────
    // Every figure that ends up on the order (tax/delivery/fees/discounts/
    // total) is produced by PricingService so there's one audit trail and one
    // place that knows how to turn line items into a payable total — never
    // computed ad hoc here or trusted from the client.
    const pricingConfig = await this.pricingService.getConfig();
    const checkoutDeliveryType = checkoutContext.deliveryType ?? DeliveryType.HOME_DELIVERY;
    const pricingBreakdown = this.pricingService.compute({
      serviceLines: orderItems.map((item) => ({
        label: item.serviceName,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.price,
        amount: item.price * item.quantity,
      })),
      applyDeliveryFee: checkoutDeliveryType === DeliveryType.HOME_DELIVERY,
      discounts: couponPreview
        ? [{ label: `Coupon (${couponPreview.couponCode})`, amount: couponPreview.discountAmount, source: 'coupon' }]
        : [],
      config: pricingConfig,
    });

    const totalAmount = pricingBreakdown.payableTotal;



    // ── Delivery schedule ────────────────────────────────────────────────────
    // Scheduled orders: delivery is the same slot the user picked, but shifted
    // forward by the order's turnaround (e.g. 24h → next day, 48h → day after
    // next). Turnaround is per-service (see LaundryService.turnaroundHours,
    // default 24) — an order mixing services uses the longest one, since the
    // whole order is delivered together.
    // Instant orders: delivery is the pickup moment shifted forward by the
    // order's instant turnaround (see LaundryService.instantTurnaroundMinutes,
    // default 90) — same longest-wins rule when an order mixes services.
    const scheduledItems = orderItems.filter((i) => i.category === 'scheduled');
    const instantItems = orderItems.filter((i) => i.category === 'instant');
    const isScheduledOrder = scheduledItems.length > 0;

    // Scheduled orders anchor to the date the user picked. Instant orders have
    // no real "pickup date" to pick — they're anchored to the actual moment of
    // placement, so the client-sent date (which carries no time-of-day) is
    // ignored; using it would compute a delivery ETA around midnight instead
    // of relative to now, which can land before the order was even placed.
    const resolvedPickupDate = isScheduledOrder
      ? checkoutContext.pickupDate
        ? new Date(checkoutContext.pickupDate)
        : assignedLocation
          ? new Date()
          : undefined
      : assignedLocation
        ? new Date()
        : undefined;

    const turnaroundHours = isScheduledOrder
      ? Math.max(...scheduledItems.map((i) => i.turnaroundHours ?? 24))
      : 24;
    const instantTurnaroundMinutes = instantItems.length > 0
      ? Math.max(...instantItems.map((i) => i.instantTurnaroundMinutes ?? 90))
      : 90;

    // Scheduled orders keep a slot label (same slot the user picked, shifted
    // forward by turnaround). Instant orders have no real slot — any label the
    // client sent is discarded so the FE shows the computed ETA instead of a
    // delivery-slot string that has no relationship to the actual time.
    let deliverySlot: string | undefined;
    let deliveryDate: Date | undefined = resolvedPickupDate;
    if (isScheduledOrder && checkoutContext.pickupSlot) {
      deliverySlot = checkoutContext.pickupSlot;
      if (resolvedPickupDate) {
        deliveryDate = new Date(
          resolvedPickupDate.getTime() + turnaroundHours * 60 * 60 * 1000,
        );
      }
    } else if (!isScheduledOrder && resolvedPickupDate) {
      deliveryDate = new Date(
        resolvedPickupDate.getTime() + instantTurnaroundMinutes * 60 * 1000,
      );
    }

    // ── Return-delivery choice ────────────────────────────────────────────────
    // How the *finished* order gets back to the customer — independent of how
    // the dirty laundry was collected (checkoutContext.address / serviceType).
    const deliveryType = checkoutContext.deliveryType ?? DeliveryType.HOME_DELIVERY;
    if (deliveryType === DeliveryType.HOME_DELIVERY && !checkoutContext.deliveryAddress) {
      throw new BadRequestException(
        'A delivery address is required when choosing home delivery for your finished order.',
      );
    }

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

      pickupType: checkoutContext.serviceType,

      receptionDetails:
        checkoutContext.serviceType === PickupType.HOME_RECEPTION ? checkoutContext.receptionDetails : undefined,

      deliveryType,

      deliveryAddress:
        deliveryType === DeliveryType.HOME_DELIVERY ? checkoutContext.deliveryAddress : undefined,

      pickupDate: resolvedPickupDate,

      pickupSlot: checkoutContext.pickupSlot,

      deliverySlot,

      deliveryDate,

      pickupTime: checkoutContext.pickupTime,

      pickupCoordinates:

        checkoutContext.pickupLatitude != null &&

        checkoutContext.pickupLongitude != null

          ? [checkoutContext.pickupLongitude, checkoutContext.pickupLatitude]

          : undefined,

      // Seed status history with the initial placement event

      statusHistory: [{ status: OrderStatus.ORDER_PLACED, timestamp: new Date() }],

      couponCode: couponPreview?.couponCode,
      couponId: couponPreview?.couponId,
      couponDiscountAmount: couponPreview?.discountAmount ?? 0,

      taxAmount: pricingBreakdown.taxAmount,
      deliveryFee: pricingBreakdown.deliveryFee,
      platformFee: pricingBreakdown.platformFee,
      convenienceFee: pricingBreakdown.convenienceFee,
      packagingFee: pricingBreakdown.packagingFee,
      roundingAdjustment: pricingBreakdown.roundingAdjustment,

    });



    const savedOrder = await order.save();

    // Immutable pricing snapshot for this checkout estimate — failures here
    // must never fail checkout itself, since the order has already been placed.
    try {
      const snapshot = await this.pricingService.recordSnapshot(
        String(savedOrder._id),
        PricingSnapshotReason.ORDER_ESTIMATE,
        pricingBreakdown,
      );
      savedOrder.latestPricingSnapshotId = String(snapshot._id);
      await savedOrder.save();
    } catch (e) {
      // swallow — pricing snapshot is an audit-trail nicety, not a checkout blocker
    }



    const savedOrderNumber = savedOrder.orderNumber ?? '';



    // Notify admins over WebSocket that a new order arrived.

    this.socketEvents.emitNewOrder({

      _id: String(savedOrder._id),

      orderNumber: savedOrderNumber,

      userId,

      pickupType: savedOrder.pickupType,

    });



    // Fire ORDER_PLACED push notification (non-blocking)

    this.notificationsService

      .notifyOrderStatus(userId, savedOrderNumber, OrderStatus.ORDER_PLACED)

      .catch(() => { /* swallow — notification errors must not fail checkout */ });

    // Admin notification bar: new order arrived (non-blocking)
    this.notificationsService
      .notifyAdmin({
        title: 'New Order 🧺',
        body: `Order #${savedOrderNumber} placed — ₹${savedOrder.totalAmount ?? 0}.`,
        type: 'order_created',
        orderId: savedOrderNumber,
      })
      .catch(() => { /* swallow */ });

    return savedOrder;



  }



  async clearCart(userId: string) {

    await this.cartModel.updateOne({ userId }, { items: [], totalAmount: 0 });

  }

  /**
   * User-initiated cancellation.
   * Allowed only before itemization (ORDER_PLACED / PICKUP_ASSIGNED),
   * mirroring the admin status transition rules.
   */
  async cancelByUser(orderId: string, userId: string) {
    const order = await this.orderModel.findOne({ _id: orderId, userId });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.CANCELLED) {
      return order; // idempotent
    }
    if (
      order.status !== OrderStatus.ORDER_PLACED &&
      order.status !== OrderStatus.PICKUP_ASSIGNED
    ) {
      throw new BadRequestException(
        'This order can no longer be cancelled. Please contact support.',
      );
    }

    order.status = OrderStatus.CANCELLED;
    order.statusHistory = [
      ...(order.statusHistory ?? []),
      { status: OrderStatus.CANCELLED, timestamp: new Date() },
    ];
    const cancelled = await order.save();

    const orderNumber = cancelled.orderNumber ?? '';

    this.socketEvents.emitOrderUpdated({
      _id: String(cancelled._id),
      orderNumber,
      status: OrderStatus.CANCELLED,
      userId,
    });

    this.notificationsService
      .notifyOrderStatus(userId, orderNumber, OrderStatus.CANCELLED)
      .catch(() => { /* swallow */ });

    this.notificationsService
      .notifyAdmin({
        title: 'Order Cancelled ❌',
        body: `Order #${orderNumber} was cancelled by the customer.`,
        type: 'order_cancelled',
        orderId: orderNumber,
      })
      .catch(() => { /* swallow */ });

    return cancelled;
  }

  /**
   * USER: Re-confirm or change how the finished order will get back to them
   * (self-pickup vs home-delivery). Only allowed pre-dispatch (ITEMIZED /
   * PROCESSING) and before payment — once admin has committed to a delivery
   * path by advancing to READY_FOR_PICKUP/OUT_FOR_DELIVERY (driver assignment
   * etc.), or once paid (a customer can still pay early during PROCESSING,
   * before dispatch), the choice is locked in. Status check is allowlisted
   * rather than blacklisted so a future status doesn't accidentally become
   * editable by omission.
   */
  async updateDeliveryDetails(orderId: string, userId: string, dto: UpdateDeliveryDetailsDto) {
    const order = await this.orderModel.findOne({ _id: orderId, userId });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status !== OrderStatus.ITEMIZED && order.status !== OrderStatus.PROCESSING) {
      throw new BadRequestException(
        'Delivery details can no longer be changed once the order is being dispatched.',
      );
    }

    if (order.paymentStatus === PaymentStatus.COMPLETED) {
      throw new BadRequestException(
        'Payment has already been made — delivery details can no longer be changed.',
      );
    }

    if (dto.deliveryType === DeliveryType.HOME_DELIVERY && !dto.deliveryAddress) {
      throw new BadRequestException(
        'A delivery address is required when choosing home delivery for your finished order.',
      );
    }

    order.deliveryType = dto.deliveryType;
    order.deliveryAddress =
      dto.deliveryType === DeliveryType.HOME_DELIVERY ? dto.deliveryAddress : undefined;

    return order.save();
  }

  // Get all orders for user

  async findMyOrders(userId: string) {

    const orders = await this.orderModel.find({ userId }).sort({ createdAt: -1 });

    return this.attachCustomerEta(orders);

  }



  // ADMIN: Get all orders (paginated + sorted + filtered)

  async findAll(

    page: number = 1,

    limit: number = 10,

    status?: OrderStatus,

    sortField: string = 'createdAt',

    sortDir: 'asc' | 'desc' = 'desc',

    search?: string,

  ) {

    const skip   = (page - 1) * limit;

    const filter: Record<string, any> = status ? { status } : {};



    // Global search across orderNumber (Order-side) and customer name /
    // mobile number (User-side — not stored on Order, so resolve matching
    // userIds first). This runs before pagination so results are correct
    // across the whole dataset, not just the currently loaded page.
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      const regex = new RegExp(this.escapeRegex(trimmedSearch), 'i');
      const matchedUserIds = await this.usersService.findIdsByNameOrMobile(regex);
      filter.$or = [{ orderNumber: regex }, { userId: { $in: matchedUserIds } }];
    }



    // Whitelist sort fields to prevent injection

    const allowedSorts = new Set(['createdAt', 'updatedAt', 'billAmount', 'totalAmount']);

    const safeSort = allowedSorts.has(sortField) ? sortField : 'createdAt';

    const sortObj: Record<string, 1 | -1> = { [safeSort]: sortDir === 'asc' ? 1 : -1 };



    const [orders, total] = await Promise.all([

      this.orderModel.find(filter).sort(sortObj).skip(skip).limit(limit),

      this.orderModel.countDocuments(filter),

    ]);



    const data = await this.attachCustomerInfo(orders);



    return { data, total, page, limit };

  }



  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }



  /** Minutes-remaining threshold below which an active SLA counts as "Due Soon" rather than "On Time". Env-configurable, defaults to 30. */
  private slaDueSoonThresholdMs(): number {
    const minutes = Number(process.env.SLA_DUE_SOON_THRESHOLD_MINUTES);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
  }

  /**
   * SLA milestone/deadline/status for the admin countdown UI. Reuses the
   * PICKUP-phase deadline already resolved by the caller (the same value
   * that gates cancellation eligibility) and the order's own `deliveryDate`
   * (already computed once at checkout as the committed instant-completion
   * / scheduled-delivery deadline) — no new stored field, no duplicate
   * calculation. Never trusts anything client-supplied.
   */
  private computeSlaStatus(order: OrderDocument, pickupDeadline: Date | null, now: Date) {
    if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.CANCELLED) {
      return { slaMilestone: null, slaDeadline: null, slaStatus: null };
    }

    const isInstant = (order.items ?? []).some((i: any) => i.category === 'instant');
    let milestone: 'PICKUP' | 'DELIVERY' | 'COMPLETION';
    let deadline: Date | null;

    if (isInstant) {
      milestone = 'COMPLETION';
      deadline = order.deliveryDate ?? null;
    } else if (order.status === OrderStatus.ORDER_PLACED) {
      milestone = 'PICKUP';
      deadline = pickupDeadline;
    } else {
      milestone = 'DELIVERY';
      deadline = order.deliveryDate ?? null;
    }

    if (!deadline) return { slaMilestone: milestone, slaDeadline: null, slaStatus: null };

    const msRemaining = deadline.getTime() - now.getTime();
    const slaStatus =
      msRemaining < 0 ? 'OVERDUE' : msRemaining <= this.slaDueSoonThresholdMs() ? 'DUE_SOON' : 'ON_TIME';

    return { slaMilestone: milestone, slaDeadline: deadline, slaStatus };
  }

  /**
   * Batch-resolves the pickup-slot-end deadline for every ORDER_PLACED order
   * in the list, keyed by order id — avoids a query per order (N+1) and a
   * query entirely when none are pickup-pending. Shared by attachCustomerInfo
   * (admin) and attachCustomerEta (customer) so the deadline logic used for
   * cancellation-eligibility, the admin SLA countdown, and the customer ETA
   * badge can never drift apart.
   */
  private async resolvePickupDeadlines(orders: OrderDocument[]): Promise<Map<string, Date>> {
    const pendingLabels = [...new Set(
      orders
        .filter((o) => o.status === OrderStatus.ORDER_PLACED && o.pickupSlot)
        .map((o) => o.pickupSlot!.trim())
        .filter((label) => label.toLowerCase() !== 'instant'),
    )];
    let slotEndTimeByLabel = new Map<string, string>();
    if (pendingLabels.length > 0) {
      const slots = await this.standardSlotModel
        .find({ label: { $in: pendingLabels.map((l) => new RegExp(`^${this.escapeRegex(l)}$`, 'i')) } })
        .select('label endTime')
        .lean()
        .exec();
      slotEndTimeByLabel = new Map(slots.map((s) => [s.label.toLowerCase(), s.endTime]));
    }

    const deadlines = new Map<string, Date>();
    for (const o of orders) {
      if (o.status !== OrderStatus.ORDER_PLACED || !o.pickupDate) continue;
      const label = o.pickupSlot?.trim();
      const endTime =
        label && label.toLowerCase() !== 'instant'
          ? slotEndTimeByLabel.get(label.toLowerCase()) ?? '23:59'
          : '23:59';
      deadlines.set(String(o._id), this.buildDeadlineDate(o.pickupDate.toISOString().slice(0, 10), endTime));
    }
    return deadlines;
  }

  /**
   * Attaches customerName/customerPhone (looked up from Users), canAdminCancel
   * (whether this order is an expired-Pending order eligible for admin
   * cancellation), and SLA milestone/deadline/status (for the countdown UI)
   * to order docs for admin display/printing.
   */

  private async attachCustomerInfo(orders: OrderDocument[]) {

    const userMap = await this.usersService.findNamesByIds(orders.map((o) => o.userId));

    const pickupDeadlines = await this.resolvePickupDeadlines(orders);
    const now = new Date();

    return orders.map((o) => {

      const plain: any = o.toObject ? o.toObject() : o;

      const info = userMap.get(String(o.userId));

      plain.customerName = info?.name;

      plain.customerPhone = info?.mobileNumber;

      const pickupDeadline = pickupDeadlines.get(String(o._id)) ?? null;
      plain.canAdminCancel = pickupDeadline !== null && pickupDeadline <= now;

      Object.assign(plain, this.computeSlaStatus(o, pickupDeadline, now));

      return plain;

    });

  }

  /**
   * Attaches a customer-friendly ETA (etaMilestone: 'PICKUP' | 'DELIVERY' |
   * 'COMPLETION' | null, etaDeadline: Date | null) to order docs for the
   * customer app's order list/detail. Reuses the same milestone/deadline
   * resolution as the admin SLA countdown (computeSlaStatus), but
   * deliberately omits slaStatus/OVERDUE — that label is an internal ops
   * signal about the business missing its own deadline and isn't meant to
   * be shown to the customer as an alarm; the app instead compares
   * etaDeadline to now and softens the copy itself when running late.
   */
  private async attachCustomerEta(orders: OrderDocument[]) {
    const pickupDeadlines = await this.resolvePickupDeadlines(orders);
    const now = new Date();

    return orders.map((o) => {
      const plain: any = o.toObject ? o.toObject() : o;
      const pickupDeadline = pickupDeadlines.get(String(o._id)) ?? null;
      const { slaMilestone, slaDeadline } = this.computeSlaStatus(o, pickupDeadline, now);
      plain.etaMilestone = slaMilestone;
      plain.etaDeadline = slaDeadline;
      return plain;
    });
  }

  /**
   * Best-available customer-facing address for a single order — prefers the
   * structured return-delivery address (deliveryAddress), falling back to the
   * plain pickup address string (address). Returns undefined if neither is
   * set, rather than an empty string, so callers can distinguish "no address
   * on file" from a genuinely blank value.
   */
  private formatOrderAddress(order: OrderDocument | any): string | undefined {
    const d = order.deliveryAddress;
    if (d) {
      const line = [d.houseNo, d.buildingName, d.street, d.area, d.landmark, d.city, d.state, d.pincode]
        .filter((part) => typeof part === 'string' && part.trim().length > 0)
        .join(', ');
      if (line) return line;
    }
    return order.address || undefined;
  }

  /**
   * Attaches a minimal `customer` object ({ name, phone, address }) to each
   * order for the delivery-partner view. Deliberately allowlists only these
   * three fields from the User lookup — never spreads the full user document
   * — so password/email/walletBalance/fcmTokens/etc. can never leak here even
   * if `findNamesByIds` is later changed to select more fields.
   */
  private async attachCustomerContactForDelivery(orders: OrderDocument[]) {

    const userMap = await this.usersService.findNamesByIds(orders.map((o) => o.userId));

    return orders.map((o) => {

      const plain: any = o.toObject ? o.toObject() : o;

      const info = userMap.get(String(o.userId));

      plain.customer = {
        name: info?.name,
        phone: info?.mobileNumber,
        address: this.formatOrderAddress(o),
      };

      return plain;

    });

  }



  /**
   * How much to knock off a bill because this is the customer's very first
   * order. Reuses the admin's referral settings (min. first order value,
   * welcome bonus, max reward cap) as the source of truth so there's one
   * config screen instead of two. Eligibility is simply "zero prior
   * completed orders" — once this order is paid it becomes that first
   * completed order, so the check self-expires with no extra flag to manage.
   * Returns 0 when not eligible.
   */
  private async resolveFirstOrderDiscount(
    userId: string,
    billAmount: number,
  ): Promise<number> {
    if (!billAmount || billAmount <= 0) return 0;

    const config = await this.referralService.getFirstOrderIncentiveConfig();
    if (!config.enabled) return 0;
    if (billAmount < config.minimumOrderValue) return 0;

    const hasCompletedOrder = await this.orderModel.exists({
      userId,
      paymentStatus: PaymentStatus.COMPLETED,
    });
    if (hasCompletedOrder) return 0;

    let discount = config.rewardAmount;
    if (config.maxCap > 0) discount = Math.min(discount, config.maxCap);
    discount = Math.min(discount, billAmount);
    return Math.round(discount * 100) / 100;
  }

  /** Builds a deadline Date from a calendar date + HH:MM, interpreted in IST. */
  private buildDeadlineDate(dateISO: string, endTimeHHMM: string): Date {
    return new Date(`${dateISO}T${endTimeHHMM}:00.000+05:30`);
  }

  /**
   * Deadline after which a still-Pending (ORDER_PLACED) order becomes
   * eligible for admin cancellation — the end of its scheduled pickup
   * window. Falls back to end-of-day on pickupDate when no matching slot
   * can be resolved (Instant orders, or a stale/unknown slot label).
   */
  private async resolvePickupDeadline(order: OrderDocument): Promise<Date | null> {
    if (!order.pickupDate) return null;
    const dateISO = order.pickupDate.toISOString().slice(0, 10);
    const label = order.pickupSlot?.trim();

    if (label && label.toLowerCase() !== 'instant') {
      const slot = await this.standardSlotModel
        .findOne({ label: { $regex: `^${this.escapeRegex(label)}$`, $options: 'i' } })
        .select('endTime')
        .lean()
        .exec();
      if (slot?.endTime) return this.buildDeadlineDate(dateISO, slot.endTime);
    }

    return this.buildDeadlineDate(dateISO, '23:59');
  }

  // Get single order (owner only)

  async findById(orderId: string, userId: string) {

    const order = await this.orderModel.findOne({ _id: orderId, userId });

    if (!order) throw new NotFoundException('Order not found');

    const [withEta] = await this.attachCustomerEta([order]);

    return withEta;

  }



  // Get single order (admin — no ownership check)

  async findByIdAdmin(orderId: string) {

    const order = await this.orderModel.findById(orderId);

    if (!order) throw new NotFoundException('Order not found');

    const [withInfo] = await this.attachCustomerInfo([order]);

    return withInfo;

  }



  // ADMIN: Update status with optional tracking fields

  async updateStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    actor?: { adminId: string; ip?: string },
  ) {

    const order = await this.orderModel.findById(orderId);

    if (!order) throw new NotFoundException('Order not found');



    if (!this.isValidTransition(order, dto.status)) {

      throw new BadRequestException(

        `Cannot transition from ${order.status} to ${dto.status}`,

      );

    }



    // CANCELLED (from ORDER_PLACED / "Pending") is only allowed once the
    // scheduled pickup window has passed — cancelling an already-assigned
    // order (PICKUP_ASSIGNED → CANCELLED) is a separate, pre-existing admin
    // action and is not deadline-gated.
    if (dto.status === OrderStatus.CANCELLED && order.status === OrderStatus.ORDER_PLACED) {
      const deadline = await this.resolvePickupDeadline(order);
      if (!deadline || deadline > new Date()) {
        throw new BadRequestException(
          'This order cannot be cancelled yet — the scheduled pickup window has not passed.',
        );
      }
    }



    // Captured before mutation — used as the atomic guard below so two
    // concurrent cancel requests (or a cancel racing another concurrent
    // status update) can't both silently apply.
    const previousStatus = order.status;

    order.status = dto.status;



    // Record timestamp for this status change

    order.statusHistory = [

      ...(order.statusHistory ?? []),

      { status: dto.status, timestamp: new Date() },

    ];



    // Admin-initiated cancellation audit trail — recorded regardless of
    // which prior status allowed it.
    if (dto.status === OrderStatus.CANCELLED) {
      order.cancelledBy = actor?.adminId;
      order.cancelledAt = new Date();
      if (dto.cancellationReason?.trim()) order.cancellationReason = dto.cancellationReason.trim();
    }



    // PICKUP_ASSIGNED → set driver details

    if (dto.status === OrderStatus.PICKUP_ASSIGNED) {

      if (dto.driverName)  order.driverName  = dto.driverName.trim();

      if (dto.driverPhone) order.driverPhone = dto.driverPhone.trim();

    }



    // ITEMIZED → validate mandatory fields + set weight / item count / bill / pickupTime

    if (dto.status === OrderStatus.ITEMIZED) {

      // Handle cloth-type breakdown with backend calculation
      if (dto.clothTypeBreakdown && dto.clothTypeBreakdown.length > 0) {
        const clothTypeIds = dto.clothTypeBreakdown.map(item => item.clothTypeId);
        const clothTypes = await this.clothTypesService.findByIds(clothTypeIds);
        const clothTypeMap = new Map(clothTypes.map(c => [c._id.toString(), c]));

        // Default when a line doesn't specify its own serviceType: derive it
        // from the order's items (normally all-instant or all-scheduled, since
        // the cart enforces mutual exclusion at add-time).
        const isScheduledOrder = (order.items ?? []).some(
          (i: any) => i.category === 'scheduled',
        );
        const defaultServiceType = isScheduledOrder ? 'scheduled' : 'instant';

        const clothBreakdownWithCalc = dto.clothTypeBreakdown.map(item => {
          const clothType = clothTypeMap.get(item.clothTypeId);
          if (!clothType) {
            throw new BadRequestException(`Cloth type with ID ${item.clothTypeId} not found`);
          }
          const serviceType = item.serviceType ?? defaultServiceType;
          const isScheduled = serviceType === 'scheduled';
          const baseRate = isScheduled ? clothType.scheduledRate : clothType.instantRate;
          const discountRate = isScheduled
            ? clothType.discountScheduledRate
            : clothType.discountInstantRate;
          const rate = discountRate ?? baseRate;
          const amount = item.quantity * rate;
          return {
            clothTypeId: item.clothTypeId,
            clothTypeName: clothType.name,
            quantity: item.quantity,
            rate,
            amount,
            serviceType,
            // Snapshotted once, here, at itemization time — never re-fetched
            // from ClothType afterward, so a later rename of the catalog
            // category can't silently rewrite historical orders/invoices.
            serviceName: clothType.category ?? '-',
            unit: clothType.unit ?? PricingUnit.PIECE,
          };
        });

        const calculatedAmount = clothBreakdownWithCalc.reduce((sum, item) => sum + item.amount, 0);
        order.clothTypeBreakdown = clothBreakdownWithCalc;
        order.calculatedAmount = calculatedAmount;

        // ── Billing: always goes through the pricing engine ─────────────────
        // dto.billAmount differing from calculatedAmount is a manual admin
        // override — it requires a reason and always produces an immutable
        // snapshot + PriceAdjustmentLog entry (never a silent overwrite).
        const isOverride = dto.billAmount != null && dto.billAmount !== calculatedAmount;
        if (isOverride && !dto.overrideReason?.trim()) {
          throw new BadRequestException(
            'A reason is required when the bill amount differs from the calculated amount.',
          );
        }

        const pricingConfig = await this.pricingService.getConfig();
        const breakdown = this.pricingService.compute({
          serviceLines: clothBreakdownWithCalc.map((c) => ({
            label: c.clothTypeName,
            quantity: c.quantity,
            unit: c.unit,
            rate: c.rate,
            amount: c.amount,
          })),
          applyDeliveryFee: false,
          config: pricingConfig,
          manualOverride: isOverride
            ? { amount: dto.billAmount!, reason: dto.overrideReason!.trim() }
            : undefined,
        });

        order.billAmount = breakdown.payableTotal;
        order.taxAmount = breakdown.taxAmount;
        order.deliveryFee = breakdown.deliveryFee;
        order.platformFee = breakdown.platformFee;
        order.convenienceFee = breakdown.convenienceFee;
        order.packagingFee = breakdown.packagingFee;
        order.roundingAdjustment = breakdown.roundingAdjustment;

        const snapshot = await this.pricingService.recordSnapshot(
          orderId,
          isOverride ? PricingSnapshotReason.ADMIN_OVERRIDE : PricingSnapshotReason.ITEMIZED,
          breakdown,
          isOverride ? actor?.adminId : undefined,
        );
        order.latestPricingSnapshotId = String(snapshot._id);

        if (isOverride) {
          order.isManuallyAdjusted = true;

          const diffPercent =
            calculatedAmount > 0
              ? (Math.abs(dto.billAmount! - calculatedAmount) / calculatedAmount) * 100
              : 100;
          if (diffPercent > pricingConfig.maxOverridePercent) {
            order.needsManualReview = true;
            order.needsManualReviewReason = `Admin price override of ${diffPercent.toFixed(1)}% exceeds the ${pricingConfig.maxOverridePercent}% threshold — flagged for review`;
          }

          if (actor?.adminId) {
            this.pricingService
              .recordAdjustment({
                orderId,
                previousAmount: calculatedAmount,
                newAmount: dto.billAmount!,
                reason: dto.overrideReason!.trim(),
                adminId: actor.adminId,
                ipAddress: actor.ip,
              })
              .catch(() => { /* swallow — audit log failure must not block the status update */ });
          }
        }
      } else {
        // Original validation if no cloth breakdown — no calculated baseline
        // exists in this legacy path, so dto.billAmount is trusted as-is
        // (same as before), just routed through the engine for consistent
        // tax/fee fields and an audit snapshot.
        if (dto.billAmount == null || dto.billAmount <= 0) {
          throw new BadRequestException('Bill amount is required and must be greater than 0 when itemizing an order.');
        }
        const pricingConfig = await this.pricingService.getConfig();
        const breakdown = this.pricingService.compute({
          // No real per-item breakdown exists in this legacy path — the
          // whole bill is a single line so the itemized-breakdown UI still
          // has something concrete to render instead of nothing.
          serviceLines: [
            { label: 'Bill Amount', quantity: 1, unit: PricingUnit.ORDER, rate: dto.billAmount, amount: dto.billAmount },
          ],
          applyDeliveryFee: false,
          config: pricingConfig,
        });
        order.billAmount = breakdown.payableTotal;
        order.taxAmount = breakdown.taxAmount;
        order.deliveryFee = breakdown.deliveryFee;
        order.platformFee = breakdown.platformFee;
        order.convenienceFee = breakdown.convenienceFee;
        order.packagingFee = breakdown.packagingFee;
        order.roundingAdjustment = breakdown.roundingAdjustment;

        const snapshot = await this.pricingService.recordSnapshot(
          orderId,
          PricingSnapshotReason.ITEMIZED,
          breakdown,
        );
        order.latestPricingSnapshotId = String(snapshot._id);
      }

      // First-order discount — applied once the real bill is known so the
      // customer sees (and pays) the reduced amount, and it's baked into
      // billAmount before the Razorpay order is ever minted. Naturally never
      // re-applies on later orders since eligibility requires zero prior
      // completed orders.
      const firstOrderDiscount = await this.resolveFirstOrderDiscount(
        order.userId,
        order.billAmount!,
      );
      if (firstOrderDiscount > 0) {
        order.originalBillAmount = order.billAmount;
        order.firstOrderDiscountAmount = firstOrderDiscount;
        order.billAmount = Math.round((order.billAmount! - firstOrderDiscount) * 100) / 100;
      } else {
        order.firstOrderDiscountAmount = 0;
      }

      // Pickup time is optional — set it only if provided.

      if (dto.weightKg != null) order.weightKg = dto.weightKg;
      if (dto.itemCount != null) order.itemCount = dto.itemCount;
      if (dto.pickupTime) order.pickupTime = dto.pickupTime.trim();

    }



    // OUT_FOR_DELIVERY → set tracking fields. Payment is no longer required
    // to dispatch — the customer pays after the order is out for delivery /
    // ready for pickup, and that payment is what generates deliveryOtp.

    if (dto.status === OrderStatus.OUT_FOR_DELIVERY) {

      if (dto.etaMinutes       != null) order.etaMinutes       = dto.etaMinutes;

      if (dto.driverDistanceKm != null) order.driverDistanceKm = dto.driverDistanceKm;

      if (dto.deliveryPartnerId)   order.deliveryPartnerId   = dto.deliveryPartnerId.trim();

      if (dto.deliveryPartnerName) order.deliveryPartnerName = dto.deliveryPartnerName.trim();

    }



    // READY_FOR_PICKUP → self-pickup orders skip driver/partner assignment.
    // Payment is no longer required to reach this status (see OUT_FOR_DELIVERY above).



    // COMPLETED → admin must enter the OTP to confirm delivery

    if (dto.status === OrderStatus.COMPLETED) {

      if (!order.deliveryOtp) {

        throw new BadRequestException('No delivery OTP found for this order.');

      }

      if (!dto.otp || dto.otp.trim() !== order.deliveryOtp) {

        throw new BadRequestException('Invalid OTP. Please verify the code with the customer and try again.');

      }

    }



    // CANCELLED uses an atomic conditional write, guarded on the status we
    // originally read, instead of the plain save() every other transition
    // uses — closes the TOCTOU window where two concurrent cancel requests
    // (or a cancel racing another concurrent status update) could otherwise
    // both read the same pre-cancel state and both "succeed".
    let updatedOrder: OrderDocument;
    if (dto.status === OrderStatus.CANCELLED) {
      const result = await this.orderModel.findOneAndUpdate(
        { _id: orderId, status: previousStatus },
        {
          $set: {
            status: OrderStatus.CANCELLED,
            cancelledBy: order.cancelledBy,
            cancelledAt: order.cancelledAt,
            ...(order.cancellationReason ? { cancellationReason: order.cancellationReason } : {}),
          },
          $push: { statusHistory: { status: OrderStatus.CANCELLED, timestamp: new Date() } },
        },
        { new: true },
      );
      if (!result) {
        throw new BadRequestException(
          'This order was already updated by another request — please refresh and try again.',
        );
      }
      updatedOrder = result;
    } else {
      updatedOrder = await order.save();
    }



    const updatedOrderNumber = updatedOrder.orderNumber ?? '';



    // Notify admins over WebSocket about the status change.

    this.socketEvents.emitOrderUpdated({

      _id: String(updatedOrder._id),

      orderNumber: updatedOrderNumber,

      status: dto.status,

      userId: updatedOrder.userId.toString(),

    });



    // Fire push notification for the new status (non-blocking)

    this.notificationsService

      .notifyOrderStatus(

        updatedOrder.userId.toString(),

        updatedOrderNumber,

        dto.status,

        updatedOrder.deliveryType,

        updatedOrder.billAmount,

      )

      .catch(() => { /* swallow — notification errors must not fail status update */ });

    // Admin notification bar for important transitions (non-blocking)
    if (dto.status === OrderStatus.CANCELLED || dto.status === OrderStatus.COMPLETED) {
      const isSelfPickup = updatedOrder.deliveryType === DeliveryType.SELF_PICKUP;
      this.notificationsService
        .notifyAdmin({
          title: dto.status === OrderStatus.CANCELLED
            ? 'Order Cancelled ❌'
            : isSelfPickup ? 'Order Delivered ✅' : 'Order Delivered ✅',
          body: `Order #${updatedOrderNumber} was ${
            dto.status === OrderStatus.CANCELLED ? 'cancelled' : isSelfPickup ? 'picked up by the customer' : 'delivered'
          }.`,
          type: dto.status === OrderStatus.CANCELLED ? 'order_cancelled' : 'order_completed',
          orderId: updatedOrderNumber,
        })
        .catch(() => { /* swallow */ });
    }

    // ── Refer & Earn milestone hook (non-blocking) ────────────────────────────
    // A COMPLETED order means it was delivered (OTP confirmed) and — since the
    // delivery OTP is only issued after payment — already paid. This is the
    // "first successful paid, delivered, non-cancelled order" that qualifies a
    // referral for its reward. Failures here must never break order updates.
    if (dto.status === OrderStatus.COMPLETED) {
      this.referralService
        .handleQualifyingOrder(updatedOrder.userId.toString(), {
          _id: updatedOrder._id,
          status: updatedOrder.status,
          paymentStatus: (updatedOrder as any).paymentStatus,
          // Use the pre-discount value so our own first-order discount never
          // shrinks the order below the referrer's minimumOrderValue gate.
          billAmount: updatedOrder.originalBillAmount ?? updatedOrder.billAmount,
          totalAmount: updatedOrder.totalAmount,
          firstOrderDiscountAmount: updatedOrder.firstOrderDiscountAmount,
        })
        .catch(() => { /* swallow — referral processing is best-effort */ });
    }

    // Attach customerName/customerPhone so the admin panel's cached copy of
    // this order (Zustand store keyed by _id) isn't overwritten with a
    // customer-less version the moment any status update happens — this is
    // exactly what was wiping the name/phone off the bill/print view right
    // after itemizing an order.
    const [withInfo] = await this.attachCustomerInfo([updatedOrder]);
    return withInfo;

  }



  /** ADMIN: full pricing-snapshot history for an order (billing transparency + audit). */
  async getPricingSnapshots(orderId: string) {
    const order = await this.orderModel.findById(orderId).select('_id');
    if (!order) throw new NotFoundException('Order not found');
    return this.pricingService.getSnapshotsForOrder(orderId);
  }

  /** ADMIN: price-override audit trail for an order (who changed the bill, from what, to what, why). */
  async getPriceAdjustments(orderId: string) {
    const order = await this.orderModel.findById(orderId).select('_id');
    if (!order) throw new NotFoundException('Order not found');
    return this.pricingService.getAdjustmentsForOrder(orderId);
  }

  // ── ADMIN: Order photos (damage findings / weighing proof) ────────────────



  /**

   * Upload one or more photos against an order.

   * type = 'damage'   → findings/evidence photos (optional note per photo)

   * type = 'weighing' → scale/bill proof photos

   * Photos are uploaded to R2 in parallel, then pushed atomically.

   */

  async addOrderPhotos(

    orderId: string,

    type: OrderPhotoType,

    files: Express.Multer.File[],

    notes: (string | undefined)[] = [],

  ) {

    if (!files?.length) throw new BadRequestException('No files provided');

    if (files.length > 6) {

      throw new BadRequestException('Maximum 6 photos per upload');

    }

    for (const f of files) {

      if (!f.mimetype?.startsWith('image/')) {

        throw new BadRequestException(`"${f.originalname}" is not an image`);

      }

      if (f.size > 8 * 1024 * 1024) {

        throw new BadRequestException(`"${f.originalname}" exceeds the 8 MB limit`);

      }

    }



    const order = await this.orderModel.findById(orderId);

    if (!order) throw new NotFoundException('Order not found');

    if (

      order.status === OrderStatus.CANCELLED ||

      order.status === OrderStatus.ORDER_PLACED

    ) {

      throw new BadRequestException(

        'Photos can only be added after the order has been picked up.',

      );

    }



    const field = type === 'damage' ? 'damagePhotos' : 'weighingPhotos';

    if ((order[field]?.length ?? 0) + files.length > 12) {

      throw new BadRequestException('Photo limit reached for this order (12).');

    }



    // Upload all files to R2 in parallel for performance

    const uploaded = await Promise.all(

      files.map((f) => this.uploadService.uploadImage(f, 'admin')),

    );



    const now = new Date();

    const photos = uploaded.map((u, i) => ({

      url: u.url,

      imageId: u.imageId,

      uploadedAt: now,

      ...(type === 'damage' && notes[i]?.trim()

        ? { note: notes[i]!.trim().slice(0, 300) }

        : {}),

    }));



    order[field].push(...(photos as any));

    const saved = await order.save();



    this.socketEvents.emitOrderUpdated({

      _id: String(saved._id),

      orderNumber: saved.orderNumber ?? '',

      status: saved.status,

      userId: saved.userId.toString(),

    });



    // Same reasoning as updateStatus() — the admin panel replaces its cached
    // order with whatever this endpoint returns, so it must carry
    // customerName/customerPhone too or the drawer/print view loses them.
    const [withInfo] = await this.attachCustomerInfo([saved]);
    return withInfo;

  }



  /** Remove a single photo by its subdocument _id. */

  async removeOrderPhoto(orderId: string, type: OrderPhotoType, photoId: string) {

    const order = await this.orderModel.findById(orderId);

    if (!order) throw new NotFoundException('Order not found');



    const field = type === 'damage' ? 'damagePhotos' : 'weighingPhotos';

    const before = order[field].length;

    order[field] = order[field].filter(

      (p: any) => String(p._id) !== photoId,

    ) as any;



    if (order[field].length === before) {

      throw new NotFoundException('Photo not found on this order');

    }

    const saved = await order.save();

    const [withInfo] = await this.attachCustomerInfo([saved]);

    return withInfo;

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

    const saved = await order.save();



    // ── Refer & Earn milestone hook (non-blocking) ────────────────────────
    // Same trigger as the admin path in updateStatus() — must fire here too,
    // since customers can also confirm delivery themselves via OTP.
    this.referralService

      .handleQualifyingOrder(saved.userId.toString(), {

        _id: saved._id,

        status: saved.status,

        paymentStatus: (saved as any).paymentStatus,

        billAmount: saved.originalBillAmount ?? saved.billAmount,

        totalAmount: saved.totalAmount,

        firstOrderDiscountAmount: saved.firstOrderDiscountAmount,

      })

      .catch(() => { /* swallow — referral processing is best-effort */ });



    return saved;

  }



  // ── DELIVERY PARTNER ───────────────────────────────────────────────────────



  /**

   * Orders assigned to this delivery partner.

   * Active deliveries (OUT_FOR_DELIVERY) first, then recently completed ones.

   */

  async findAssignedToPartner(partnerId: string) {

    const [active, completed] = await Promise.all([

      this.orderModel

        .find({ deliveryPartnerId: partnerId, status: OrderStatus.OUT_FOR_DELIVERY })

        .sort({ updatedAt: -1 }),

      this.orderModel

        .find({ deliveryPartnerId: partnerId, status: OrderStatus.COMPLETED })

        .sort({ updatedAt: -1 })

        .limit(20),

    ]);

    // Single batched user lookup for both lists to avoid an extra query.
    const combined = await this.attachCustomerContactForDelivery([...active, ...completed]);

    return {
      active: combined.slice(0, active.length),
      completed: combined.slice(active.length),
    };

  }



  /**

   * Delivery partner confirms delivery by entering the OTP the customer

   * received after payment. Only works on orders assigned to this partner.

   */

  async completeDeliveryByPartner(orderId: string, partnerId: string, otp: string) {

    const order = await this.orderModel.findOne({

      _id: orderId,

      deliveryPartnerId: partnerId,

    });

    if (!order) throw new NotFoundException('Order not found or not assigned to you');



    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {

      throw new BadRequestException('Order is not awaiting delivery confirmation');

    }

    if (!order.deliveryOtp) {

      throw new BadRequestException('No delivery OTP found for this order.');

    }

    if (!otp || otp.trim() !== order.deliveryOtp) {

      throw new BadRequestException('Invalid OTP. Please verify the code with the customer and try again.');

    }



    order.status = OrderStatus.COMPLETED;

    order.statusHistory = [

      ...(order.statusHistory ?? []),

      { status: OrderStatus.COMPLETED, timestamp: new Date() },

    ];

    const updated = await order.save();



    this.socketEvents.emitOrderUpdated({

      _id: String(updated._id),

      orderNumber: updated.orderNumber ?? '',

      status: updated.status,

      userId: updated.userId.toString(),

    });

    this.notificationsService

      .notifyOrderStatus(

        updated.userId.toString(),

        updated.orderNumber ?? '',

        OrderStatus.COMPLETED,

      )

      .catch(() => { /* swallow */ });



    // ── Refer & Earn milestone hook (non-blocking) ────────────────────────
    // Same trigger as the admin path in updateStatus() — must fire here too,
    // since delivery partners completing the handover is the normal
    // real-world way orders reach COMPLETED, not the admin panel.
    this.referralService

      .handleQualifyingOrder(updated.userId.toString(), {

        _id: updated._id,

        status: updated.status,

        paymentStatus: (updated as any).paymentStatus,

        billAmount: updated.billAmount,

        totalAmount: updated.totalAmount,

      })

      .catch(() => { /* swallow — referral processing is best-effort */ });



    return updated;

  }



  // Status transition rules
  //
  // PROCESSING branches on the order's deliveryType: HOME_DELIVERY orders go
  // out for delivery; SELF_PICKUP orders become ready for the customer to
  // collect in-store. Both converge on COMPLETED via the same OTP check.
  private isValidTransition(order: OrderDocument, next: OrderStatus): boolean {

    const current = order.status;

    const transitions: Record<OrderStatus, OrderStatus[]> = {

      [OrderStatus.ORDER_PLACED]:     [OrderStatus.PICKUP_ASSIGNED, OrderStatus.CANCELLED],

      [OrderStatus.PICKUP_ASSIGNED]:  [OrderStatus.ITEMIZED, OrderStatus.CANCELLED],

      [OrderStatus.ITEMIZED]:         [OrderStatus.PROCESSING],

      [OrderStatus.PROCESSING]:       [
        order.deliveryType === DeliveryType.SELF_PICKUP
          ? OrderStatus.READY_FOR_PICKUP
          : OrderStatus.OUT_FOR_DELIVERY,
      ],

      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.COMPLETED],

      [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.COMPLETED],

      [OrderStatus.COMPLETED]:        [],

      [OrderStatus.CANCELLED]:        [],

    };

    return transitions[current]?.includes(next) ?? false;

  }

}

