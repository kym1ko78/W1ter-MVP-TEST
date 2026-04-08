import { spawn } from "node:child_process";

const distDir = process.env.PLAYWRIGHT_WEB_DIST_DIR ?? ".next-e2e";
const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4100";

const child = spawn("pnpm --filter @repo/web exec next build", {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_SOCKET_URL: apiUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});