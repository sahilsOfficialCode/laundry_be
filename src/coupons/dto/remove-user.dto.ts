import { IsMongoId } from 'class-validator';

export class RemoveUserDto {
  @IsMongoId()
  userId: string;
}
