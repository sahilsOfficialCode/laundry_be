import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { Location, LocationSchema } from './schemas/location.schema';
import {
  LocationAuditLog,
  LocationAuditLogSchema,
} from './schemas/location-audit-log.schema';
import {
  LocationClosure,
  LocationClosureSchema,
} from './schemas/location-closure.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Location.name, schema: LocationSchema },
      { name: LocationClosure.name, schema: LocationClosureSchema },
      { name: LocationAuditLog.name, schema: LocationAuditLogSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    AuthModule,
  ],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
