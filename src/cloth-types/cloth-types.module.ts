import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClothTypesService } from './cloth-types.service';
import { ClothTypesController } from './cloth-types.controller';
import { ClothType, ClothTypeSchema } from './schemas/cloth-type.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ClothType.name, schema: ClothTypeSchema }]),
    AuthModule,
  ],
  controllers: [ClothTypesController],
  providers: [ClothTypesService],
  exports: [ClothTypesService],
})
export class ClothTypesModule {}
