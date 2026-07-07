import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { TokenBlacklistService } from '../token-blacklist.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private tokenBlacklistService: TokenBlacklistService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth for routes marked with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    let token = request.cookies?.access_token;
    if (!token && request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    // Reject tokens that have been explicitly revoked (e.g. after logout)
    if (this.tokenBlacklistService.isRevoked(token)) {
      throw new UnauthorizedException('Token has been revoked. Please log in again.');
    }

    let payload: any;
    try {
      const result = await this.authService.verifyToken(token);
      payload = result.user;
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Enforce account deletion / "logout from every device" (throws 401 when
    // the account is deleted/disabled or the token predates sessionsValidFrom).
    await this.authService.assertAccountActive(payload?.sub, payload?.iat);

    request.user = payload;
    return true;
  }
}
