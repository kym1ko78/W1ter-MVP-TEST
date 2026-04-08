import { spawn } from "node:child_process";

const port = process.env.PLAYWRIGHT_API_PORT ?? "4100";
const corsOrigin = process.env.PLAYWRIGHT_API_CORS_ORIGIN ?? "http://127.0.0.1:3100";

const child = spawn("pnpm --filter @repo/api start", {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    API_PORT: port,
    API_CORS_ORIGIN: corsOrigin,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
