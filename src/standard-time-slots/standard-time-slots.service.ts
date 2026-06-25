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

/** Instant option injected into the slot list at runtime (never persisted). */
export const INSTANT_SLOT = {
  _id: 'instant',
  label: 'Instant',
  startTime: null,
  endTime: null,
  type: SlotType.BOTH,
  isInstant: true,
  expectedTurnaround: '~10 min',
  description: 'Delivery partner reaches you in ~10 minutes',
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

@Injectable()
export class StandardTimeSlotsService {
  constructor(
    @InjectModel(StandardTimeSlot.name)
    private readonly slotModel: Model<StandardTimeSlotDocument>,
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

  async setActive(id: string, isActive: boolean) {
    return this.update(id, { isActive });
  }

  // ── User-facing: available slots for a date ────────────────────────────────

  /**
   * Returns pickup slots, delivery slots, and the instant option for a given date.
   * The instant option is always prepended to both pickup and delivery lists.
   */
  async getAvailable(date: string) {
    const requestedDate = date ? new Date(date) : new Date();
    const dayKey = toDayKey(requestedDate);

    const slots = await this.slotModel
      .find({ isActive: true, daysAvailable: dayKey })
      .sort({ sortOrder: 1, startTime: 1 })
      .lean()
      .exec();

    const adminPickup = slots
      .filter((s) => s.type === SlotType.PICKUP || s.type === SlotType.BOTH)
      .map(this.toPublicSlot);

    const adminDelivery = slots
      .filter((s) => s.type === SlotType.DELIVERY || s.type === SlotType.BOTH)
      .map(this.toPublicSlot);

    // If admin has not created any slots yet, fall back to a "Full Day" default.
    // Once admin adds slots the default is replaced automatically.
    const pickupSlots  = [INSTANT_SLOT, ...(adminPickup.length  > 0 ? adminPickup  : [FULL_DAY_SLOT])];
    const deliverySlots = [INSTANT_SLOT, ...(adminDelivery.length > 0 ? adminDelivery : [FULL_DAY_SLOT])];

    return { date, pickupSlots, deliverySlots };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private toPublicSlot(s: any) {
    return {
      _id: String(s._id),
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      type: s.type,
      isInstant: false,
      expectedTurnaround: s.expectedTurnaround ?? null,
      capacity: s.capacity ?? null,
    };
  }

  private validateTimes(startTime: string, endTime: string) {
    if (startTime >= endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }
  }
}
