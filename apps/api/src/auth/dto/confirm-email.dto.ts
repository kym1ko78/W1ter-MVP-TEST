import { IsString, MaxLength, MinLength } from "class-validator";

export class ConfirmEmailDto {
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;
}
