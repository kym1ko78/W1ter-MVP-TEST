import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimitService } from "../common/services/rate-limit.service";
import { RealtimeModule } from "../realtime/realtime.module";
import { AttachmentsController } from "./attachments.controller";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [JwtModule.register({}), RealtimeModule],
  controllers: [ChatController, AttachmentsController],
  providers: [ChatService, AccessTokenGuard, RateLimitGuard, RateLimitService],
  exports: [ChatService],
})
export class ChatModule {}