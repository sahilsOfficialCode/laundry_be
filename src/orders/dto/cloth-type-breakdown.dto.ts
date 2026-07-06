import { IsIn, IsMongoId, IsNumber, IsOptional, Min } from 'class-validator';

export class ClothTypeBreakdownDto {
  @IsMongoId()
  clothTypeId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  /**
   * Which rate to bill this line at. Optional — falls back to the order's
   * own instant/scheduled category when not provided (see orders.service.ts).
   * Explicit per-line control matters because, in principle, an order's
   * items can carry mixed categories even though the cart normally enforces
   * one type at a time.
   */
  @IsOptional()
  @IsIn(['instant', 'scheduled'])
  serviceType?: 'instant' | 'scheduled';
}
