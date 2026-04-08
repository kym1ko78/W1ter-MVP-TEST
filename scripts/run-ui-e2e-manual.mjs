import { spawn } from "node:child_process";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4000";
const loginUrl = new URL("/login", `${baseUrl}/`).toString();
const healthUrl = new URL("/health", `${apiUrl}/`).toString();

async function ensureReady(name, url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`${name} responded with status ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} is not ready at ${url}. ${message}`);
  }
}

function printGuidance() {
  console.error("\nManual UI e2e mode expects running local servers.");
  console.error("\nStart API if it is not already running:");
  console.error("  pnpm --filter @repo/api build");
  console.error("  pnpm --filter @repo/api start");
  console.error("\nStart web in another terminal:");
  console.error("  pnpm --filter @repo/web build");
  console.error("  pnpm --filter @repo/web exec next start --hostname 127.0.0.1 --port 3000");
  console.error("\nIf port 3000 is hanging or stale on Windows:");
  console.error("  netstat -ano | findstr :3000");
  console.error("  taskkill /PID <PID> /F");
  console.error("\nIf port 4000 is hanging or stale on Windows:");
  console.error("  netstat -ano | findstr :4000");
  console.error("  taskkill /PID <PID> /F");
}

async function main() {
  await ensureReady("API", healthUrl);
  await ensureReady("Web", loginUrl);

  const child = spawn("pnpm exec playwright test --config=playwright.config.cjs", {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_WEBSERVER: "1",
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  printGuidance();
  process.exit(1);
});
