import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type TestUser = {
  email: string;
  password: string;
  displayName: string;
};

const PLAYWRIGHT_API_URL = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000";

async function waitForApiReady(request: APIRequestContext) {
  await expect
    .poll(async () => {
      const response = await request.post(`${PLAYWRIGHT_API_URL}/auth/refresh`);
      return response.status();
    }, {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBeLessThan(500);
}

async function gotoAndWaitForTestId(page: Page, url: string, testId: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: 15_000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_000);
    }
  }

  throw lastError;
}

async function registerUser(page: Page, user: TestUser) {
  await gotoAndWaitForTestId(page, "/register", "auth-form");
  await page.getByTestId("auth-display-name-input").fill(user.displayName);
  await page.getByTestId("auth-email-input").fill(user.email);
  await page.getByTestId("auth-password-input").fill(user.password);
  await page.getByTestId("auth-submit-button").click();
  await page.waitForURL(/\/chat(\/.*)?$/);
  await expect(page.getByTestId("chat-sidebar")).toBeVisible();
}

test("users can register, create a direct chat and receive a realtime message", async ({ browser, request }) => {
  await waitForApiReady(request);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alice: TestUser = {
    email: `playwright.alice.${suffix}@example.com`,
    displayName: "Playwright Alice",
    password: "password123",
  };
  const bob: TestUser = {
    email: `playwright.bob.${suffix}@example.com`,
    displayName: "Playwright Bob",
    password: "password123",
  };

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await registerUser(alicePage, alice);
  await registerUser(bobPage, bob);

  await alicePage.getByTestId("user-search-input").fill(bob.email);
  const searchResult = alicePage
    .getByTestId("user-search-result")
    .filter({ hasText: bob.displayName });

  await expect(searchResult).toBeVisible();
  await searchResult.click();
  await expect(alicePage).toHaveURL(/\/chat\/.+/);
  await expect(alicePage.getByTestId("conversation-title")).toContainText(bob.displayName);

  await gotoAndWaitForTestId(bobPage, "/chat", "chat-list");
  const bobChatListItem = bobPage
    .getByTestId("chat-list-item")
    .filter({ hasText: alice.displayName });

  await expect(bobChatListItem).toBeVisible();
  await bobChatListItem.click();
  await expect(bobPage.getByTestId("conversation-title")).toContainText(alice.displayName);

  const messageText = `Playwright message ${suffix}`;
  await alicePage.getByTestId("message-input").fill(messageText);
  await alicePage.getByTestId("send-message-button").click();

  await expect(
    bobPage.getByTestId("message-item").filter({ hasText: messageText }),
  ).toHaveCount(1);
  await expect(
    alicePage.getByTestId("message-item").filter({ hasText: messageText }),
  ).toHaveCount(1);

  await aliceContext.close();
  await bobContext.close();
});