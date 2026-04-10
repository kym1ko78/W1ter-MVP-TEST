import { IsIn } from "class-validator";

export class ToggleMessageReactionDto {
  @IsIn(["👍", "❤️", "😂", "🔥", "😮", "😢"])
  emoji!: "👍" | "❤️" | "😂" | "🔥" | "😮" | "😢";
}
