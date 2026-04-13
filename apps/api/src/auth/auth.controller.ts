import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AccessTokenGuard } from "../common/guards/access-token.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import type { JwtPayload } from "../common/types/jwt-payload";
import { AuthService } from "./auth.service";
import { ConfirmEmailDto } from "./dto/confirm-email.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

const REFRESH_COOKIE = "refresh_token";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "auth-register",
    limit: 5,
    windowMs: 10 * 60 * 1000,
    scope: "ip",
  })
  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.register(dto, this.getRequestMetadata(request));
    this.setRefreshCookie(response, session.refreshToken, session.rememberMe);

    return {
      accessToken: session.accessToken,
      user: session.user,
      emailVerificationPreviewUrl: session.emailVerificationPreviewUrl,
    };
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "auth-login",
    limit: 10,
    windowMs: 10 * 60 * 1000,
    scope: "ip",
  })
  @HttpCode(200)
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(dto, this.getRequestMetadata(request));
    this.setRefreshCookie(response, session.refreshToken, session.rememberMe);

    return {
      accessToken: session.accessToken,
      user: session.user,
      emailVerificationPreviewUrl: session.emailVerificationPreviewUrl,
    };
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "auth-refresh",
    limit: 30,
    windowMs: 10 * 60 * 1000,
    scope: "ip",
  })
  @HttpCode(200)
  @Post("refresh")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    const session = await this.authService.refreshSession(
      refreshToken,
      this.getRequestMetadata(request),
    );

    this.setRefreshCookie(response, session.refreshToken, session.rememberMe);

    return {
      accessToken: session.accessToken,
      user: session.user,
      emailVerificationPreviewUrl: session.emailVerificationPreviewUrl,
    };
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "auth-logout",
    limit: 60,
    windowMs: 10 * 60 * 1000,
    scope: "ip",
  })
  @HttpCode(200)
  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.authService.logout(refreshToken);
    response.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    });
    return { success: true };
  }

  @UseGuards(AccessTokenGuard)
  @Get("me")
  async me(@CurrentUser() user: JwtPayload) {
    const safeUser = await this.authService.me(user.sub);

    if (!safeUser) {
      throw new UnauthorizedException("User not found");
    }

    return safeUser;
  }

  @UseGuards(AccessTokenGuard)
  @Get("sessions")
  async listSessions(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    return this.authService.listSessions(user.sub, refreshToken);
  }

  @UseGuards(AccessTokenGuard, RateLimitGuard)
  @RateLimit({
    key: "auth-revoke-session",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  @Delete("sessions/:sessionId")
  async revokeSession(
    @CurrentUser() user: JwtPayload,
    @Param("sessionId") sessionId: string,
  ) {
    return this.authService.revokeSession(user.sub, sessionId);
  }

  @UseGuards(AccessTokenGuard, RateLimitGuard)
  @RateLimit({
    key: "auth-revoke-other-sessions",
    limit: 10,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  @Post("sessions/revoke-others")
  async revokeOtherSessions(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    return this.authService.revokeOtherSessions(user.sub, refreshToken);
  }

  @UseGuards(AccessTokenGuard, RateLimitGuard)
  @RateLimit({
    key: "auth-verify-email-request",
    limit: 5,
    windowMs: 10 * 60 * 1000,
    scope: "user",
  })
  @HttpCode(200)
  @Post("verify-email/request")
  async requestEmailVerification(@CurrentUser() user: JwtPayload) {
    return this.authService.requestEmailVerification(user.sub);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    key: "auth-verify-email-confirm",
    limit: 20,
    windowMs: 10 * 60 * 1000,
    scope: "ip",
  })
  @HttpCode(200)
  @Post("verify-email/confirm")
  async confirmEmailVerification(@Body() dto: ConfirmEmailDto) {
    return this.authService.confirmEmailVerification(dto.token);
  }

  private setRefreshCookie(
    response: Response,
    refreshToken: string,
    rememberMe: boolean,
  ) {
    response.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      ...(rememberMe ? { maxAge: this.getRefreshMaxAgeMs() } : {}),
    });
  }

  private getRefreshMaxAgeMs() {
    const ttlDays = Number(this.configService.get<string>("JWT_REFRESH_TTL_DAYS") ?? 30);
    return ttlDays * 24 * 60 * 60 * 1000;
  }

  private getRequestMetadata(request: Request) {
    return {
      userAgent: request.get("user-agent") ?? undefined,
      ip: request.ip,
    };
  }
}
