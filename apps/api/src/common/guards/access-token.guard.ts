import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "../types/jwt-payload";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing access token");
    }

    const token = authHeader.replace("Bearer ", "");

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret:
          this.configService.get<string>("JWT_ACCESS_SECRET") ??
          "replace-me-with-a-long-random-string",
      });

      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
  }
}

