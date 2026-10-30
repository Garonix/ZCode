import { afterEach, describe, expect, it, vi } from "vitest";
import { ZCODE_RUNTIME_ENV_KEY } from "@zcode/shared";
import { createServiceLogger } from "../src/logger/serviceLogger.js";

describe("createServiceLogger", () => {
  const originalRuntimeEnv = process.env[ZCODE_RUNTIME_ENV_KEY];
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalRuntimeEnv == null) {
      delete process.env[ZCODE_RUNTIME_ENV_KEY];
    } else {
      process.env[ZCODE_RUNTIME_ENV_KEY] = originalRuntimeEnv;
    }
    if (originalNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("未声明 ZCODE_RUNTIME_ENV 时默认不输出 debug 日志", () => {
    delete process.env[ZCODE_RUNTIME_ENV_KEY];
    delete process.env.NODE_ENV;
    const sink = createSink();
    const logger = createServiceLogger("test", { sink });

    logger.debug(undefined, "hidden");
    logger.info(undefined, "visible");

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.log).toHaveBeenCalledTimes(1);
  });

  it("只设置 NODE_ENV=development 时不输出 debug 日志", () => {
    delete process.env[ZCODE_RUNTIME_ENV_KEY];
    process.env.NODE_ENV = "development";
    const sink = createSink();
    const logger = createServiceLogger("test", { sink });

    logger.debug(undefined, "hidden");

    expect(sink.debug).not.toHaveBeenCalled();
  });

  it("显式 ZCODE_RUNTIME_ENV=development 时输出 debug 日志", () => {
    process.env[ZCODE_RUNTIME_ENV_KEY] = "development";
    const sink = createSink();
    const logger = createServiceLogger("test", { sink });

    logger.debug(undefined, "visible");

    expect(sink.debug).toHaveBeenCalledTimes(1);
  });

  it("在缺少全局 process 的环境（如浏览器页面）下安全初始化且前缀不含 pid", () => {
    const originalProcess = globalThis.process;
    try {
      // 模拟浏览器渲染页环境：无全局 process
      // @ts-expect-error 故意置空以模拟浏览器运行时
      delete globalThis.process;
      const sink = createSink();
      const logger = createServiceLogger("browser-scope", { sink });
      logger.info(undefined, "hello from renderer");
      expect(sink.log).toHaveBeenCalledTimes(1);
      const logLine = sink.log.mock.calls[0][0] as string;
      expect(logLine).toContain("[browser-scope]");
      expect(logLine).not.toContain("[pid:");
    } finally {
      globalThis.process = originalProcess;
    }
  });

  it("在缺少全局 process 的环境下 isEffectiveDevelopmentNodeEnv 安全回退 false", async () => {
    const originalProcess = globalThis.process;
    try {
      // @ts-expect-error 故意置空以模拟浏览器运行时
      delete globalThis.process;
      const { isEffectiveDevelopmentNodeEnv, resolveEffectiveNodeEnv } =
        await import("../src/runtime-tools/nodeEnv.js");
      expect(isEffectiveDevelopmentNodeEnv()).toBe(false);
      expect(resolveEffectiveNodeEnv()).toBe("production");
    } finally {
      globalThis.process = originalProcess;
    }
  });
});

function createSink() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
}
