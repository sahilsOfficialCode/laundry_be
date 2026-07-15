import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsMobileNumber } from '../../common/validators/is-mobile-number.validator';

/**
 * Admin-only profile edit (PATCH /users/:id). Every field is optional so the
 * admin can update just one at a time; at least one must be present
 * (enforced in UsersService.updateUserByAdmin).
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsMobileNumber()
  mobileNumber?: string;
}
