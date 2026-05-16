import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    let token = request.cookies?.access_token;
    if (!token && request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      const result = await this.authService.verifyToken(token);
      request.user = result.user;
      return true;
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
