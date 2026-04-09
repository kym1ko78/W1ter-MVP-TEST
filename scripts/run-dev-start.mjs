import { spawn } from "node:child_process";
import {
  formatDevPortReport,
  hasBlockingDevIssues,
  inspectDevPorts,
} from "./dev-port-utils.mjs";

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
  process.exit(1);
});
