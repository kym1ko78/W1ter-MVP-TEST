import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateGroupChatDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  @IsOptional()
  memberIds?: string[];
}
