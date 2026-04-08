import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";

type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
};

describe("API e2e", () => {
  let app: INestApplication;

  beforeAll(async () => {
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
  });

  it("registers, refreshes, creates a direct chat, sends a message and marks it as read", async () => {
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

    const bobChatsBeforeRead = await bobAgent
      .get("/chats")
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    const bobChatBeforeRead = (bobChatsBeforeRead.body as Array<{ id: string; unreadCount: number }>).find(
      (chat) => chat.id === chatId,
    );

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
        }),
      ]),
    );

    await bobAgent
      .post(`/chats/${chatId}/read`)
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .send({ lastReadMessageId: sentMessageId })
      .expect(201);

    const bobChatsAfterRead = await bobAgent
      .get("/chats")
      .set("Authorization", `Bearer ${bobBody.accessToken}`)
      .expect(200);

    const bobChatAfterRead = (bobChatsAfterRead.body as Array<{ id: string; unreadCount: number }>).find(
      (chat) => chat.id === chatId,
    );

    expect(bobChatAfterRead).toBeDefined();
    expect(bobChatAfterRead?.unreadCount).toBe(0);
  });
});