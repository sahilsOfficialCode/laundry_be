import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReferralRateLimit,
  ReferralRateLimitDocument,
} from '../schemas/referral-rate-limit.schema';

export const REFERRAL_THROTTLE_KEY = 'referralThrottle';

export interface ReferralThrottleOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

/** Decorator: @ReferralThrottle({ limit, windowMs }) on a route handler. */
export const ReferralThrottle = (options: ReferralThrottleOptions) =>
  SetMetadata(REFERRAL_THROTTLE_KEY, options);

/**
 * Mongo-backed fixed-window rate limiter for the referral endpoints.
 * Blocks brute-force code guessing / enumeration on validate & apply.
 * Persisted (survives restarts, works across instances) with TTL cleanup —
 * no Redis dependency. Keyed by authenticated user id, falling back to IP.
 */
@Injectable()
export class ReferralThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(ReferralRateLimit.name)
    private readonly model: Model<ReferralRateLimitDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ReferralThrottleOptions>(
      REFERRAL_THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true; // no limit configured on this route

    const req = context.switchToHttp().getRequest();
    const identity = req.user?.sub || this.clientIp(req) || 'anonymous';
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const windowId = Math.floor(Date.now() / options.windowMs);
    const key = `${identity}:${route}:${windowId}`;

    const count = await this.increment(
      key,
      new Date((windowId + 1) * options.windowMs + 60_000),
    );

    if (count > options.limit) {
      throw new HttpException(
        'Too many attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /**
   * Upsert-and-increment the window counter. Two concurrent first-hits can
   * race the upsert into a duplicate-key error; retry once — the second
   * attempt finds the row and increments normally.
   */
  private async increment(key: string, expiresAt: Date): Promise<number> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const doc = await this.model.findOneAndUpdate(
          { key },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { new: true, upsert: true },
        );
        return doc.count;
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
    return 1; // unreachable in practice; fail-open rather than block users
  }

  private clientIp(req: any): string | undefined {
    const fwd = (req.headers?.['x-forwarded-for'] as string) || '';
    return fwd.split(',')[0].trim() || req.ip || undefined;
  }
}
