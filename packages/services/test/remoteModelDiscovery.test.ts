import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { fetchRemoteProviderModels } from "../src/model-provider/remoteModelDiscovery.js";

test("fetchRemoteProviderModels - 空 URL 校验", async () => {
  const result = await fetchRemoteProviderModels({ baseUrl: "   " });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /为空/);
  assert.deepEqual(result.models, []);
});

test("fetchRemoteProviderModels - 非法协议校验", async () => {
  const result = await fetchRemoteProviderModels({ baseUrl: "ftp://example.com" });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /仅支持 HTTP\/HTTPS/);
});

test("fetchRemoteProviderModels - 成功解析 OpenAI 格式", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-key");
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
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    const result = await fetchRemoteProviderModels({
      baseUrl,
      apiKey: "test-key",
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.models, ["gpt-3.5-turbo", "gpt-4o"]);
  } finally {
    server.close();
  }
});

test("fetchRemoteProviderModels - 成功解析 Ollama 格式并自适应端点", async () => {
  const server = createServer((req, res) => {
    // 假设 /models 和 /v1/models 返回 404，而 /api/tags 返回 ollama tags
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
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await fetchRemoteProviderModels({
      baseUrl,
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.models, ["deepseek-r1:8b", "qwen2.5:7b"]);
  } finally {
    server.close();
  }
});

test("fetchRemoteProviderModels - 鉴权失败立即阻断", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid API Key" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  try {
    const result = await fetchRemoteProviderModels({
      baseUrl,
      apiKey: "wrong-key",
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /401 Unauthorized/);
  } finally {
    server.close();
  }
});
