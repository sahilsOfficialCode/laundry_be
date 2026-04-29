import type { Request } from 'express';
import { UserRole } from '../users/schemas/user.schema';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
