import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsMongoId } from 'class-validator';

/** Manual assignment — admin picked specific users from search results. */
export class AssignUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ArrayUnique()
  @IsMongoId({ each: true })
  userIds: string[];
}
