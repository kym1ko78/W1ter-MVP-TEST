import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  formatDevPortReport,
  hasBlockingDevIssues,
  inspectDevPorts,
} from "./dev-port-utils.mjs";

const execFileAsync = promisify(execFile);

async function terminateChildTree(child) {
  if (!child?.pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      return;
    }

    child.kill("SIGTERM");
  } catch {
    // Best-effort cleanup. The child may have already exited.
  }
}

async function main() {
  const results = await inspectDevPorts();
  console.log(formatDevPortReport(results));

  if (hasBlockingDevIssues(results)) {
    process.exit(1);
    return;
  }

  const child = spawn("pnpm run dev:raw", {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  let isShuttingDown = false;

  const shutdown = async (exitCode = 0) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    await terminateChildTree(child);
    process.exit(exitCode);
  };

  process.once("SIGINT", () => {
    void shutdown(130);
  });

  process.once("SIGTERM", () => {
    void shutdown(143);
  });

  child.on("exit", (code, signal) => {
    if (isShuttingDown) {
      return;
    }

    if (signal) {
      isShuttingDown = true;
      process.kill(process.pid, signal);
      return;
    }

    isShuttingDown = true;
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
