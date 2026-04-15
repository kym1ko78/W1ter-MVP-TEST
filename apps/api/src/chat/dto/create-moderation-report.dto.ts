import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateModerationReportDto {
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  details?: string;
}
