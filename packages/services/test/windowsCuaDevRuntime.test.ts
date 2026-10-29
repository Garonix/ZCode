import { describe, expect, it } from "vitest";
import {
  resolveWindowsCuaRuntime,
  WindowsCuaDevRuntimeResolutionError,
  type WindowsCuaRuntimeFileSystem,
} from "../src/cua-permission-broker/windowsCuaDevRuntime.js";

const VALID_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  packageName: "@zcode/zcode-cua",
  packageVersion: "0.6.5",
  platform: "win32",
  arch: "x64",
  electronVersion: "41.0.3",
  entry: "windows-helper.js",
  addon: "addon.node",
  sha256: {
    entry: "a".repeat(64),
    addon: "b".repeat(64),
  },
});

function createMockFs(files: Record<string, string>): WindowsCuaRuntimeFileSystem {
  const statFn = async (path: string) => {
    if (path in files) {
      return { isDirectory: () => false, isFile: () => true };
    }
    const dirPrefix = path.endsWith("/") || path.endsWith("\\") ? path : `${path}/`;
    const isDir = Object.keys(files).some(
      (f) => f.startsWith(dirPrefix) || f.startsWith(path.replace(/\\/g, "/") + "/"),
    );
    if (isDir) {
      return { isDirectory: () => true, isFile: () => false };
    }
    throw new Error(`ENOENT: ${path}`);
  };

  return {
    stat: statFn,
    lstat: async (path: string) => {
      const s = await statFn(path);
      return { ...s, isSymbolicLink: () => false };
    },
    realpath: async (path: string) => path,
    readFile: async (path: string) => {
      const normalized = path.replace(/\\/g, "/");
      for (const [key, val] of Object.entries(files)) {
        if (key.replace(/\\/g, "/") === normalized) {
          return val;
        }
      }
      throw new Error(`ENOENT: ${path}`);
    },
  };
}

describe("resolveWindowsCuaRuntime resourcesPath 推导", () => {
  it("无任何 resourcesPath 且候选目录不存在时抛出 missing-resources-path", async () => {
    const fs = createMockFs({});
    await expect(
      resolveWindowsCuaRuntime({
        platform: "win32",
        env: {},
        fileSystem: fs,
      }),
    ).rejects.toThrow(WindowsCuaDevRuntimeResolutionError);
  });

  it("当通过 ZCODE_RESOURCES_PATH 环境变量传入时可正确解析 packaged runtime", async () => {
    const resPath = "/tmp/test-app/resources";
    const files = {
      "/tmp/test-app/resources/tools/cua-helper/runtime-manifest.json": VALID_MANIFEST,
      "/tmp/test-app/resources/tools/cua-helper/windows-helper.js": "entry-code",
      "/tmp/test-app/resources/tools/cua-helper/addon.node": "addon-binary",
    };
    const fs = createMockFs(files);
    const runtime = await resolveWindowsCuaRuntime({
      platform: "win32",
      arch: "x64",
      electronVersion: "41.0.3",
      env: { ZCODE_RESOURCES_PATH: resPath },
      fileSystem: fs,
      hashBytes: async (bytes) => (bytes === "entry-code" ? "a".repeat(64) : "b".repeat(64)),
    });

    expect(runtime.entryPath).toContain("windows-helper.js");
    expect(runtime.addonPath).toContain("addon.node");
  });

  it("当未配置任何环境变量但 process.execPath 同级 resources 存在时可自动推导", async () => {
    const originalExecPath = process.execPath;
    const mockExec = "/tmp/mock-install/ZCode.exe";
    Object.defineProperty(process, "execPath", { value: mockExec, configurable: true });
    try {
      const files = {
        "/tmp/mock-install/resources/tools/cua-helper/runtime-manifest.json": VALID_MANIFEST,
        "/tmp/mock-install/resources/tools/cua-helper/windows-helper.js": "entry-code",
        "/tmp/mock-install/resources/tools/cua-helper/addon.node": "addon-binary",
      };
      const fs = createMockFs(files);
      const runtime = await resolveWindowsCuaRuntime({
        platform: "win32",
        arch: "x64",
        electronVersion: "41.0.3",
        env: {},
        fileSystem: fs,
        hashBytes: async (bytes) => (bytes === "entry-code" ? "a".repeat(64) : "b".repeat(64)),
      });

      expect(runtime.entryPath).toContain("windows-helper.js");
      expect(runtime.addonPath).toContain("addon.node");
    } finally {
      Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
    }
  });
});
