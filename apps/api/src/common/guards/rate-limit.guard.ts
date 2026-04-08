import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from "../decorators/rate-limit.decorator";
import { RateLimitService } from "../services/rate-limit.service";
import type { JwtPayload } from "../types/jwt-payload";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      user?: JwtPayload;
    }>();

    const identifier =
      options.scope === "user"
        ? request.user?.sub ?? request.ip ?? "anonymous"
        : request.ip ?? "unknown-ip";

    const result = this.rateLimitService.consume(
      `${options.key}:${identifier}`,
      options.limit,
      options.windowMs,
    );

    if (!result.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));

      throw new HttpException(
        `Too many ${options.key} requests. Try again in ${retryAfterSeconds} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
