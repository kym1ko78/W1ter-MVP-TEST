import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { AppModule } from "../src/app.module";

type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  };
};

describe("API e2e", () => {
  let app: INestApplication;
  const uploadsDir = join(process.cwd(), "test-uploads");

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
    await rm(uploadsDir, { recursive: true, force: true });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const configService = app.get(ConfigService);
    const origin = configService.get<string>("API_CORS_ORIGIN") ?? "http://localhost:3000";

    app.use(cookieParser());
    app.enableCors({
      origin,
      credentials: true,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it("registers, restores a session, deletes messages and removes chats", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const alice = {
      email: `api.e2e.alice.${suffix}@example.com`,
      displayName: "API E2E Alice",
      password: "password123",
    };
    const bob = {
      email: `api.e2e.bob.${suffix}@example.com`,
      displayName: "API E2E Bob",
      password: "password123",
    };

    const aliceAgent = request.agent(app.getHttpServer());
    const bobAgent = request.agent(app.getHttpServer());

    const aliceRegister = await aliceAgent
      .post("/auth/register")
      .send(alice)
      .expect(201);

    const bobRegister = await bobAgent
      .post("/auth/register")
      .send(bob)
      .expect(201);

    const aliceBody = aliceRegister.body as AuthResponse;
    const bobBody = bobRegister.body as AuthResponse;

    expect(aliceBody.user.email).toBe(alice.email.toLowerCase());
    expect(bobBody.user.email).toBe(bob.email.toLowerCase());
    expect(aliceRegister.headers["set-cookie"]).toBeDefined();
    expect(bobRegister.headers["set-cookie"]).toBeDefined();

    const refreshResponse = await aliceAgent.post("/auth/refresh").expect(200);
    const refreshBody = refreshResponse.body as AuthResponse;
    expect(refreshBody.accessToken).toBeTruthy();

    const createChatResponse = await aliceAgent
      .post("/chats/direct")
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .send({ targetUserId: bobBody.user.id })
      .expect(201);

    expect(createChatResponse.body.id).toBeTruthy();
    expect(createChatResponse.body.members).toHaveLength(2);

    const chatId = createChatResponse.body.id as string;
    const messageText = `API e2e message ${suffix}`;

    const sendMessageResponse = await aliceAgent
      .post(`/chats/${chatId}/messages`)
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .send({ body: messageText })
      .expect(201);

    expect(sendMessageResponse.body.body).toBe(messageText);
    expect(sendMessageResponse.body.chatId).toBe(chatId);

    const sentMessageId = sendMessageResponse.body.id as string;

    const attachmentPayload = `Attachment payload ${suffix}`;
    const uploadResponse = await aliceAgent
      .post(`/chats/${chatId}/attachments`)
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .attach("file", Buffer.from(attachmentPayload, "utf-8"), {
        filename: `note-${suffix}.txt`,
        contentType: "text/plain",
      })
      .expect(201);

    expect(uploadResponse.body.body).toBeNull();
    expect(uploadResponse.body.attachments).toHaveLength(1);
    expect(uploadResponse.body.attachments[0].mimeType).toBe("text/plain");

    const attachmentMessageId = uploadResponse.body.id as string;
    const attachmentId = uploadResponse.body.attachments[0].id as string;

    const bobChatsBeforeRead = await bobAgent
      .get("/chats")
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    const bobChatBeforeRead = (
      bobChatsBeforeRead.body as Array<{ id: string; unreadCount: number }>
    ).find((chat) => chat.id === chatId);

    expect(bobChatBeforeRead).toBeDefined();
    expect(bobChatBeforeRead?.unreadCount).toBeGreaterThanOrEqual(1);

    const bobMessagesResponse = await bobAgent
      .get(`/chats/${chatId}/messages`)
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    expect(bobMessagesResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sentMessageId,
          body: messageText,
          isDeleted: false,
        }),
        expect.objectContaining({
          id: attachmentMessageId,
          body: null,
          attachments: [
            expect.objectContaining({
              id: attachmentId,
              mimeType: "text/plain",
            }),
          ],
        }),
      ]),
    );

    const downloadResponse = await bobAgent
      .get(`/attachments/${attachmentId}`)
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    expect(downloadResponse.text).toBe(attachmentPayload);
    expect(downloadResponse.headers["content-type"]).toContain("text/plain");

    await bobAgent
      .post(`/chats/${chatId}/read`)
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .send({ lastReadMessageId: attachmentMessageId })
      .expect(201);

    const bobChatsAfterRead = await bobAgent
      .get("/chats")
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    const bobChatAfterRead = (
      bobChatsAfterRead.body as Array<{ id: string; unreadCount: number }>
    ).find((chat) => chat.id === chatId);

    expect(bobChatAfterRead).toBeDefined();
    expect(bobChatAfterRead?.unreadCount).toBe(0);

    await bobAgent
      .delete(`/chats/${chatId}/messages/${sentMessageId}`)
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(403);

    const deleteMessageResponse = await aliceAgent
      .delete(`/chats/${chatId}/messages/${sentMessageId}`)
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .expect(200);

    expect(deleteMessageResponse.body.id).toBe(sentMessageId);
    expect(deleteMessageResponse.body.body).toBeNull();
    expect(deleteMessageResponse.body.deletedAt).toBeTruthy();
    expect(deleteMessageResponse.body.isDeleted).toBe(true);
    expect(deleteMessageResponse.body.attachments).toEqual([]);

    const messagesAfterDelete = await aliceAgent
      .get(`/chats/${chatId}/messages`)
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .expect(200);

    expect(messagesAfterDelete.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sentMessageId,
          body: null,
          isDeleted: true,
        }),
      ]),
    );

    await aliceAgent
      .delete(`/chats/${chatId}`)
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .expect(200, {
        success: true,
        chatId,
      });

    const bobChatsAfterDelete = await bobAgent
      .get("/chats")
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    expect(
      (bobChatsAfterDelete.body as Array<{ id: string }>).some((chat) => chat.id === chatId),
    ).toBe(false);

    await aliceAgent
      .get(`/chats/${chatId}`)
      .set("Authorization", `Bearer ${refreshBody.accessToken}`)
      .expect(404);
  });

  it("updates profile data and uploads an avatar", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userData = {
      email: `api.e2e.profile.${suffix}@example.com`,
      displayName: "Profile User",
      password: "password123",
    };
    const agent = request.agent(app.getHttpServer());

    const registerResponse = await agent
      .post("/auth/register")
      .send(userData)
      .expect(201);

    const authBody = registerResponse.body as AuthResponse;
    const renamedDisplayName = "Profile User Updated";

    const updateProfileResponse = await agent
      .patch("/users/me")
      .set("Authorization", `Bearer ${authBody.accessToken}`)
      .send({ displayName: renamedDisplayName })
      .expect(200);

    expect(updateProfileResponse.body.displayName).toBe(renamedDisplayName);

    const avatarBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sLJXewAAAAASUVORK5CYII=",
      "base64",
    );

    const uploadResponse = await agent
      .post("/users/me/avatar")
      .set("Authorization", `Bearer ${authBody.accessToken}`)
      .attach("file", avatarBuffer, {
        filename: "avatar.png",
        contentType: "image/png",
      })
      .expect(201);

    expect(uploadResponse.body.avatarUrl).toContain("/users/avatar-files/");

    const avatarPath = (uploadResponse.body.avatarUrl as string).split("?")[0];

    const avatarResponse = await agent
      .get(avatarPath)
      .query({ access_token: authBody.accessToken })
      .expect(200);

    expect(avatarResponse.headers["content-type"]).toContain("image/png");

    const removeResponse = await agent
      .delete("/users/me/avatar")
      .set("Authorization", `Bearer ${authBody.accessToken}`)
      .expect(200);

    expect(removeResponse.body.avatarUrl).toBeNull();
  });
});
