import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fetchRemoteProviderModels } from "../src/model-provider/remoteModelDiscovery.js";

describe("remoteModelDiscovery", () => {
  it("fetchRemoteProviderModels - 空 URL 校验", async () => {
    const result = await fetchRemoteProviderModels({ baseUrl: "   " });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/为空/);
    expect(result.models).toEqual([]);
  });

  it("fetchRemoteProviderModels - 非法协议校验", async () => {
    const result = await fetchRemoteProviderModels({ baseUrl: "ftp://example.com" });
    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/仅支持 HTTP\/HTTPS/);
  });

  it("fetchRemoteProviderModels - 成功解析 OpenAI 格式", async () => {
    const server = createServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer test-key");
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              { id: "gpt-4o", created: 123 },
              { id: "gpt-3.5-turbo", created: 456 },
            ],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    expect(address && typeof address === "object").toBe(true);
    const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}/v1`;

    try {
      const result = await fetchRemoteProviderModels({
        baseUrl,
        apiKey: "test-key",
      });
      expect(result.success).toBe(true);
      expect(result.models).toEqual(["gpt-3.5-turbo", "gpt-4o"]);
    } finally {
      server.close();
    }
  });

  it("fetchRemoteProviderModels - 成功解析 Ollama 格式并自适应端点", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            models: [{ name: "qwen2.5:7b" }, { name: "deepseek-r1:8b" }],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    expect(address && typeof address === "object").toBe(true);
    const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;

    try {
      const result = await fetchRemoteProviderModels({
        baseUrl,
      });
      expect(result.success).toBe(true);
      expect(result.models).toEqual(["deepseek-r1:8b", "qwen2.5:7b"]);
    } finally {
      server.close();
    }
  });

  it("fetchRemoteProviderModels - 鉴权失败立即阻断", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    expect(address && typeof address === "object").toBe(true);
    const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}/v1`;

    try {
      const result = await fetchRemoteProviderModels({
        baseUrl,
        apiKey: "wrong-key",
      });
      expect(result.success).toBe(false);
      expect(result.error ?? "").toMatch(/401 Unauthorized/);
    } finally {
      server.close();
    }
  });
});
