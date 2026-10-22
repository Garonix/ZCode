import { afterEach, describe, expect, it } from "vitest";
import {
  createUuid,
  generateUuidFallback,
  installCryptoRandomUuidPolyfill,
} from "../src/uuid.js";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("UUID generation and polyfill safety", () => {
  const originalRandomUuid = globalThis.crypto?.randomUUID;

  afterEach(() => {
    if (globalThis.crypto) {
      if (originalRandomUuid) {
        globalThis.crypto.randomUUID = originalRandomUuid;
      } else {
        // @ts-expect-error restore state
        delete globalThis.crypto.randomUUID;
      }
    }
  });

  it("createUuid generates valid UUID format", () => {
    const id = createUuid();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("generateUuidFallback generates valid UUID format without randomUUID", () => {
    const id = generateUuidFallback();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("safe fallback in insecure context (without crypto.randomUUID)", () => {
    if (globalThis.crypto) {
      // @ts-expect-error simulate insecure context
      delete globalThis.crypto.randomUUID;
    }
    const id = createUuid();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("installCryptoRandomUuidPolyfill prevents infinite recursive stack overflow", () => {
    if (globalThis.crypto) {
      // @ts-expect-error simulate insecure context
      delete globalThis.crypto.randomUUID;
    }
    // 安装 polyfill
    installCryptoRandomUuidPolyfill();

    // 验证 polyfill 本身能被调用
    expect(typeof globalThis.crypto?.randomUUID).toBe("function");
    const idFromCrypto = globalThis.crypto!.randomUUID();
    expect(idFromCrypto).toMatch(UUID_V4_REGEX);

    // 验证 createUuid 不会陷入递归死循环 (Maximum call stack size exceeded)
    expect(() => {
      for (let i = 0; i < 50; i++) {
        const id = createUuid();
        expect(id).toMatch(UUID_V4_REGEX);
      }
    }).not.toThrow();
  });
});
