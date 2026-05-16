import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  private readonly passwordResetExpiryMs = 1000 * 60 * 15;

  constructor(
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    private jwtService: JwtService
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(userDto: LoginDto) {
    const user = await this.validateUser(userDto.email, userDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (userDto.role && user.role !== userDto.role) {
      throw new ForbiddenException(
        `This account does not have ${userDto.role} access`,
      );
    }
    
    const payload = { email: user.email, sub: user._id, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersService.findOneByEmail(forgotPasswordDto.email);

    if (!user) {
      return {
        message:
          'If an account exists for that email, a password reset token has been generated.',
      };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + this.passwordResetExpiryMs);

    await this.usersService.setPasswordResetToken(
      String(user._id),
      hashedResetToken,
      expiresAt,
    );

    return {
      message:
        'Password reset token generated. Connect this token to your email or reset-password screen.',
      resetToken,
      expiresAt,
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(resetPasswordDto.token)
      .digest('hex');

    const user = await this.usersService.findByPasswordResetToken(
      hashedResetToken,
    );

    if (!user) {
      throw new BadRequestException('Reset token is invalid or has expired');
    }

    await this.usersService.updatePassword(
      String(user._id),
      resetPasswordDto.newPassword,
    );

    return {
      message: 'Password has been reset successfully',
    };
  }

  async verifyToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return { success: true, user: payload };
    } catch (e) {
      throw new ForbiddenException('Invalid or expired token');
    }
  }
}
