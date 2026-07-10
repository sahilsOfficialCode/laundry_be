import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface RequestWithContext extends Request {
  requestId: string;
}

/**
 * Stamps every request with a requestId so payment logs (verify, webhook,
 * reconciliation) can be correlated back to a single incoming request when
 * reconstructing an incident. Deliberately minimal — no distributed tracing
 * system exists in this app yet, so traceId is aliased to requestId for now.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    req.requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  }
}
