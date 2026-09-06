import { IsBoolean, IsOptional, Matches } from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateServiceAvailabilityDto {
  @IsOptional()
  @IsBoolean()
  instantEnabled?: boolean;

  @IsOptional()
  @Matches(TIME_RE, { message: 'instantStartTime must be HH:MM (24h)' })
  instantStartTime?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'instantEndTime must be HH:MM (24h)' })
  instantEndTime?: string;

  @IsOptional()
  @IsBoolean()
  scheduledEnabled?: boolean;

  @IsOptional()
  @Matches(TIME_RE, { message: 'scheduledStartTime must be HH:MM (24h)' })
  scheduledStartTime?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'scheduledEndTime must be HH:MM (24h)' })
  scheduledEndTime?: string;
}
