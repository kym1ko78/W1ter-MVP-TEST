import { Injectable } from "@nestjs/common";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private requestCount = 0;

  consume(key: string, limit: number, windowMs: number) {
    this.requestCount += 1;

    if (this.requestCount % 200 === 0) {
      this.cleanupExpiredBuckets();
    }

    const now = Date.now();
    const existingBucket = this.buckets.get(key);

    if (!existingBucket || existingBucket.resetAt <= now) {
      const nextBucket: RateLimitBucket = {
        count: 1,
        resetAt: now + windowMs,
      };

      this.buckets.set(key, nextBucket);

      return {
        allowed: true,
        retryAfterMs: 0,
      };
    }

    existingBucket.count += 1;

    if (existingBucket.count > limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, existingBucket.resetAt - now),
      };
    }

    return {
      allowed: true,
      retryAfterMs: 0,
    };
  }

  private cleanupExpiredBuckets() {
    const now = Date.now();

    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
