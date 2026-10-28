import { describe, expect, it, vi } from "vitest";
import { ensureStandaloneHelperLaunched, ensureWindowsHelperForked } from "../index.js";

const RECIPE = {
  command: "C:\\app\\ZCode.exe",
  entryPath: "C:\\app\\resources\\tools\\cua-helper\\windows-helper.js",
  root: "C:\\app\\resources\\tools\\cua-helper",
  addonPath: "C:\\app\\resources\\tools\\cua-helper\\addon.node",
  commandEnv: { ZCODE_CUA_X: "1" },
  hostPid: 4242,
};

function makeForkSpy() {
  const calls: unknown[][] = [];
  const unrefSpy = vi.fn();
  const fork = vi.fn((command: string, args: string[], opts: unknown) => {
    calls.push([command, args, opts]);
    return { unref: unrefSpy, pid: 999 };
  });
  return { fork, calls: () => calls, unrefSpy };
}

describe("ensureWindowsHelperForked", () => {
  it("无 recipe 环境变量时 no-op", async () => {
    const { fork, calls } = makeForkSpy();
    await ensureWindowsHelperForked("\\\\.\\pipe\\zcode-cua-x", {}, fork);
    expect(calls()).toHaveLength(0);
  });

  it("recipe 为非法 JSON 时 no-op", async () => {
    const { fork, calls } = makeForkSpy();
    await ensureWindowsHelperForked(
      "\\\\.\\pipe\\zcode-cua-x",
      { ZCODE_CUA_WIN_HELPER_RECIPE: "{invalid-json" },
      fork,
    );
    expect(calls()).toHaveLength(0);
  });

  it("recipe 缺少关键属性时 no-op", async () => {
    const { fork, calls } = makeForkSpy();
    await ensureWindowsHelperForked(
      "\\\\.\\pipe\\zcode-cua-x",
      { ZCODE_CUA_WIN_HELPER_RECIPE: JSON.stringify({ ...RECIPE, hostPid: -1 }) },
      fork,
    );
    expect(calls()).toHaveLength(0);
  });

  it("有效 recipe 时正确传入参数并 fork helper，调用 unref", async () => {
    const { fork, calls, unrefSpy } = makeForkSpy();
    await ensureWindowsHelperForked(
      "\\\\.\\pipe\\zcode-cua-x",
      { ZCODE_CUA_WIN_HELPER_RECIPE: JSON.stringify(RECIPE) },
      fork,
    );
    expect(calls()).toHaveLength(1);
    const [command, argv, options] = calls()[0] as [string, string[], Record<string, unknown>];
    expect(command).toBe(RECIPE.command);
    expect(argv).toEqual([
      RECIPE.entryPath,
      "--socket",
      "\\\\.\\pipe\\zcode-cua-x",
      "--parent-pid",
      "4242",
    ]);
    expect(options.cwd).toBe(RECIPE.root);
    expect(options.detached).toBe(true);
    expect(options.stdio).toBe("ignore");
    const env = options.env as Record<string, string>;
    expect(env.ZCODE_CUA_HELPER_ADDON).toBe(RECIPE.addonPath);
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.ZCODE_CUA_X).toBe("1");
    expect(unrefSpy).toHaveBeenCalledTimes(1);
  });

  it("fork 失败时吞掉错误保证首调流程由后续真实连接状态收口", async () => {
    const fork = vi.fn(() => {
      throw new Error("EBUSY");
    });
    await expect(
      ensureWindowsHelperForked(
        "\\\\.\\pipe\\zcode-cua-x",
        { ZCODE_CUA_WIN_HELPER_RECIPE: JSON.stringify(RECIPE) },
        fork,
      ),
    ).resolves.toBeUndefined();
  });

  it("win32 平台上 ensureStandaloneHelperLaunched 会路由到 ensureWindowsHelperForked", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const { fork, calls } = makeForkSpy();
      await ensureStandaloneHelperLaunched(
        "\\\\.\\pipe\\zcode-cua-x",
        { ZCODE_CUA_WIN_HELPER_RECIPE: JSON.stringify(RECIPE) },
        { fork },
      );
      expect(calls()).toHaveLength(1);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});
