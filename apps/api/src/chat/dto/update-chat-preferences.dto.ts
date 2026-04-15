import { IsBoolean, IsISO8601, IsOptional } from "class-validator";

export class UpdateChatPreferencesDto {
  @IsOptional()
  @IsBoolean()
  isMuted?: boolean;

  @IsOptional()
  @IsISO8601()
  mutedUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
