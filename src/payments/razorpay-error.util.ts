/**
 * The Razorpay Node SDK throws plain `{ statusCode, error }` objects for API
 * errors (e.g. an invalid key/secret, a bad order id) rather than an `Error`
 * instance — so `(err as Error).message` is silently `undefined` for the
 * single most common failure mode (auth failures). Surfacing the real
 * statusCode/description here is the difference between an actionable log
 * line and a several-minute diagnostic detour.
 */
export function describeRazorpayError(err: unknown): string {
  if (err instanceof Error) return err.message;
  const anyErr = err as any;
  if (anyErr?.statusCode) {
    const description = anyErr.error?.description ?? JSON.stringify(anyErr.error ?? {});
    return `Razorpay API error ${anyErr.statusCode}: ${description}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
