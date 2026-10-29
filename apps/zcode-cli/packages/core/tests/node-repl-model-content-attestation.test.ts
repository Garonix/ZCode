import { describe, expect, it } from "vitest";
import { formatJsModelContent } from "../src/tool/handlers/node-repl-model-content.js";
import {
  attestOfficialCuaFrameContent,
  findOfficialCuaFrameContentPair,
  isOfficialCuaImageRefText,
  OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION,
} from "@zcode/zcode-cua/frame-contract";

describe("formatJsModelContent with official CUA frame attestation", () => {
  it("formats text-only output without images", () => {
    const output = {
      logs: "hello world",
      result: "42",
    };
    const content = formatJsModelContent(output);
    expect(content).toBe("hello world\n=> 42");
  });

  it("places regular images before textual summary without image_ref", () => {
    const output = {
      images: [{ base64: "dGVzdC1pbWFnZQ==", mimeType: "image/png" }],
      logs: "captured screenshot",
    };
    const content = formatJsModelContent(output);
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: "image",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,dGVzdC1pbWFnZQ==",
      data: "dGVzdC1pbWFnZQ==",
    });
    expect(content[1]).toEqual({
      type: "text",
      text: "captured screenshot",
    });
    // 不含 image_ref 时，不应匹配 official CUA pair
    expect(findOfficialCuaFrameContentPair(content)).toBeUndefined();
  });

  it("pairs image with extracted image_ref from logs and passes official attestation", () => {
    const validImageRef = JSON.stringify({
      image_ref: {
        actionable: true,
        frame_id: "frame_001",
        height: 1080,
        width: 1920,
      },
    });
    const output = {
      images: [{ base64: "dGVzdC1jdWEtcmFzdGVy", mimeType: "image/jpeg" }],
      logs: `Starting observation...\n${validImageRef}\nAccessibility tree:\n1: Window "Settings"`,
      result: "undefined",
    };

    const content = formatJsModelContent(output);
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;

    // 前两个块必须是 canonical pair: [image, image_ref]
    expect(content[0]).toMatchObject({
      type: "image",
      mediaType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,dGVzdC1jdWEtcmFzdGVy",
      data: "dGVzdC1jdWEtcmFzdGVy",
    });
    expect(content[1]).toEqual({
      type: "text",
      text: validImageRef,
    });
    expect(isOfficialCuaImageRefText((content[1] as { text: string }).text)).toBe(true);

    // 剩余文本应剥离 image_ref 并保留其它日志与返回值
    expect(content[2]).toMatchObject({
      type: "text",
    });
    const remaining = (content[2] as { text: string }).text;
    expect(remaining).toContain('Starting observation...');
    expect(remaining).toContain('1: Window "Settings"');
    expect(remaining).toContain('=> undefined');
    expect(remaining).not.toContain('"image_ref"');

    // 验证 findOfficialCuaFrameContentPair 和 attestOfficialCuaFrameContent
    const pair = findOfficialCuaFrameContentPair(content);
    expect(pair).toBeDefined();
    expect(pair?.imageIndex).toBe(0);
    expect(pair?.imageRefIndex).toBe(1);

    const attestation = attestOfficialCuaFrameContent(
      content,
      OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION,
    );
    expect(attestation).toEqual({ kind: OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION });
  });

  it("handles structured content array with image and image_ref correctly", () => {
    const validImageRef = JSON.stringify({
      image_ref: {
        actionable: true,
        frame_id: "frame_mcp_002",
        height: 900,
        width: 1440,
      },
    });
    const output = {
      content: [
        { type: "image", data: "bWNwLWJhc2U2NA==", mimeType: "image/png" },
        { type: "text", text: validImageRef },
        { type: "text", text: "Additional tree info" },
      ],
      _meta: { "zcode.cua/official-frame-integrity-v1": { version: 1, sha256: "abc" } },
    };

    const content = formatJsModelContent(output);
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;

    expect(content[0]).toMatchObject({
      type: "image",
      mediaType: "image/png",
      data: "bWNwLWJhc2U2NA==",
      dataUrl: "data:image/png;base64,bWNwLWJhc2U2NA==",
    });
    expect(content[1]).toEqual({
      type: "text",
      text: validImageRef,
    });

    const pair = findOfficialCuaFrameContentPair(content);
    expect(pair).toBeDefined();
    expect(pair?.imageIndex).toBe(0);
    expect(pair?.imageRefIndex).toBe(1);

    const attestation = attestOfficialCuaFrameContent(
      content,
      OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION,
    );
    expect(attestation).toEqual({ kind: OFFICIAL_CUA_FRAME_MODEL_CONTENT_PROTECTION });
  });
});
