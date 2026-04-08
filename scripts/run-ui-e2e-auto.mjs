import { spawn } from "node:child_process";

function run(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command ${command} exited with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Command ${command} failed with exit code ${code}`));
        return;
      }

      resolve(undefined);
    });
  });
}

async function main() {
  await run("pnpm --filter @repo/api build");
  await run("node ./scripts/run-web-e2e-build.mjs");
  await run("pnpm exec playwright test --config=playwright.config.cjs", {
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3100",
    PLAYWRIGHT_WEB_PORT: "3100",
    PLAYWRIGHT_WEB_DIST_DIR: ".next-e2e",
    PLAYWRIGHT_API_URL: "http://127.0.0.1:4100",
    PLAYWRIGHT_API_PORT: "4100",
    PLAYWRIGHT_API_CORS_ORIGIN: "http://127.0.0.1:3100",
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
