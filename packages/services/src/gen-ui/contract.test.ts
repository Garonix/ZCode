import { describe, expect, it } from "vitest";
import { exampleGenUiPrepare } from "./contract.example.js";
import { IGenUiService } from "./contract.js";

describe("gen-ui contract", () => {
  it("描述符绑定 gen-ui 频道", () => {
    expect(IGenUiService.channelName).toBe("gen-ui");
  });

  it("示例满足 GenUiPrepareParams 结构", () => {
    expect(exampleGenUiPrepare.workspacePath).toBe("/workspace");
    expect(exampleGenUiPrepare.html).toContain("Chart");
  });
});
