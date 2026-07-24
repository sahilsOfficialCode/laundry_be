import type { Request } from 'express';

/** Best-effort client IP, preferring the first hop of X-Forwarded-For behind a proxy/load balancer. */
export function getClientIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim() || req.ip || undefined;
  }
  return req.ip || undefined;
}
