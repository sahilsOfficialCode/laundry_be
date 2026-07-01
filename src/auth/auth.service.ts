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
import { SendMobileOtpDto } from './dto/send-mobile-otp.dto';
import { VerifyMobileOtpDto } from './dto/verify-mobile-otp.dto';
import { SendMobileOtpService } from './services/send-mobile-otp.service';

@Injectable()
export class AuthService {
  private readonly passwordResetExpiryMs = 1000 * 60 * 15;
  private readonly mobileOtpExpiryMs = 1000 * 60 * 5;
  private readonly maxOtpAttempts = 5;
  private readonly mobileOtpStore = new Map<
    string,
    {
      otpHash: string;
      expiresAt: number;
      attempts: number;
      isNewUser: boolean;
    }
  >();

  constructor(
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    private jwtService: JwtService,
    private sendMobileOtpService: SendMobileOtpService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (!user?.password) {
      return null;
    }

    if (await bcrypt.compare(pass, user.password)) {
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

    return this.buildAuthResponse(user);
  }

  async sendMobileOtp(sendMobileOtpDto: SendMobileOtpDto) {
    const mobileNumber = this.normalizeMobileNumber(
      sendMobileOtpDto.mobileNumber,
    );
    const existingUser = await this.usersService.findOneByMobile(mobileNumber);
    const isNewUser = !existingUser;

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashValue(otp);

    this.mobileOtpStore.set(mobileNumber, {
      otpHash,
      expiresAt: Date.now() + this.mobileOtpExpiryMs,
      attempts: 0,
      isNewUser,
    });

    await this.sendMobileOtpService.sendOtp({
      mobileNumber,
      otp,
    });
    console.log(`OTP for ${mobileNumber}: ${otp} (valid for 5 minutes)`);

    return {
      success: true,
      isNewUser,
      name: existingUser?.name ?? null,
    };
  }

  async verifyMobileOtp(verifyMobileOtpDto: VerifyMobileOtpDto) {
    const mobileNumber = this.normalizeMobileNumber(
      verifyMobileOtpDto.mobileNumber,
    );
    const record = this.mobileOtpStore.get(mobileNumber);

    if (!record) {
      throw new UnauthorizedException(
        'No OTP request found for this mobile number',
      );
    }

    if (Date.now() > record.expiresAt) {
      this.mobileOtpStore.delete(mobileNumber);
      throw new UnauthorizedException(
        'OTP has expired. Please request a new one',
      );
    }

    const receivedOtpHash = this.hashValue(verifyMobileOtpDto.otp);
    if (record.otpHash !== receivedOtpHash) {
      record.attempts += 1;
      if (record.attempts >= this.maxOtpAttempts) {
        this.mobileOtpStore.delete(mobileNumber);
        throw new UnauthorizedException(
          'Too many incorrect OTP attempts. Request a new OTP',
        );
      }

      this.mobileOtpStore.set(mobileNumber, record);
      throw new UnauthorizedException('Invalid OTP');
    }

    let user = await this.usersService.findOneByMobile(mobileNumber);

    if (record.isNewUser) {
      const name = verifyMobileOtpDto.name?.trim();
      if (!name) {
        throw new BadRequestException('Name is required');
      }

      user = await this.usersService.createMobileUser(mobileNumber, name);
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    this.mobileOtpStore.delete(mobileNumber);

    const sanitizedUser = user.toObject ? user.toObject() : user;
    return {
      ...this.buildAuthResponse(sanitizedUser),
      isNewUser: record.isNewUser,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.usersService.findOneByEmail(
      forgotPasswordDto.email,
    );

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

    const user =
      await this.usersService.findByPasswordResetToken(hashedResetToken);

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

  private buildAuthResponse(user: any) {
    const userId = String(user._id ?? user.id ?? '');
    const payload = {
      sub: userId,
      role: user.role,
      email: user.email,
      mobileNumber: user.mobileNumber,
    };

    const token = this.jwtService.sign(payload);

    return {
      success: true,
      access_token: token,
      token,
      user: {
        id: userId,
        email: user.email ?? '',
        mobileNumber: user.mobileNumber ?? '',
        name: user.name ?? '',
        role: user.role ?? 'user',
        photoUrl: user.photoUrl ?? null,
      },
    };
  }

  private normalizeMobileNumber(value: string): string {
    const normalized = value.trim();
    if (!/^\+?[0-9]{10,15}$/.test(normalized)) {
      throw new BadRequestException('Invalid mobile number format');
    }

    return normalized;
  }

  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
