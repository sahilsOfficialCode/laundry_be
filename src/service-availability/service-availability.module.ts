import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServiceAvailabilityController } from './service-availability.controller';
import { ServiceAvailabilityService } from './service-availability.service';
import {
  ServiceAvailabilityConfig,
  ServiceAvailabilityConfigSchema,
} from './schemas/service-availability-config.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServiceAvailabilityConfig.name, schema: ServiceAvailabilityConfigSchema },
    ]),
    AuthModule,
  ],
  controllers: [ServiceAvailabilityController],
  providers: [ServiceAvailabilityService],
  exports: [ServiceAvailabilityService],
})
export class ServiceAvailabilityModule {}
