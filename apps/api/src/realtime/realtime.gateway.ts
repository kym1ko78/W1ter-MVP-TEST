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
import { TypingService } from "./typing.service";

interface AuthenticatedSocket extends Socket {
  data: Socket["data"] & {
    user?: JwtPayload;
  };
}

type CallMode = "audio" | "video";
type CallSignalType = "offer" | "answer" | "ice-candidate";

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
    private readonly typingService: TypingService,
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

    const typingChanges = this.typingService.clearSocket(client.id);
    for (const change of typingChanges) {
      this.server.to(this.getChatRoom(change.chatId)).emit("typing:changed", change);
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

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    client.join(this.getChatRoom(chatId));
    return { ok: true };
  }

  @SubscribeMessage("presence:sync")
  presenceSync(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { userIds?: string[] },
  ) {
    if (!client.data.user) {
      return {
        ok: false,
        statuses: [],
      };
    }

    const userIds = Array.from(
      new Set((body?.userIds ?? []).filter((value): value is string => typeof value === "string")),
    ).slice(0, 300);

    return {
      ok: true,
      statuses: this.presenceService.getStatuses(userIds),
    };
  }

  @SubscribeMessage("typing:update")
  async updateTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { chatId?: string; isTyping?: boolean },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;

    if (!user || !chatId) {
      return { ok: false };
    }

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    client.join(this.getChatRoom(chatId));

    const status = this.typingService.setTyping(
      chatId,
      user.sub,
      client.id,
      Boolean(body?.isTyping),
    );

    if (status.changed) {
      this.server.to(this.getChatRoom(chatId)).emit("typing:changed", {
        chatId,
        userId: user.sub,
        isTyping: status.isTyping,
      });
    }

    return { ok: true };
  }

  @SubscribeMessage("call:start")
  async startCall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { chatId?: string; callId?: string; mode?: CallMode },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;
    const callId = body?.callId?.trim();

    if (!user || !chatId || !callId) {
      return { ok: false };
    }

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    const mode: CallMode = body?.mode === "video" ? "video" : "audio";
    const memberUserIds = await this.getChatMemberUserIds(chatId);

    this.emitToUsers(
      memberUserIds,
      "call:incoming",
      {
        chatId,
        callId,
        mode,
        fromUserId: user.sub,
        createdAt: new Date().toISOString(),
      },
      user.sub,
    );

    return { ok: true };
  }

  @SubscribeMessage("call:accept")
  async acceptCall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { chatId?: string; callId?: string },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;
    const callId = body?.callId?.trim();

    if (!user || !chatId || !callId) {
      return { ok: false };
    }

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    const memberUserIds = await this.getChatMemberUserIds(chatId);
    this.emitToUsers(memberUserIds, "call:accepted", {
      chatId,
      callId,
      userId: user.sub,
      acceptedAt: new Date().toISOString(),
    });

    return { ok: true };
  }

  @SubscribeMessage("call:decline")
  async declineCall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { chatId?: string; callId?: string; reason?: string },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;
    const callId = body?.callId?.trim();

    if (!user || !chatId || !callId) {
      return { ok: false };
    }

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    const memberUserIds = await this.getChatMemberUserIds(chatId);
    this.emitToUsers(memberUserIds, "call:declined", {
      chatId,
      callId,
      userId: user.sub,
      reason: typeof body?.reason === "string" ? body.reason.slice(0, 120) : null,
      declinedAt: new Date().toISOString(),
    });

    return { ok: true };
  }

  @SubscribeMessage("call:end")
  async endCall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { chatId?: string; callId?: string; reason?: string },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;
    const callId = body?.callId?.trim();

    if (!user || !chatId || !callId) {
      return { ok: false };
    }

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    const memberUserIds = await this.getChatMemberUserIds(chatId);
    this.emitToUsers(memberUserIds, "call:ended", {
      chatId,
      callId,
      userId: user.sub,
      reason: typeof body?.reason === "string" ? body.reason.slice(0, 120) : null,
      endedAt: new Date().toISOString(),
    });

    return { ok: true };
  }

  @SubscribeMessage("call:signal")
  async relayCallSignal(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    body: {
      chatId?: string;
      callId?: string;
      targetUserId?: string;
      signalType?: CallSignalType;
      payload?: unknown;
    },
  ) {
    const user = client.data.user;
    const chatId = body?.chatId;
    const callId = body?.callId?.trim();

    if (!user || !chatId || !callId) {
      return { ok: false };
    }

    if (!(await this.isChatMember(chatId, user.sub))) {
      return { ok: false };
    }

    const signalType: CallSignalType | null =
      body?.signalType === "offer" ||
      body?.signalType === "answer" ||
      body?.signalType === "ice-candidate"
        ? body.signalType
        : null;

    if (!signalType) {
      return { ok: false };
    }

    const signalPayload = {
      chatId,
      callId,
      fromUserId: user.sub,
      signalType,
      payload: body?.payload ?? null,
      createdAt: new Date().toISOString(),
    };

    const memberUserIds = await this.getChatMemberUserIds(chatId);
    if (body?.targetUserId && memberUserIds.includes(body.targetUserId)) {
      this.server.to(this.getUserRoom(body.targetUserId)).emit("call:signal", signalPayload);
      return { ok: true };
    }

    this.emitToUsers(memberUserIds, "call:signal", signalPayload, user.sub);
    return { ok: true };
  }

  emitMessageNew(chatId: string, payload: unknown) {
    this.server.to(this.getChatRoom(chatId)).emit("message:new", payload);
  }

  emitMessageUpdated(chatId: string, payload: unknown) {
    this.server.to(this.getChatRoom(chatId)).emit("message:updated", payload);
  }

  emitChatUpdated(chatId: string) {
    this.server.to(this.getChatRoom(chatId)).emit("chat:updated", { chatId });
  }

  emitChatDeleted(userIds: string[], payload: unknown) {
    for (const userId of userIds) {
      this.server.to(this.getUserRoom(userId)).emit("chat:deleted", payload);
    }
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

  private async getChatMemberUserIds(chatId: string) {
    const memberships = await this.prisma.chatMember.findMany({
      where: {
        chatId,
      },
      select: {
        userId: true,
      },
    });

    return memberships.map((membership) => membership.userId);
  }

  private emitToUsers(
    userIds: string[],
    eventName: string,
    payload: unknown,
    excludedUserId?: string,
  ) {
    const uniqueUserIds = new Set(userIds);
    for (const userId of uniqueUserIds) {
      if (excludedUserId && userId === excludedUserId) {
        continue;
      }

      this.server.to(this.getUserRoom(userId)).emit(eventName, payload);
    }
  }

  private async isChatMember(chatId: string, userId: string) {
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
      select: {
        chatId: true,
      },
    });

    return Boolean(membership);
  }
}
