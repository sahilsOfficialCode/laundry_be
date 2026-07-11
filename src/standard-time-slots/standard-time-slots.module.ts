import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  StandardTimeSlot,
  StandardTimeSlotSchema,
} from './schemas/standard-time-slot.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { StandardTimeSlotsService } from './standard-time-slots.service';
import { StandardTimeSlotsController } from './standard-time-slots.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: StandardTimeSlot.name, schema: StandardTimeSlotSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [StandardTimeSlotsController],
  providers: [StandardTimeSlotsService],
  exports: [StandardTimeSlotsService],
})
export class StandardTimeSlotsModule {}
