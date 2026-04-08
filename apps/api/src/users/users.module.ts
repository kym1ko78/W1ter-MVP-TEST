import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, AccessTokenGuard],
  exports: [UsersService],
})
export class UsersModule {}
