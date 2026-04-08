import { Body, Controller, Get, Patch, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import type { JwtPayload } from "../common/types/jwt-payload";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UsersService } from "./users.service";

@UseGuards(AccessTokenGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  async me(@CurrentUser() user: JwtPayload) {
    return this.usersService.getSafeUserById(user.sub);
  }

  @Get("search")
  async search(
    @Query("query") query: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.searchUsers(query ?? "", user.sub);
  }

  @Patch("me")
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.sub, dto);
  }
}
