import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_METADATA = "rate_limit_metadata";

export type RateLimitScope = "ip" | "user";

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  scope: RateLimitScope;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA, options);
