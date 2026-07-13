import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  StandardTimeSlot,
  StandardTimeSlotDocument,
  SlotType,
  ALL_DAYS,
  DayOfWeek,
} from './schemas/standard-time-slot.schema';
import {
  CreateStandardTimeSlotDto,
  UpdateStandardTimeSlotDto,
} from './dto/standard-time-slot.dto';
import { Order, OrderDocument, OrderStatus } from '../orders/schemas/order.schema';
import { isInstantAvailable } from '../common/instant-availability';

/** Instant option injected into the slot list at runtime (never persisted). */
export const INSTANT_SLOT = {
  _id: 'instant',
  label: 'Instant',
  startTime: null,
  endTime: null,
  type: SlotType.BOTH,
  isInstant: true,
  expectedTurnaround: '~15 min',
  description: 'Delivery partner reaches you in ~15 minutes',
};

/**
 * Default "Full Day" slot shown when admin has not yet created any slots.
 * Automatically removed once admin adds their own slots.
 */
export const FULL_DAY_SLOT = {
  _id: 'full-day',
  label: 'Full Day',
  startTime: '09:00',
  endTime: '21:00',
  type: SlotType.BOTH,
  isInstant: false,
  expectedTurnaround: null,
  capacity: null,
};

/**
 * Map a JS Date parsed from a YYYY-MM-DD string to a lowercase day-of-week.
 * Uses getUTCDay() so the day matches the date string regardless of server timezone.
 */
function toDayKey(date: Date): DayOfWeek {
  const day = date.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  return ALL_DAYS[day === 0 ? 6 : day - 1];
}

/**
 * Returns the current HH:MM time string in IST (UTC+5:30).
 * Used to filter out slots whose end time has already passed today.
 */
