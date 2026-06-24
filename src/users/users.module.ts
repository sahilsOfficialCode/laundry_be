import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UserAddressesController } from './user-addresses.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import { AuthModule } from '../auth/auth.module';
import { ServiceZonesModule } from '../service-zones/service-zones.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => AuthModule),
    ServiceZonesModule,
  ],
  controllers: [UsersController, UserAddressesController],
  providers: [UsersService],
  exports: [UsersService], // Exported for AuthModule
})
export class UsersModule {}
