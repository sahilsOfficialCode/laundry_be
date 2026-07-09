import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class CouponRateLimitGuard implements CanActivate {
  private readonly requestMap = new Map<string, { count: number; resetAt: number }>();
  private readonly LIMIT_APPLY = 10; // 10 coupon applies per hour
  private readonly LIMIT_RECORD = 20; // 20 record attempts per hour
  private readonly WINDOW_MS = 3600_000; // 1 hour

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<any>();
    const userId = request.user?.sub || request.ip || 'anonymous';
    const route = request.path;

    const key = `${userId}:${route}`;
    const now = Date.now();
    const limit = route.includes('apply') ? this.LIMIT_APPLY : this.LIMIT_RECORD;

    let record = this.requestMap.get(key);

    // Reset if window expired
    if (!record || now > record.resetAt) {
      this.requestMap.set(key, {
        count: 1,
        resetAt: now + this.WINDOW_MS,
      });
      return true;
    }

    // Check limit
    if (record.count >= limit) {
      throw new HttpException(
        `Too many coupon ${route} requests. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Increment counter
    record.count++;
    return true;
  }
}