function currentTimeIST(): string {
  const nowMs = Date.now() + 5.5 * 60 * 60 * 1000; // shift to IST
  const h = Math.floor((nowMs / (60 * 60 * 1000)) % 24);
  const m = Math.floor((nowMs / (60 * 1000)) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Returns today's date as a YYYY-MM-DD string in IST.
 */
function todayIST(): string {
  const nowMs = Date.now() + 5.5 * 60 * 60 * 1000;
  return new Date(nowMs).toISOString().slice(0, 10);
}

@Injectable()
export class StandardTimeSlotsService {
  constructor(
    @InjectModel(StandardTimeSlot.name)
    private readonly slotModel: Model<StandardTimeSlotDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  // ── Admin CRUD ─────────────────────────────────────────────────────────────

  async create(dto: CreateStandardTimeSlotDto) {
    this.validateTimes(dto.startTime, dto.endTime);
    return this.slotModel.create({
      label: dto.label.trim(),
      startTime: dto.startTime,
      endTime: dto.endTime,
      type: dto.type ?? SlotType.BOTH,
      daysAvailable: dto.daysAvailable ?? [...ALL_DAYS],
      capacity: dto.capacity,
      expectedTurnaround: dto.expectedTurnaround?.trim(),
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
  }

  async findAll() {
    return this.slotModel
      .find()
      .sort({ sortOrder: 1, startTime: 1 })
      .lean()
      .exec();
  }

  async findById(id: string) {
    const slot = await this.slotModel.findById(id).lean().exec();
    if (!slot) throw new NotFoundException('Time slot not found');
    return slot;
  }

  async update(id: string, dto: UpdateStandardTimeSlotDto) {
    const slot = await this.slotModel.findById(id).exec();
    if (!slot) throw new NotFoundException('Time slot not found');

    if (dto.startTime || dto.endTime) {
      const start = dto.startTime ?? slot.startTime;
      const end   = dto.endTime   ?? slot.endTime;
      this.validateTimes(start, end);
    }

    const updates: Partial<StandardTimeSlot> = {};
    if (dto.label !== undefined)             updates.label             = dto.label.trim();
    if (dto.startTime !== undefined)         updates.startTime         = dto.startTime;
    if (dto.endTime !== undefined)           updates.endTime           = dto.endTime;
    if (dto.type !== undefined)              updates.type              = dto.type;
    if (dto.daysAvailable !== undefined)     updates.daysAvailable     = dto.daysAvailable;
    if (dto.capacity !== undefined)          updates.capacity          = dto.capacity;
    if (dto.expectedTurnaround !== undefined) updates.expectedTurnaround = dto.expectedTurnaround?.trim();
    if (dto.isActive !== undefined)          updates.isActive          = dto.isActive;
    if (dto.sortOrder !== undefined)         updates.sortOrder         = dto.sortOrder;

    Object.assign(slot, updates);
    return slot.save();
  }

  async remove(id: string) {
    const slot = await this.slotModel.findByIdAndDelete(id).exec();
    if (!slot) throw new NotFoundException('Time slot not found');
    return { deleted: true };
  }

  /**
   * Activate or deactivate a slot.
   *
   * When deactivating with a grace period (`graceMinutes > 0`), the slot stays
   * visible to users who are currently in the booking flow for that many minutes
   * before actually disappearing. This prevents users mid-checkout from losing
   * their selected slot due to an admin action.
   *
   * Activating always clears any pending grace period immediately.
   */
  async setActive(id: string, isActive: boolean, graceMinutes = 0) {
    const slot = await this.slotModel.findById(id).exec();
    if (!slot) throw new NotFoundException('Time slot not found');

    slot.isActive = isActive;

    if (!isActive && graceMinutes > 0) {
      // Slot stays visible in getAvailable until effectiveUntil elapses
      slot.effectiveUntil = new Date(Date.now() + graceMinutes * 60 * 1000);
    } else {
      // Activate immediately, or deactivate now with no grace
      slot.effectiveUntil = null as any;
    }

    return slot.save();
  }

  // ── Admin stats ────────────────────────────────────────────────────────────

  /**
   * Returns all slots with order counts for the requested date.
   * Used by the admin Time Slots page to show slot utilisation.
   */
  async getStats(date: string) {
    const requestedDate = date ? new Date(date) : new Date(Date.now() + 5.5 * 60 * 60 * 1000);

    // Day boundaries in UTC (YYYY-MM-DD 00:00:00Z → 23:59:59.999Z)
    const dayStart = new Date(requestedDate.toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const dayEnd   = new Date(requestedDate.toISOString().slice(0, 10) + 'T23:59:59.999Z');

    // Aggregate orders grouped by pickupSlot label for that day
    const orderCounts: { _id: string; count: number }[] = await this.orderModel
      .aggregate([
        {
          $match: {
            pickupDate: { $gte: dayStart, $lte: dayEnd },
            status: { $ne: OrderStatus.CANCELLED },
          },
        },
        {
          $group: {
            _id: '$pickupSlot',
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    const countMap = new Map(orderCounts.map((r) => [r._id?.toLowerCase(), r.count]));

    const slots = await this.slotModel
      .find()
      .sort({ sortOrder: 1, startTime: 1 })
      .lean()
      .exec();

    return slots.map((s) => ({
      _id: String(s._id),
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      type: s.type,
      daysAvailable: s.daysAvailable,
      capacity: s.capacity ?? null,
      expectedTurnaround: s.expectedTurnaround ?? null,
      isActive: s.isActive,
      effectiveUntil: s.effectiveUntil ?? null,
      sortOrder: s.sortOrder,
      orderCount: countMap.get(s.label?.toLowerCase()) ?? 0,
    }));
  }

  // ── User-facing: available slots for a date ────────────────────────────────

  /**
   * Returns pickup slots, delivery slots, and the instant option for a given date.
   *
   * Two extra rules applied on top of basic isActive filtering:
   *
   * 1. PAST-TIME FILTER: When the requested date is today (in IST), slots whose
   *    end time has already passed are excluded. Example: if it is 14:30 IST and
   *    a slot ends at 13:00, it will not appear.
   *
   * 2. GRACE PERIOD: A slot that was deactivated with a grace period (isActive=false
   *    but effectiveUntil is in the future) is still shown until the grace expires.
   *    This prevents users mid-checkout from losing a slot due to an admin toggle.
   */
  async getAvailable(date: string) {
    const requestedDate = date ? new Date(date) : new Date();
    const dayKey = toDayKey(requestedDate);
    const now = new Date();

    // Decide whether to apply past-time filtering
    const dateStr = date || todayIST();
    const isToday  = dateStr === todayIST();
    const currentTime = currentTimeIST(); // HH:MM in IST

    // Fetch active slots + slots still within their grace period
    const slots = await this.slotModel
      .find({
        daysAvailable: dayKey,
        $or: [
          { isActive: true },
          // Grace period: was deactivated but effectiveUntil hasn't passed yet
          { isActive: false, effectiveUntil: { $gt: now } },
        ],
      })
      .sort({ sortOrder: 1, startTime: 1 })
      .lean()
      .exec();

    // Filter out past slots when the requested date is today
    const timePassed = isToday
      ? slots.filter((s) => s.endTime > currentTime)
      : slots;

    // ── Capacity filter ────────────────────────────────────────────────────────
    // For slots that have a capacity set, count how many orders are already
    // booked for that slot on the requested date. Remove full slots so users
    // cannot select them. Remaining capacity is attached to the public slot.
    const dayISO = (date || todayIST());
    const dayStart = new Date(dayISO + 'T00:00:00.000Z');
    const dayEnd   = new Date(dayISO + 'T23:59:59.999Z');

    // Collect the labels of capacity-limited slots to run one aggregate query.
    const cappedLabels = timePassed
      .filter((s) => s.capacity != null && s.capacity > 0)
      .map((s) => s.label);

    let slotOrderCounts: Map<string, number> = new Map();
    if (cappedLabels.length > 0) {
      const counts: { _id: string; count: number }[] = await this.orderModel
        .aggregate([
          {
            $match: {
              pickupDate: { $gte: dayStart, $lte: dayEnd },
              pickupSlot: { $in: cappedLabels },
              status: { $ne: 'CANCELLED' },
            },
          },
          { $group: { _id: '$pickupSlot', count: { $sum: 1 } } },
        ])
        .exec();
      slotOrderCounts = new Map(counts.map((r) => [r._id, r.count]));
    }

    // Keep only slots that still have room (or have no cap).
    const filteredSlots = timePassed.filter((s) => {
      if (s.capacity == null || s.capacity <= 0) return true; // no cap
      const booked = slotOrderCounts.get(s.label) ?? 0;
      return booked < s.capacity;
    });

    const adminPickup = filteredSlots
      .filter((s) => s.type === SlotType.PICKUP || s.type === SlotType.BOTH)
      .map((s) => this.toPublicSlot(s, slotOrderCounts.get(s.label)));

    const adminDelivery = filteredSlots
      .filter((s) => s.type === SlotType.DELIVERY || s.type === SlotType.BOTH)
      .map((s) => this.toPublicSlot(s, slotOrderCounts.get(s.label)));

    // If admin has not created any slots yet, fall back to a "Full Day" default.
    // Once admin adds slots the default is replaced automatically.
    // Instant is omitted entirely once past today's cutoff time (see
    // INSTANT_ORDER_CUTOFF_TIME / isInstantAvailable) — no other slot rule changes.
    const instantSlot = isInstantAvailable() ? [INSTANT_SLOT] : [];
    const pickupSlots  = [...instantSlot, ...(adminPickup.length  > 0 ? adminPickup  : [FULL_DAY_SLOT])];
    const deliverySlots = [...instantSlot, ...(adminDelivery.length > 0 ? adminDelivery : [FULL_DAY_SLOT])];

    return { date, pickupSlots, deliverySlots };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private toPublicSlot(s: any, bookedCount?: number) {
    const cap = s.capacity ?? null;
    const booked = bookedCount ?? 0;
    return {
      _id: String(s._id),
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      type: s.type,
      isInstant: false,
      expectedTurnaround: s.expectedTurnaround ?? null,
      capacity: cap,
      remainingCapacity: cap != null && cap > 0 ? Math.max(0, cap - booked) : null,
    };
  }

  private validateTimes(startTime: string, endTime: string) {
    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }
  }
}
