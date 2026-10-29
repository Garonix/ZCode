import { describe, expect, it } from "vitest";
import { createComputerUseRuntime } from "../index.js";
import { callBrokerMethod, isCuaHelperError, CuaHelperError } from "../broker.js";
import { preserveOfficialCuaFrameResult, isOfficialCuaImageRefText } from "../frame-contract.js";

describe("Computer Use producer runtime", () => {
  it("导出的运行时构建工厂返回有效生命周期对象", async () => {
    const runtime = createComputerUseRuntime({
      brokerSocketPath: "/tmp/mock-cua.sock",
    });
    expect(runtime).toBeDefined();
    expect(typeof runtime.execute).toBe("function");
    expect(typeof runtime.closeSession).toBe("function");
    expect(typeof runtime.dispose).toBe("function");
    await runtime.dispose();
  });

  it("直接调用未连接 broker 方法时抛出 broker_unavailable 错误", async () => {
    await expect(
      callBrokerMethod({ method: "example", socketPath: "unused" }),
    ).rejects.toMatchObject({ code: "broker_unavailable" });
  });

  it("Helper 错误类型判定契约正确", () => {
    const error = new CuaHelperError("Helper unavailable");
    expect(isCuaHelperError(error)).toBe(true);
    expect(isCuaHelperError(new Error("Generic"))).toBe(false);
  });

  it("画面防伪放宽：图片帧透传且不抛出签名异常", async () => {
    const mockResult = {
      content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
      _meta: {},
    };
    const preserved = await preserveOfficialCuaFrameResult(mockResult, {});
    expect(preserved).toBe(mockResult);
  });

  it("image_ref 格式解析契约符合标准", () => {
    const valid = JSON.stringify({
      image_ref: {
        frame_id: "f-123",
        width: 1920,
        height: 1080,
        actionable: true,
      },
    });
    expect(isOfficialCuaImageRefText(valid)).toBe(true);
    expect(isOfficialCuaImageRefText("invalid text")).toBe(false);
  });
});
