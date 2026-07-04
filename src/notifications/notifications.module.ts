import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AppNotification, AppNotificationSchema } from './schemas/notification.schema';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FirebaseAdminService } from './firebase-admin.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AppNotification.name, schema: AppNotificationSchema },
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, FirebaseAdminService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
