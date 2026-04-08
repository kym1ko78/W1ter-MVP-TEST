import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { RealtimeGateway } from "./realtime.gateway";
import { PresenceService } from "./presence.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  providers: [RealtimeGateway, PresenceService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}

