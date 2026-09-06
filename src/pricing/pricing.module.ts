import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PricingService } from './pricing.service';
import { PricingConfigService } from './services/pricing-config.service';
import { PricingConfig, PricingConfigSchema } from './schemas/pricing-config.schema';
import {
  OrderPricingSnapshot,
  OrderPricingSnapshotSchema,
} from './schemas/order-pricing-snapshot.schema';
import { PriceAdjustmentLog, PriceAdjustmentLogSchema } from './schemas/price-adjustment-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PricingConfig.name, schema: PricingConfigSchema },
      { name: OrderPricingSnapshot.name, schema: OrderPricingSnapshotSchema },
      { name: PriceAdjustmentLog.name, schema: PriceAdjustmentLogSchema },
    ]),
  ],
  providers: [PricingService, PricingConfigService],
  exports: [PricingService, PricingConfigService],
})
export class PricingModule {}
