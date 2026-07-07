import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { NotificationsService } from './notifications.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ── In-app notification bar ────────────────────────────────────────────────

  /** Current user's notifications (latest 50) + unread count. */
  @Get()
  async getMyNotifications(@Request() req) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }
    return this.notificationsService.getUserNotifications(userId);
  }

  /** Mark all of the current user's notifications as read. */
  @Patch('read')
  async markMyNotificationsRead(@Request() req) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }
    await this.notificationsService.markUserNotificationsRead(userId);
    return { success: true };
  }

  /** Admin panel notifications (latest 50) + unread count. */
  @Get('admin')
  @Roles(UserRole.ADMIN)
  async getAdminNotifications() {
    return this.notificationsService.getAdminNotifications();
  }

  /** Mark all admin notifications as read. */
  @Patch('admin/read')
  @Roles(UserRole.ADMIN)
  async markAdminNotificationsRead() {
    await this.notificationsService.markAdminNotificationsRead();
    return { success: true };
  }

  /** Mark a single admin notification as read. */
  @Patch('admin/:id/read')
  @Roles(UserRole.ADMIN)
  async markAdminNotificationRead(@Param('id') id: string) {
    await this.notificationsService.markAdminNotificationRead(id);
    return { success: true };
  }

  /** Clear (delete) all admin notifications. */
  @Delete('admin')
  @Roles(UserRole.ADMIN)
  async clearAdminNotifications() {
    await this.notificationsService.clearAdminNotifications();
    return { success: true };
  }

  /** Clear (delete) a single admin notification. */
  @Delete('admin/:id')
  @Roles(UserRole.ADMIN)
  async deleteAdminNotification(@Param('id') id: string) {
    await this.notificationsService.deleteAdminNotification(id);
    return { success: true };
  }

  @Post('register-fcm-token')
  async registerFcmToken(
    @Request() req,
    @Body() registerFcmTokenDto: RegisterFcmTokenDto,
  ) {
    console.log('[NotificationsController] registerFcmToken called');
    console.log('[NotificationsController] req.user:', req.user ? 'PRESENT' : 'MISSING');
    console.log('[NotificationsController] req.user.sub:', req.user?.sub);
    
    const userId = req.user?.sub;
    if (!userId) {
      console.log('[NotificationsController] REJECTING: User not authenticated');
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    console.log('[NotificationsController] Registering FCM token for user:', userId);
    await this.notificationsService.registerToken(userId, registerFcmTokenDto.fcmToken);
    console.log('[NotificationsController] FCM token registered successfully');
    return { success: true, message: 'FCM token registered successfully' };
  }

  @Delete('fcm-token')
  async removeFcmToken(
    @Request() req,
    @Body() body: { fcmToken: string },
  ) {
    const userId = req.user?.sub;
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
    const userId = req.user?.sub;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    await this.notificationsService.removeAllTokens(userId);
    return { success: true, message: 'All FCM tokens removed successfully' };
  }

  /**
   * POST /notifications/test
   * Test endpoint to send a notification to the currently authenticated user.
   * Used for end-to-end notification testing.
   */
  @Post('test')
  async sendTestNotification(@Request() req) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    await this.notificationsService.sendToUser(userId, {
      title: 'Test Notification 🔔',
      body: 'This is a test notification from LaundryBrew. If you see this, push notifications are working!',
      type: 'test',
    });

    return { success: true, message: 'Test notification sent' };
  }
}
