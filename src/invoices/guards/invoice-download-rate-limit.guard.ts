import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/** Copies CouponRateLimitGuard's in-memory pattern — 10 invoice downloads per user+order per hour. */
@Injectable()
export class InvoiceDownloadRateLimitGuard implements CanActivate {
  private readonly requestMap = new Map<string, { count: number; resetAt: number }>();
  private readonly LIMIT = 10;
  private readonly WINDOW_MS = 3600_000; // 1 hour

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<any>();
    const userId = request.user?.sub || request.ip || 'anonymous';
    const orderId = request.params?.orderId ?? 'unknown';

    const key = `${userId}:${orderId}`;
    const now = Date.now();

    let record = this.requestMap.get(key);
    if (!record || now > record.resetAt) {
      this.requestMap.set(key, { count: 1, resetAt: now + this.WINDOW_MS });
      return true;
    }

    if (record.count >= this.LIMIT) {
      throw new HttpException('Too many invoice download requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    record.count++;
    return true;
  }
}
