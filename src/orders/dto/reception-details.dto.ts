import { IsOptional, IsString } from 'class-validator';

/** Building reception/security-desk collection details — only used when serviceType is HOME_RECEPTION. */
export class ReceptionDetailsDto {
  @IsOptional()
  @IsString()
  receptionName?: string;

  @IsOptional()
  @IsString()
  flatVillaNumber?: string;

  @IsOptional()
  @IsString()
  securityInstructions?: string;

  @IsOptional()
  @IsString()
  pickupNotes?: string;
}
