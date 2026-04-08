import assert from "node:assert/strict";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:4000";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const alice = {
  email: `smoke.alice.${suffix}@example.com`,
  displayName: "Smoke Alice",
  password: "password123",
};

const bob = {
  email: `smoke.bob.${suffix}@example.com`,
  displayName: "Smoke Bob",
  password: "password123",
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });

  const rawBody = await response.text();
  const data = rawBody ? safeParseJson(rawBody) : null;

  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with ${response.status}: ${formatErrorBody(data)}`,
    );
  }

  return data;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatErrorBody(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function main() {
  console.log(`Running smoke test against ${baseUrl}`);

  const aliceRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify(alice),
  });

  const bobRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify(bob),
  });

  assert.equal(aliceRegister.user.email, alice.email.toLowerCase());
  assert.equal(bobRegister.user.email, bob.email.toLowerCase());
  assert.ok(aliceRegister.accessToken);
  assert.ok(bobRegister.accessToken);

  const aliceLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: alice.email,
      password: alice.password,
    }),
  });

  assert.ok(aliceLogin.accessToken);

  const createdChat = await request("/chats/direct", {
    method: "POST",
    headers: authHeaders(aliceLogin.accessToken),
    body: JSON.stringify({
      targetUserId: bobRegister.user.id,
    }),
  });

  assert.ok(createdChat.id);
  assert.equal(createdChat.members.length, 2);

  const messageBody = `Smoke test message ${new Date().toISOString()}`;
  const sentMessage = await request(`/chats/${createdChat.id}/messages`, {
    method: "POST",
    headers: authHeaders(aliceLogin.accessToken),
    body: JSON.stringify({ body: messageBody }),
  });

  assert.equal(sentMessage.body, messageBody);
  assert.equal(sentMessage.chatId, createdChat.id);

  const bobChatsBeforeRead = await request("/chats", {
    headers: authHeaders(bobRegister.accessToken),
  });

  const bobChatBeforeRead = bobChatsBeforeRead.find((chat) => chat.id === createdChat.id);
  assert.ok(bobChatBeforeRead, "Bob should see the created chat in chat list");
  assert.ok(
    bobChatBeforeRead.unreadCount >= 1,
    `Expected unreadCount >= 1, got ${bobChatBeforeRead.unreadCount}`,
  );

  const bobMessages = await request(`/chats/${createdChat.id}/messages`, {
    headers: authHeaders(bobRegister.accessToken),
  });

  assert.ok(Array.isArray(bobMessages.items));
  assert.ok(
    bobMessages.items.some((message) => message.id === sentMessage.id),
    "Bob should receive the message in history",
  );

  await request(`/chats/${createdChat.id}/read`, {
    method: "POST",
    headers: authHeaders(bobRegister.accessToken),
    body: JSON.stringify({
      lastReadMessageId: sentMessage.id,
    }),
  });

  const bobChatsAfterRead = await request("/chats", {
    headers: authHeaders(bobRegister.accessToken),
  });

  const bobChatAfterRead = bobChatsAfterRead.find((chat) => chat.id === createdChat.id);
  assert.ok(bobChatAfterRead, "Bob should still see the chat after marking it as read");
  assert.equal(bobChatAfterRead.unreadCount, 0);

  console.log("Smoke test passed.");
  console.log(`Created users: ${alice.email}, ${bob.email}`);
  console.log(`Created chat: ${createdChat.id}`);
  console.log(`Sent message: ${sentMessage.id}`);
}

main().catch((error) => {
  console.error("Smoke test failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
