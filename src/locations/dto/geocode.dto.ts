import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GeocodeQueryDto {
  /** Free-text address / place name to geocode */
  @IsString()
  query: string;

  /** Optionally restrict to a city / locality */
  @IsOptional()
  @IsString()
  city?: string;

  /** Max number of candidates to return (1–10, default 5) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export interface GeocodeCandidate {
  displayName: string;
  latitude: number;
  longitude: number;
  city: string | null;
  country: string | null;
  type: string;
}
