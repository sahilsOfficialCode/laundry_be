import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { LaundryService, LaundryServiceSchema } from './schemas/service.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: LaundryService.name, schema: LaundryServiceSchema }])
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
