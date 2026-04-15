import { Logger } from "@nestjs/common";
import type { INestApplicationContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { createAdapter as createRedisAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server, ServerOptions } from "socket.io";

function toRedisUrl(configService: ConfigService) {
  const configuredUrl = configService.get<string>("REDIS_URL");
  if (configuredUrl?.trim()) {
    return configuredUrl.trim();
  }

  const host = configService.get<string>("REDIS_HOST");
  if (!host?.trim()) {
    return null;
  }

  const port = Number(configService.get<string>("REDIS_PORT") ?? 6379);
  const username = configService.get<string>("REDIS_USERNAME")?.trim();
  const password = configService.get<string>("REDIS_PASSWORD")?.trim();
  const db = Number(configService.get<string>("REDIS_DB") ?? 0);
  const authPart = username || password ? `${encodeURIComponent(username ?? "")}:${encodeURIComponent(password ?? "")}@` : "";

  return `redis://${authPart}${host.trim()}:${port}/${db}`;
}

export class SocketRedisAdapter extends IoAdapter {
  private readonly logger = new Logger(SocketRedisAdapter.name);
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private adapterConstructor: ReturnType<typeof createRedisAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis() {
    const redisUrl = toRedisUrl(this.configService);

    if (!redisUrl) {
      this.logger.log("Redis URL is not configured. Socket.IO Redis adapter is disabled.");
      return false;
    }

    const pubClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    const subClient = pubClient.duplicate();

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);

      const { createAdapter } = await import("@socket.io/redis-adapter");
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.pubClient = pubClient;
      this.subClient = subClient;

      this.logger.log("Socket.IO Redis adapter is enabled.");
      return true;
    } catch (error) {
      this.logger.warn("Failed to connect Redis adapter. Falling back to in-memory adapter.");
      this.logger.debug(error instanceof Error ? error.message : String(error));

      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }

  async closeRedisConnections() {
    await Promise.allSettled([
      this.pubClient?.quit(),
      this.subClient?.quit(),
    ]);
    this.pubClient = null;
    this.subClient = null;
    this.adapterConstructor = null;
  }
}
