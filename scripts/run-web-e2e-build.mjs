import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const distDir = process.env.PLAYWRIGHT_WEB_DIST_DIR ?? ".next-e2e";
const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://127.0.0.1:4100";
const nextEnvPath = path.join(process.cwd(), "apps", "web", "next-env.d.ts");

function runBuild() {
  return new Promise((resolve, reject) => {
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
        reject(new Error(`next build exited with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`next build failed with exit code ${code ?? 1}`));
        return;
      }

      resolve(undefined);
    });
  });
}

async function main() {
  const originalNextEnv = await readFile(nextEnvPath);

  try {
    await runBuild();
  } finally {
    await writeFile(nextEnvPath, originalNextEnv);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
