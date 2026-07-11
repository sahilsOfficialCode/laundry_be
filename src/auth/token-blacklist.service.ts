import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class TokenBlacklistService {
  /** token hash → unix timestamp (ms) when the JWT itself expires */
  private readonly blacklist = new Map<string, number>();

  /**
   * Add a raw JWT to the blacklist.
   * @param token  Raw JWT string
   * @param expiresAt  Unix ms when the token expires (from JWT `exp` * 1000).
   *                   Defaults to 1 hour from now if not provided.
   */
  revoke(token: string, expiresAt?: number): void {
    const hash = this.hash(token);
    const ttl = expiresAt ?? Date.now() + 60 * 60 * 1000;
    this.blacklist.set(hash, ttl);
    this.cleanup();
  }

  /** Returns true if the token has been revoked. */
  isRevoked(token: string): boolean {
    const hash = this.hash(token);
    const expiresAt = this.blacklist.get(hash);
    if (expiresAt === undefined) return false;

    // If the JWT has naturally expired, no need to keep it in the blacklist
    if (Date.now() > expiresAt) {
      this.blacklist.delete(hash);
      return false;
    }

    return true;
  }

  /** Remove entries whose underlying JWT has already expired. */
  private cleanup(): void {
    const now = Date.now();
    for (const [hash, expiresAt] of this.blacklist.entries()) {
      if (now > expiresAt) {
        this.blacklist.delete(hash);
      }
    }
  }

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
