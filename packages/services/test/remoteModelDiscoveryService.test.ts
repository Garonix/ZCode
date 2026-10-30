import { describe, expect, it, vi } from "vitest";
import {
  extractModelIds,
  fetchRemoteProviderModels,
  resolveCandidateEndpoints,
} from "../src/model-provider/remoteModelDiscoveryService.js";

describe("remoteModelDiscoveryService", () => {
  it("resolves candidate endpoints correctly for root and /v1 base URLs", () => {
    const endpointsRoot = resolveCandidateEndpoints("http://localhost:11434");
    expect(endpointsRoot).toContain("http://localhost:11434/models");
    expect(endpointsRoot).toContain("http://localhost:11434/v1/models");
    expect(endpointsRoot).toContain("http://localhost:11434/api/tags");

    const endpointsV1 = resolveCandidateEndpoints("https://api.openai.com/v1");
    expect(endpointsV1).toContain("https://api.openai.com/v1/models");
    expect(endpointsV1).toContain("https://api.openai.com/models");
    expect(endpointsV1).toContain("https://api.openai.com/api/tags");
  });

  it("extracts model IDs from standard OpenAI-compatible response { data: [{ id: ... }] }", () => {
    const payload = {
      data: [
        { id: "gpt-4o", object: "model" },
        { id: "claude-3-5-sonnet", object: "model" },
      ],
    };
    expect(extractModelIds(payload)).toEqual(["claude-3-5-sonnet", "gpt-4o"]);
  });

  it("extracts model IDs from Ollama response { models: [{ name: ... }] }", () => {
    const payload = {
      models: [
        { name: "llama3:latest", size: 123456 },
        { name: "qwen2.5-coder:32b", size: 654321 },
      ],
    };
    expect(extractModelIds(payload)).toEqual(["llama3:latest", "qwen2.5-coder:32b"]);
  });

  it("extracts model IDs from simple string array response", () => {
    const payload = ["deepseek-chat", "deepseek-coder"];
    expect(extractModelIds(payload)).toEqual(["deepseek-chat", "deepseek-coder"]);
  });

  it("gracefully returns empty array for malformed or empty data", () => {
    expect(extractModelIds(null)).toEqual([]);
    expect(extractModelIds({})).toEqual([]);
    expect(extractModelIds("random string")).toEqual([]);
  });

  it("在缺少全局 process 的浏览器环境中正常执行且支持可选注入 logger", async () => {
    const originalProcess = globalThis.process;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: "model-a" }, { id: "model-b" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const infoLogger = vi.fn();
    try {
      // 模拟纯浏览器渲染环境（无 process 全局对象）
      // @ts-expect-error 故意置空以模拟浏览器运行时
      delete globalThis.process;

      const result = await fetchRemoteProviderModels({
        baseUrl: "https://api.example.com/v1",
        logger: { info: infoLogger },
      });

      expect(result.success).toBe(true);
      expect(result.models).toEqual(["model-a", "model-b"]);
      expect(infoLogger).toHaveBeenCalledWith(
        expect.stringContaining(
          "[remoteModelDiscovery] 成功从 https://api.example.com/v1/models 发现 2 个模型",
        ),
      );
    } finally {
      globalThis.process = originalProcess;
      vi.unstubAllGlobals();
    }
  });

  it("探测失败时能正常调用注入 logger 并返回错误信息", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection reset"));
    vi.stubGlobal("fetch", fetchMock);
    const infoLogger = vi.fn();

    try {
      const result = await fetchRemoteProviderModels({
        baseUrl: "https://api.example.com",
        logger: { info: infoLogger },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network connection reset");
      expect(infoLogger).toHaveBeenCalledWith(
        expect.stringContaining("[remoteModelDiscovery] 请求端点失败"),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
