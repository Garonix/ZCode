import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pureSha256, sha256HexAsync } from "../src/pureSha256.js";

function nodeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("pureSha256", () => {
  it("computes correct hash for empty input", () => {
    const data = new Uint8Array(0);
    assert.equal(pureSha256(data), nodeSha256(data));
  });

  it("computes correct hash for short text", () => {
    const data = new TextEncoder().encode("hello world");
    assert.equal(pureSha256(data), nodeSha256(data));
  });

  it("computes correct hash for unicode text", () => {
    const data = new TextEncoder().encode("ZCode 智能助手 - 图片上传第一性原理测试 🚀");
    assert.equal(pureSha256(data), nodeSha256(data));
  });

  it("computes correct hash for 64-byte boundary input", () => {
    const data = new Uint8Array(64).fill(0x42);
    assert.equal(pureSha256(data), nodeSha256(data));
  });

  it("computes correct hash for 55-byte boundary input (padding boundary)", () => {
    const data = new Uint8Array(55).fill(0x55);
    assert.equal(pureSha256(data), nodeSha256(data));
  });

  it("computes correct hash for large binary data (simulate image chunk)", () => {
    const size = 256 * 1024; // 256KB
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = (i * 31 + 7) & 0xff;
    }
    assert.equal(pureSha256(data), nodeSha256(data));
  });

  it("sha256HexAsync falls back gracefully when subtle is undefined", async () => {
    const originalSubtle = globalThis.crypto?.subtle;
    try {
      // 模拟局域网 HTTP 下 subtle 为 undefined 的情况
      if (globalThis.crypto) {
        Object.defineProperty(globalThis.crypto, "subtle", {
          value: undefined,
          configurable: true,
        });
      }
      const data = new TextEncoder().encode("insecure-context-payload");
      const hash = await sha256HexAsync(data);
      assert.equal(hash, nodeSha256(data));
    } finally {
      if (globalThis.crypto) {
        Object.defineProperty(globalThis.crypto, "subtle", {
          value: originalSubtle,
          configurable: true,
        });
      }
    }
  });
});
