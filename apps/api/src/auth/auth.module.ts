import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimitService } from "../common/services/rate-limit.service";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, RateLimitGuard, RateLimitService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
