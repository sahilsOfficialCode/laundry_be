import { IsMongoId, IsNumber, Min } from 'class-validator';

export class ClothTypeBreakdownDto {
  @IsMongoId()
  clothTypeId: string;

  @IsNumber()
  @Min(1)
  quantity: number;
}
