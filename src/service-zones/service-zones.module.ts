import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ServiceZone,
  ServiceZoneSchema,
} from './schemas/service-zone.schema';
import { ServiceZonesService } from './service-zones.service';
import { ServiceZonesController } from './service-zones.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServiceZone.name, schema: ServiceZoneSchema },
    ]),
    AuthModule,
  ],
  controllers: [ServiceZonesController],
  providers: [ServiceZonesService],
  exports: [ServiceZonesService],
})
export class ServiceZonesModule {}
