import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtPayload } from "../types/jwt-payload";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    const request = context.switchToHttp().getRequest();
    return request.user as JwtPayload;
  },
);

