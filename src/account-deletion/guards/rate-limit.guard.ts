import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number; // max requests
  windowMs: number; // per window
}

/** Decorator: @RateLimit({ limit, windowMs }) on a route handler. */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Lightweight in-memory sliding-window rate limiter (no external dependency).
 * Keyed by user id (falling back to IP) + route. Suitable for single-instance
 * deployments; for multi-instance, back this with Redis.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true; // no limit configured on this route

    const req = context.switchToHttp().getRequest();
    const identity = req.user?.sub || req.ip || 'anonymous';
    const key = `${identity}:${context.getClass().name}.${context.getHandler().name}`;

    const now = Date.now();
    const windowStart = now - options.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= options.limit) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    // Opportunistic cleanup to bound memory.
    if (this.hits.size > 5000) this.cleanup(windowStart);
    return true;
  }

  private cleanup(windowStart: number): void {
    for (const [k, arr] of this.hits.entries()) {
      const kept = arr.filter((t) => t > windowStart);
      if (kept.length === 0) this.hits.delete(k);
      else this.hits.set(k, kept);
    }
  }
}
