import { Controller, Post, Delete, Body, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-fcm-token')
  async registerFcmToken(
    @Request() req,
    @Body() registerFcmTokenDto: RegisterFcmTokenDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    await this.notificationsService.registerToken(userId, registerFcmTokenDto.fcmToken);
    return { success: true, message: 'FCM token registered successfully' };
  }

  @Delete('fcm-token')
  async removeFcmToken(
    @Request() req,
    @Body() body: { fcmToken: string },
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    if (!body.fcmToken || body.fcmToken.length < 100) {
      throw new HttpException('Invalid FCM token', HttpStatus.BAD_REQUEST);
    }

    await this.notificationsService.removeToken(userId, body.fcmToken);
    return { success: true, message: 'FCM token removed successfully' };
  }

  @Delete('fcm-tokens')
  async removeAllFcmTokens(@Request() req) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    await this.notificationsService.removeAllTokens(userId);
    return { success: true, message: 'All FCM tokens removed successfully' };
  }
}
