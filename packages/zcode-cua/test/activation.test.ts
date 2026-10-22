import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "../index.js";
import { callBrokerMethod, mintBrokerSocketPath, probeHelperHealth } from "../broker.js";

describe("Windows CUA Activation & IPC Protocol", () => {
  it("mintBrokerSocketPath 支持跨平台路径格式", () => {
    const winPath = mintBrokerSocketPath({ platform: "win32" });
    expect(winPath.startsWith("\\\\.\\pipe\\zcode-cua-")).toBe(true);

    const unixPath = mintBrokerSocketPath({ platform: "linux" });
    expect(unixPath.includes("zcode-cua-broker-")).toBe(true);
    expect(unixPath.endsWith(".sock")).toBe(true);
  });

  it("probeHelperHealth 能够向 Socket 探活并获取 PID", async () => {
    const socketName = `mock-probe-${randomUUID()}.sock`;
    const socketPath = join(tmpdir(), socketName);

    const server = createServer((socket) => {
      socket.on("data", (data) => {
        const line = data.toString("utf8");
        const req = JSON.parse(line.trim());
        if (req.method === "health") {
          socket.write(`${JSON.stringify({ id: req.id, ok: true, result: { pid: 9999, bundleId: "dev.test" } })}\n`);
        }
      });
    });

    await new Promise((resolve) => server.listen(socketPath, resolve));

    try {
      const health = await probeHelperHealth(socketPath, { timeoutMs: 1000 });
      expect(health).toEqual({ pid: 9999, bundleId: "dev.test" });
    } finally {
      server.close();
    }
  });

  it("callBrokerMethod 能够完成 JSON-RPC 往返并解析返回值", async () => {
    const socketName = `mock-call-${randomUUID()}.sock`;
    const socketPath = join(tmpdir(), socketName);

    const server = createServer((socket) => {
      socket.on("data", (data) => {
        const line = data.toString("utf8");
        const req = JSON.parse(line.trim());
        if (req.method === "list_apps") {
          socket.write(`${JSON.stringify({ id: req.id, ok: true, result: [{ name: "Notepad", pid: 101 }] })}\n`);
        }
      });
    });

    await new Promise((resolve) => server.listen(socketPath, resolve));

    try {
      const result = await callBrokerMethod({
        socketPath,
        method: "list_apps",
        timeoutMs: 1000,
      });
      expect(result).toEqual([{ name: "Notepad", pid: 101 }]);
    } finally {
      server.close();
    }
  });

  it("createComputerUseRuntime 配置真实 socket 时能够正确转发 execute 并返回 MCP 格式", async () => {
    const socketName = `mock-runtime-${randomUUID()}.sock`;
    const socketPath = join(tmpdir(), socketName);

    const server = createServer((socket) => {
      socket.on("data", (data) => {
        const line = data.toString("utf8");
        const req = JSON.parse(line.trim());
        if (req.method === "left_click") {
          socket.write(
            `${JSON.stringify({
              id: req.id,
              ok: true,
              result: {
                content: [{ type: "text", text: "clicked at 100, 200" }],
                structuredContent: { ok: true, action_sent: true },
              },
            })}\n`,
          );
        }
      });
    });

    await new Promise((resolve) => server.listen(socketPath, resolve));

    try {
      const runtime = createComputerUseRuntime({
        brokerSocketPath: socketPath,
      });

      const res = (await runtime.execute({
        toolName: "left_click",
        arguments: { x: 100, y: 200 },
        context: { sessionId: "s1", runtimeScope: "main", workspaceKey: "w1" },
      })) as { content: unknown[]; structuredContent: unknown; isError: boolean };

      expect(res.isError).toBe(false);
      expect(res.content).toEqual([{ type: "text", text: "clicked at 100, 200" }]);
      expect(res.structuredContent).toEqual({ ok: true, action_sent: true });
    } finally {
      server.close();
    }
  });
});
