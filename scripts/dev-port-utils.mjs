import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_CHECKS = [
  {
    port: 3000,
    label: "Web dev server",
    required: true,
    guidance:
      "Этот порт нужен основному frontend dev-серверу. Освободите его перед `pnpm dev`, чтобы не уехать на случайный fallback-порт.",
  },
  {
    port: 4000,
    label: "API dev server",
    required: true,
    guidance:
      "Этот порт нужен backend dev-серверу. Обычно его занимает старый `pnpm dev` или отдельный `pnpm --filter @repo/api start`.",
  },
  {
    port: 5433,
    label: "Docker PostgreSQL",
    required: false,
    guidance:
      "Если база не поднята, запустите `docker compose up -d` перед работой с приложением.",
  },
];

function splitCsvLine(line) {
  return line
    .trim()
    .replace(/^"|"$/g, "")
    .split('","');
}

async function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });

    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function isPortOccupied(port) {
  if (await canConnect("127.0.0.1", port)) {
    return true;
  }

  if (await canConnect("::1", port)) {
    return true;
  }

  return false;
}

async function getWindowsProcessName(pid) {
  if (!Number.isInteger(pid)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]);

    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (!firstLine || firstLine.startsWith("INFO:")) {
      return null;
    }

    const columns = splitCsvLine(firstLine);
    return columns[0] ?? null;
  } catch {
    return null;
  }
}

async function getWindowsListeners() {
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"]);
  const listeners = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("TCP")) {
      continue;
    }

    const parts = trimmed.split(/\s+/);

    if (parts.length < 5 || parts[3] !== "LISTENING") {
      continue;
    }

    const localAddress = parts[1];
    const pid = Number(parts[4]);
    const portText = localAddress.split(":").at(-1);
    const port = Number(portText);

    if (!Number.isInteger(port)) {
      continue;
    }

    listeners.push({ localAddress, pid, port });
  }

  return listeners;
}

async function getUnixListeners(port) {
  const { stdout } = await execFileAsync("lsof", [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);

  return stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid))
    .map((pid) => ({ pid, port, localAddress: `127.0.0.1:${port}` }));
}

function fallbackListener(port) {
  return [{ pid: null, processName: null, port, localAddress: `127.0.0.1:${port}` }];
}

export async function inspectPort(port) {
  const occupied = await isPortOccupied(port);

  if (!occupied) {
    return [];
  }

  try {
    if (process.platform === "win32") {
      const listeners = await getWindowsListeners();
      const matches = listeners.filter((listener) => listener.port === port);

      if (matches.length === 0) {
        return fallbackListener(port);
      }

      return Promise.all(
        matches.map(async (listener) => ({
          ...listener,
          processName: await getWindowsProcessName(listener.pid),
        })),
      );
    }

    const listeners = await getUnixListeners(port);

    if (listeners.length === 0) {
      return fallbackListener(port);
    }

    return listeners.map((listener) => ({
      ...listener,
      processName: null,
    }));
  } catch {
    return fallbackListener(port);
  }
}

export async function inspectDevPorts(checks = DEFAULT_CHECKS) {
  const results = [];

  for (const check of checks) {
    const listeners = await inspectPort(check.port);

    results.push({
      ...check,
      listeners,
      occupied: listeners.length > 0,
    });
  }

  return results;
}

export function formatDevPortReport(results) {
  const lines = [];
  const blocking = results.filter((result) => result.required && result.occupied);
  const warnings = results.filter((result) => !result.required && !result.occupied);

  lines.push("Local dev preflight");
  lines.push("");

  for (const result of results) {
    if (result.occupied) {
      for (const listener of result.listeners) {
        const pidLabel = Number.isInteger(listener.pid) ? `PID ${listener.pid}` : "PID unavailable";
        const processSuffix = listener.processName ? ` (${listener.processName})` : "";
        const severity = result.required ? "[BLOCKED]" : "[INFO]";
        lines.push(
          `${severity} ${result.label} uses port ${result.port}: ${pidLabel}${processSuffix}`,
        );
      }

      lines.push(`         ${result.guidance}`);

      if (result.required && Number.isInteger(result.listeners[0]?.pid)) {
        lines.push(`         To stop it: taskkill /PID ${result.listeners[0].pid} /F`);
      }
    } else {
      const severity = result.required ? "[OK]" : "[WARN]";
      const statusMessage = result.required
        ? `${result.label} port ${result.port} is available.`
        : `${result.label} on port ${result.port} is not listening yet.`;

      lines.push(`${severity} ${statusMessage}`);

      if (!result.required) {
        lines.push(`       ${result.guidance}`);
      }
    }

    lines.push("");
  }

  if (blocking.length > 0) {
    lines.push("Result: dev start is blocked until required ports are free.");
  } else if (warnings.length > 0) {
    lines.push("Result: dev start can continue, but you still need to bring optional services up.");
  } else {
    lines.push("Result: dev start can continue.");
  }

  return lines.join("\n");
}

export function hasBlockingPortConflicts(results) {
  return results.some((result) => result.required && result.occupied);
}