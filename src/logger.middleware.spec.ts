import { LoggerMiddleware } from './logger.middleware';

describe('LoggerMiddleware — payment route redaction', () => {
  function run(originalUrl: string, body: any) {
    const middleware = new LoggerMiddleware();
    const logSpy = jest.spyOn((middleware as any).logger, 'log').mockImplementation(() => {});
    let finishHandler!: () => void;
    const response = {
      statusCode: 200,
      on: (event: string, handler: () => void) => {
        if (event === 'finish') finishHandler = handler;
      },
    } as any;
    const request = { method: 'POST', originalUrl, body, get: () => 'test-agent' } as any;
    const next = jest.fn();

    middleware.use(request, response, next);
    finishHandler();

    expect(next).toHaveBeenCalled();
    return logSpy.mock.calls[0][0] as string;
  }

  it('redacts the body for /payments/* routes, including sensitive fields like customer email/phone/signatures', () => {
    const line = run('/payments/webhook/razorpay', {
      event: 'payment.captured',
      payload: { payment: { entity: { email: 'customer@example.com', contact: '+919999999999' } } },
    });
    expect(line).not.toContain('customer@example.com');
    expect(line).not.toContain('+919999999999');
    expect(line).toContain('[redacted:payments]');
  });

  it('redacts /payments/verify too (carries a razorpaySignature)', () => {
    const line = run('/payments/verify', { razorpaySignature: 'super-secret-signature' });
    expect(line).not.toContain('super-secret-signature');
  });

  it('still logs the body in full for unrelated, non-payment routes', () => {
    const line = run('/orders/123/status', { status: 'PICKUP_ASSIGNED' });
    expect(line).toContain('PICKUP_ASSIGNED');
  });
});
