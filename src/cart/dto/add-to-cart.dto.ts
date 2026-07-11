import { IsMongoId, IsInt, IsOptional, IsIn, Min } from 'class-validator';

export class AddToCartDto {
  @IsMongoId()
  serviceId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  /** Which tab the user added from. Defaults to 'instant' for backwards compat. */
  @IsOptional()
  @IsIn(['instant', 'scheduled'])
  category?: string;
}
