import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

import { Order, OrderSchema } from './schemas/order.schema';
import { Cart, CartSchema } from '../cart/schemas/cart.schema';
import {
  LaundryService,
  LaundryServiceSchema,
} from '../services/schemas/service.schema';
import {
  StandardTimeSlot,
  StandardTimeSlotSchema,
} from '../standard-time-slots/schemas/standard-time-slot.schema';

import { AuthModule } from '../auth/auth.module';
import { LocationsModule } from '../locations/locations.module';
import { ServiceZonesModule } from '../service-zones/service-zones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportModule } from '../support/support.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: LaundryService.name, schema: LaundryServiceSchema },
      { name: StandardTimeSlot.name, schema: StandardTimeSlotSchema },
    ]),
    AuthModule,
    LocationsModule,
    ServiceZonesModule,
    NotificationsModule,
    SupportModule,
    UploadModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
