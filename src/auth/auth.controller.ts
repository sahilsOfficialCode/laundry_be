import { Controller, Post, Get, Body, HttpCode, HttpStatus, Res, Req, ForbiddenException } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() signInDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(signInDto);
    
    // Set the token as a cookie
    // Adding reasonable defaults, like generic maxAge or handled per JWT config, here setting 1 day
    response.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: true, // Requires HTTPS, devtunnels uses HTTPS
      sameSite: 'none', // Needed for cross-origin requests
      maxAge: 24 * 60 * 60 * 1000, 
    });

    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('access_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });
    return { message: 'Logged out successfully' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @HttpCode(HttpStatus.OK)
  @Get('me')
  async me(@Req() request: Request) {
    let token = request.cookies?.access_token;
    if (!token && request.headers.authorization) {
      token = request.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      throw new ForbiddenException('No token provided');
    }

    // Call service to verify. It throws a ForbiddenException if invalid.
    return this.authService.verifyToken(token);
  }
}
