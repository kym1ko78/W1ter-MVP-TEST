import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import type { JwtPayload } from "../common/types/jwt-payload";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UsersService } from "./users.service";

type UploadedAvatarFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@UseGuards(AccessTokenGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  async me(@CurrentUser() user: JwtPayload) {
    return this.usersService.getSafeUserById(user.sub);
  }

  @Get("search")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "users-search",
    limit: 60,
    windowMs: 60 * 1000,
    scope: "user",
  })
  async search(
    @Query("query") query: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.searchUsers(query ?? "", user.sub);
  }

  @Get("blocked")
  async getBlockedUsers(@CurrentUser() user: JwtPayload) {
    return this.usersService.listBlockedUsers(user.sub);
  }

  @Patch("me")
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @Post("me/avatar")
  @UseInterceptors(FileInterceptor("file"))
  async uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: UploadedAvatarFile | undefined,
  ) {
    return this.usersService.updateAvatar(user.sub, file);
  }

  @Delete("me/avatar")
  async deleteAvatar(@CurrentUser() user: JwtPayload) {
    return this.usersService.removeAvatar(user.sub);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "users-block",
    limit: 30,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  @Post(":userId/block")
  async blockUser(
    @CurrentUser() user: JwtPayload,
    @Param("userId") userId: string,
  ) {
    return this.usersService.blockUser(user.sub, userId);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "users-unblock",
    limit: 30,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  @Delete(":userId/block")
  async unblockUser(
    @CurrentUser() user: JwtPayload,
    @Param("userId") userId: string,
  ) {
    return this.usersService.unblockUser(user.sub, userId);
  }

  @Get("avatar-files/:storageKey")
  async downloadAvatar(
    @Param("storageKey") storageKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { absolutePath, mimeType } = await this.usersService.getAvatarDownload(storageKey);

    response.setHeader("Content-Type", mimeType);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    return new StreamableFile(createReadStream(absolutePath));
  }
}
