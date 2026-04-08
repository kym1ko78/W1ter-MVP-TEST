import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import type { JwtPayload } from "../common/types/jwt-payload";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { PresenceService } from "./presence.service";

interface AuthenticatedSocket extends Socket {
  data: Socket["data"] & {
    user?: JwtPayload;
  };
}

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly presenceService: PresenceService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn("Rejected socket connection without token");
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret:
          this.configService.get<string>("JWT_ACCESS_SECRET") ??
          "replace-me-with-a-long-random-string",
      });

      client.data.user = payload;
      client.join(this.getUserRoom(payload.sub));
      this.presenceService.connect(payload.sub, client.id);
      this.server.emit("presence:changed", {
        userId: payload.sub,
        isOnline: true,
      });
      this.logger.log(`Socket connected for user ${payload.sub}`);
    } catch {
      this.logger.warn("Rejected socket connection with invalid token");
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const user = client.data.user;

    if (!user) {
      return;
    }

    const stillOnline = this.presenceService.disconnect(user.sub, client.id);

    if (!stillOnline) {
      await this.usersService.touchLastSeen(user.sub);
      this.server.emit("presence:changed", {
        userId: user.sub,
        isOnline: false,
      });
      this.logger.log(`Socket disconnected for user ${user.sub}`);
    }
  }

  @SubscribeMessage("join_chat_room")
  async joinChatRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { chatId?: string },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;

    if (!user || !chatId) {
      return { ok: false };
    }

    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId: user.sub,
        },
      },
    });

    if (!membership) {
      return { ok: false };
    }

    client.join(this.getChatRoom(chatId));
    return { ok: true };
  }

  emitMessageNew(chatId: string, payload: unknown) {
    this.server.to(this.getChatRoom(chatId)).emit("message:new", payload);
  }

  emitChatUpdated(chatId: string) {
    this.server.to(this.getChatRoom(chatId)).emit("chat:updated", { chatId });
  }

  emitChatRead(chatId: string, payload: unknown) {
    this.server.to(this.getChatRoom(chatId)).emit("chat:read", payload);
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string") {
      return authToken;
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.replace("Bearer ", "");
    }

    return null;
  }

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  private getChatRoom(chatId: string) {
    return `chat:${chatId}`;
  }
}
