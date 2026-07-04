import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';

import { APP_GUARD } from '@nestjs/core';

import { ConfigModule, ConfigService } from '@nestjs/config';

import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from './users/users.module';

import { AuthModule } from './auth/auth.module';

import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

import { LoggerMiddleware } from './logger.middleware';

import { ServicesModule } from './services/services.module';

import { OrdersModule } from './orders/orders.module';

import { CartModule } from './cart/cart.module';

import { PaymentsModule } from './payments/payments.module';

import { SupportModule } from './support/support.module';

import { LocationsModule } from './locations/locations.module';

import { ServiceZonesModule } from './service-zones/service-zones.module';

import { StandardTimeSlotsModule } from './standard-time-slots/standard-time-slots.module';

import { UploadModule } from './upload/upload.module';

import { WalletModule } from './wallet/wallet.module';

import { ClothTypesModule } from './cloth-types/cloth-types.module';



@Module({

  imports: [

    ConfigModule.forRoot({

      isGlobal: true,

    }),

    MongooseModule.forRootAsync({

      inject: [ConfigService],

      useFactory: (config: ConfigService) => ({

        uri: config.get<string>('MONGO_URI'),

      }),

    }),

    UsersModule,

    AuthModule,

    ServicesModule,

    OrdersModule,

    CartModule,

    PaymentsModule,

    SupportModule,

    LocationsModule,

    ServiceZonesModule,

    StandardTimeSlotsModule,

    UploadModule,

    WalletModule,

    ClothTypesModule,

  ],

  providers: [

    {

      provide: APP_GUARD,

      useClass: JwtAuthGuard,

    },

  ],

})

export class AppModule implements NestModule {

  configure(consumer: MiddlewareConsumer) {

    consumer.apply(LoggerMiddleware).forRoutes('*');

  }

}

