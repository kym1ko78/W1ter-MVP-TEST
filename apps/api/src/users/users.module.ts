import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimitService } from "../common/services/rate-limit.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, AccessTokenGuard, RateLimitGuard, RateLimitService],
  exports: [UsersService],
})
export class UsersModule {}
