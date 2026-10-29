import { describe, expect, it } from "vitest";
import {
  extractModelIds,
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
});
