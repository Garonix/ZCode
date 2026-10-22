import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";

export class BrokerError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use broker is unavailable.");
    this.name = "BrokerError";
    this.code = options.code ?? "unavailable";
    if (options.details !== undefined) this.details = options.details;
  }
}

export class CuaHelperError extends Error {
  constructor(message, options = {}) {
    super(message ?? "Computer Use Helper is unavailable.");
    this.name = "CuaHelperError";
    this.code = options.code ?? "helper_unavailable";
  }
}

export function isCuaHelperError(value) {
  return value instanceof CuaHelperError;
}

const brokerErrorFactory = (code) => (message, details) =>
  new BrokerError(message ?? code, { code, details });

export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");

/**
 * 中文修复说明：
 * 修复前：callBrokerMethod 硬编码抛出 "Computer Use is not available in this build."；
 * 修复依据：建立到 Helper 或 Broker Socket 的标准 IPC 连接，发送单行 JSON-RPC 请求并解析返回，
 * 支撑 PiP 会话与底层原生动作交互。
 */
export async function callBrokerMethod(args) {
  const { socketPath, method, timeoutMs = 15000, token, ...params } = args;
  if (!socketPath) {
    throw new BrokerError("Broker socket path is required.", { code: "unavailable" });
  }

  const id = randomUUID();
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const timer = setTimeout(() => {
      finish(new BrokerError(`Broker method ${method} timed out after ${timeoutMs}ms.`, { code: "timeout" }));
    }, timeoutMs);

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, token, method, params, ...params })}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        try {
          const raw = buffer.slice(0, newlineIndex);
          const payload = JSON.parse(raw);
          if (payload.ok) {
            finish(null, payload.result);
          } else {
            const err = payload.error;
            const msg = typeof err === "string" ? err : err?.message ?? "Broker request failed.";
            const code = typeof err === "object" ? err?.code : "broker_error";
            finish(new BrokerError(msg, { code, details: err }));
          }
        } catch (parseError) {
          finish(new BrokerError("Invalid JSON response from broker.", { code: "internal", details: parseError }));
        }
      }
    });

    socket.once("error", (err) => {
      finish(new BrokerError(`Failed to connect to broker socket: ${err.message}`, { code: "unavailable", details: err }));
    });

    socket.once("close", () => {
      if (!settled) {
        finish(new BrokerError("Broker socket closed before response was received.", { code: "unavailable" }));
      }
    });
  });
}

/**
 * 中文修复说明：
 * 修复前：probeHelperHealth 固定返回 { bundleId: null, pid: null }，导致 Host 端校验 PID 失败并强制杀死 Helper；
 * 修复依据：向目标 Socket 发送 health/ping 命令探活，解析并返回真实的 pid 与 bundleId。
 */
export async function probeHelperHealth(socketPath, options = {}) {
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 5000;
  if (!socketPath) return { bundleId: null, pid: null };

  return await new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;

    const timer = setTimeout(() => {
      finish(null);
    }, timeoutMs);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result ?? { bundleId: null, pid: null });
    };

    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: "probe-health", method: "health", params: {} })}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex >= 0) {
        try {
          const raw = buffer.slice(0, newlineIndex);
          const payload = JSON.parse(raw);
          if (payload.ok && payload.result) {
            finish({
              bundleId: payload.result.bundleId ?? null,
              pid: typeof payload.result.pid === "number" ? payload.result.pid : null,
            });
            return;
          }
        } catch {
          // ignore JSON parse error in health probe fallback
        }
        finish(null);
      }
    });

    socket.once("error", () => finish(null));
    socket.once("close", () => finish(null));
  });
}

/**
 * 中文修复说明：
 * 修复前：mintBrokerSocketPath 在 Windows 上仍返回 tmpdir()/*.sock，Node.js 监听该路径会触发 EACCES 权限错误；
 * 修复依据：根据当前操作系统或选项区分平台，Windows 平台返回合法命名管道路径 \\.\pipe\zcode-cua-*。
 */
export function mintBrokerSocketPath(options = {}) {
  const platform = options.platform ?? (options.env ? (options.env.OS === "Windows_NT" ? "win32" : process.platform) : process.platform);
  if (platform === "win32") {
    return `\\\\.\\pipe\\zcode-cua-${randomUUID()}`;
  }
  const dir = typeof options.dir === "string" ? options.dir : tmpdir();
  return join(dir, `zcode-cua-broker-${randomUUID()}.sock`);
}

export function resolveBrokerSocketPath(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = env[BROKER_SOCKET_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv;
  return mintBrokerSocketPath(options);
}

export function parseRequestLine(line) {
  if (typeof line !== "string" || !line.trim()) return undefined;
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function okResponse(result) {
  return { ok: true, result };
}

export function errorResponse(message, options = {}) {
  return {
    ok: false,
    error: { message, ...(options.code ? { code: options.code } : {}) },
  };
}

export function errorResponseFromException(error) {
  return errorResponse(error instanceof Error ? error.message : String(error));
}

export function serializeResponse(response) {
  return `${JSON.stringify(response)}\n`;
}

export async function dispatchRequest(_backend, _request) {
  throw new CuaHelperError("Computer Use is not available in this build.");
}

export async function handleRequestLine(_backend, _line) {
  throw new CuaHelperError("Computer Use is not available in this build.");
}

export function isBrokerMethod(_method) {
  return false;
}

export function isReadOnlyBrokerMethod(_method) {
  return false;
}
