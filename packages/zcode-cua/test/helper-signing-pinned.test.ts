import { describe, expect, it, vi } from "vitest";
import { resolveCuaHelperInstallPlan, verifyCuaHelperBundle } from "../vendor/dist-index.js";

const CERT_SHA256 = "a".repeat(64);

function createPlan(overrides: Record<string, unknown> = {}) {
  return {
    version: "3.17.1",
    platform: "darwin",
    arch: "arm64",
    platformKey: "darwin-arm64",
    installRoot: "/tmp/cua-helper",
    appPath: "/tmp/cua-helper/ZCode Computer Use.app",
    source: { kind: "bundled", appPath: "/tmp/bundled/ZCode Computer Use.app" },
    expectedBundleId: "dev.zcode.cua-helper",
    expectedTeamIdentifier: "TEAM123456",
    expectedBuildId: "pipeline-323224-025f7f39",
    expectedCertificateSha256: CERT_SHA256,
    allowUnsignedLocalDev: false,
    ...overrides,
  };
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  return {
    readBundleInfo: vi.fn(async () => ({
      bundleId: "dev.zcode.cua-helper",
      version: "3.17.1",
      buildVersion: "3.17.1",
      executableName: "ZCode Computer Use",
      buildId: "pipeline-323224-025f7f39",
    })),
    readExecutableArchs: vi.fn(async () => ["arm64"]),
    verifyCodeSignature: vi.fn(async () => undefined),
    inspectCodesignDetails: vi.fn(async () => ({
      teamIdentifier: null,
      authorities: [],
      rawOutput: "Signature=adhoc",
      adHoc: true,
    })),
    readSigningCertificateSha256: vi.fn(async () => CERT_SHA256),
    assessGatekeeper: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Computer Use Helper 自签名信任模型", () => {
  it("构建期固定的证书指纹命中时通过校验，且不要求 Apple TeamIdentifier", async () => {
    const dependencies = createDependencies();
    const result = await verifyCuaHelperBundle(
      "/tmp/cua-helper/ZCode Computer Use.app",
      createPlan(),
      dependencies as never,
    );

    expect(result.mode).toBe("pinned_self_signed");
    expect(result.releaseEligible).toBe(false);
    expect(dependencies.verifyCodeSignature).toHaveBeenCalledTimes(1);
    expect(dependencies.readSigningCertificateSha256).toHaveBeenCalledTimes(1);
    expect(dependencies.assessGatekeeper).not.toHaveBeenCalled();
  });

  it("证书指纹与构建期固定值不一致时拒绝启动", async () => {
    const dependencies = createDependencies({
      readSigningCertificateSha256: vi.fn(async () => "b".repeat(64)),
    });

    await expect(
      verifyCuaHelperBundle("/tmp/helper.app", createPlan(), dependencies as never),
    ).rejects.toMatchObject({
      code: "verification_failed",
      message: expect.stringContaining("signing certificate sha256"),
    });
  });

  it("签名已失效（例如打补丁后未重签）时在读取证书前就失败", async () => {
    const dependencies = createDependencies({
      verifyCodeSignature: vi.fn(async () => {
        throw new Error("code or signature have been modified");
      }),
    });

    await expect(
      verifyCuaHelperBundle("/tmp/helper.app", createPlan(), dependencies as never),
    ).rejects.toThrow("code or signature have been modified");
    expect(dependencies.readSigningCertificateSha256).not.toHaveBeenCalled();
  });

  it("指纹固定模式仍然校验 bundle id、build id 与架构", async () => {
    const wrongBuildId = createDependencies({
      readBundleInfo: vi.fn(async () => ({
        bundleId: "dev.zcode.cua-helper",
        version: "3.17.1",
        buildVersion: "3.17.1",
        executableName: "ZCode Computer Use",
        buildId: "pipeline-000000-00000000",
      })),
    });
    await expect(
      verifyCuaHelperBundle("/tmp/helper.app", createPlan(), wrongBuildId as never),
    ).rejects.toThrow(/build id/u);

    const wrongArch = createDependencies({ readExecutableArchs: vi.fn(async () => ["x64"]) });
    await expect(
      verifyCuaHelperBundle("/tmp/helper.app", createPlan(), wrongArch as never),
    ).rejects.toThrow(/arch/u);
  });

  it("安装计划把证书指纹规范化为小写十六进制并拒绝非法值", () => {
    const env = { HOME: "/tmp/cua-home", ZCODE_RUNTIME_ENV: "development" };
    const plan = resolveCuaHelperInstallPlan({
      env,
      targetPlatform: "darwin",
      targetArch: "arm64",
      embeddedBuildId: "pipeline-323224-025f7f39",
      embeddedCertificateSha256: "A".repeat(64),
    });
    expect(plan.expectedCertificateSha256).toBe(CERT_SHA256);

    expect(() =>
      resolveCuaHelperInstallPlan({
        env,
        targetPlatform: "darwin",
        targetArch: "arm64",
        embeddedBuildId: "pipeline-323224-025f7f39",
        embeddedCertificateSha256: "not-a-fingerprint",
      }),
    ).toThrow(/ZCODE_CUA_HELPER_CERT_SHA256/u);
  });
});
