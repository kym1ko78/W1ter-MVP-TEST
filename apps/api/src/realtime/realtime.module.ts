import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { RealtimeGateway } from "./realtime.gateway";
import { PresenceService } from "./presence.service";
import { TypingService } from "./typing.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  providers: [RealtimeGateway, PresenceService, TypingService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
