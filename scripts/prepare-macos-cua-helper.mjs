#!/usr/bin/env node
/**
 * 把官方 macOS 安装包里的 Computer Use Helper 准备成「本构建可用的产物」。
 *
 * 为什么不能直接随包用官方 Helper（2026-11-04 定位到的真实故障）：
 * 1. Helper 对 launcher 的签名要求是
 *    `anchor apple generic and identifier "dev.zcode.app" and certificate leaf[subject.OU] = "<Z.ai team>"`，
 *    本仓库自建的 ZCode.app 不可能满足；Helper 里放行未签名 launcher 的逃逸
 *    （`--allow-unsigned-launcher-local-dev`）又被编译期常量 `allowUnsignedLauncherLocalDev = false`
 *    门住，只能改二进制才能打开。
 * 2. 官方 Helper 已由 Apple 公证，**任何对 Mach-O 的原地改写都会让 codesign 校验失败**，
 *    启动即被内核 SIGKILL（exit 137，Code Signature Invalid）。上一版就是这样出厂的。
 *
 * 因此本脚本的顺序是：解包 → 打补丁 → **用本仓库固定的自签名证书重签** → 自检 → 写出
 * `signing.json`（build id + 证书指纹），供构建期折叠进 JS bundle，由宿主的
 * `verifyCuaHelperBundle()` 做证书 pinning 校验。
 *
 * 没有配置签名身份时直接失败（fail-closed）：宁可不出 Helper，也不要产出「签名无效 →
 * 系统杀掉 → CUA 永远 starting up」的假可用包。
 *
 * 用法：
 *   node scripts/prepare-macos-cua-helper.mjs [arch] [--force] [--version x.y.z]
 *
 * 环境变量：
 *   ZCODE_CUA_HELPER_SIGNING_IDENTITY  必填，codesign 身份（自签名证书 CN）
 *   ZCODE_CUA_HELPER_DOWNLOAD_URL      可选，覆盖安装包 zip 地址
 *   ZCODE_CUA_CDN_BASE                 可选，覆盖 CDN 根
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const desktopPackageRoot = resolve(repoRoot, "packages", "desktop");
const helperStagingRoot = resolve(desktopPackageRoot, "bundled-cua-helper");
const signingMetaPath = resolve(helperStagingRoot, "signing.json");
const CDN_BASE = process.env.ZCODE_CUA_CDN_BASE || "https://cdn-zcode.z.ai/zcode/electron/releases";
const HELPER_APP_NAME = "ZCode Computer Use.app";
const HELPER_EXECUTABLE_NAME = "ZCode Computer Use";
// 官方 Helper 里放行未签名 launcher 的编译期开关。补丁是**必需**的：Helper 的运行时判定要求
// 该常量与 argv 逃逸同时成立（helperRuntimeAllowsUnsignedLauncherLocalDev），否则它拒绝我们的
// 未签名 ZCode.app。改写后必须重签，否则 macOS 直接杀进程。
const UNSIGNED_LAUNCHER_PATCH = {
  from: Buffer.from("var allowUnsignedLauncherLocalDev = false;", "utf8"),
  to: Buffer.from("var allowUnsignedLauncherLocalDev = true; ", "utf8"),
};

function log(message) {
  console.log(`[prepare-macos-cua-helper] ${message}`);
}

function run(file, args) {
  return execFileSync(file, args, { stdio: "inherit", encoding: "utf8" });
}

function runQuiet(file, args) {
  return execFileSync(file, args, { stdio: "pipe", encoding: "utf8" });
}

const MACHO_ARCH_NAMES = new Map([
  [0x0100000c, "arm64"],
  [0x01000007, "x64"],
  [0x00000007, "i386"],
  [0x0000000c, "arm"],
]);

/**
 * 自读 Mach-O 头判断架构：不依赖 /usr/bin/lipo（Xcode CLT shim 在用户机升级后可能失效），
 * 与宿主 helperVerifier 的判定方式保持一致。
 */
export function readMachOArchs(executablePath) {
  const header = readFileSync(executablePath);
  if (header.length < 8) throw new Error("不是 Mach-O：头部不足 8 字节");
  const beMagic = header.readUInt32BE(0);
  const leMagic = header.readUInt32LE(0);
  const fatMagic = [0xcafebabe, 0xcafebabf].includes(beMagic)
    ? { endianBig: true }
    : [0xcafebabe, 0xcafebabf].includes(leMagic)
      ? { endianBig: false }
      : null;
  if (fatMagic) {
    const readU32 = (offset) =>
      fatMagic.endianBig ? header.readUInt32BE(offset) : header.readUInt32LE(offset);
    const count = readU32(4);
    const entrySize = (fatMagic.endianBig ? beMagic : leMagic) === 0xcafebabf ? 32 : 20;
    const archs = [];
    for (let index = 0; index < count; index += 1) {
      const at = 8 + index * entrySize;
      if (at + 8 > header.length) break;
      archs.push(archName(readU32(at)));
    }
    return archs;
  }
  const thinBig = [0xfeedface, 0xfeedfacf].includes(beMagic);
  const thinLittle = [0xfeedface, 0xfeedfacf].includes(leMagic);
  if (thinBig || thinLittle) {
    if (header.length < 12) throw new Error("不是 Mach-O：thin 头被截断");
    const cputype = thinBig ? header.readUInt32BE(4) : header.readUInt32LE(4);
    return [archName(cputype)];
  }
  throw new Error(`不是 Mach-O：无法识别的 magic 0x${beMagic.toString(16)}`);
}

function archName(cputype) {
  return MACHO_ARCH_NAMES.get(cputype >>> 0) ?? `unknown(0x${(cputype >>> 0).toString(16)})`;
}

function assertMachOContainsArch(executablePath, arch) {
  const archs = readMachOArchs(executablePath);
  if (!archs.includes(arch)) {
    throw new Error(
      `[prepare-macos-cua-helper] Helper 可执行架构 [${archs.join(", ")}] 不含目标架构 ${arch}`,
    );
  }
}

export function readHelperBuildIdFromPlist(plistPath) {
  const output = runQuiet("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :ZCodeCUAHelperBuildId",
    plistPath,
  ]);
  const buildId = output.trim();
  if (!buildId) {
    throw new Error(`[prepare-macos-cua-helper] ${plistPath} 缺少 ZCodeCUAHelperBuildId`);
  }
  return buildId;
}

export function readSigningCertificateSha256(appPath) {
  const directory = mkdtempSync(join(tmpdir(), "zcode-cua-cert-"));
  try {
    const prefix = join(directory, "cert");
    try {
      runQuiet("/usr/bin/codesign", ["-d", `--extract-certificates=${prefix}`, appPath]);
    } catch (error) {
      // codesign -d 在部分版本上以非零退出码输出诊断信息，只有产物缺失才算失败。
      if (!existsSync(`${prefix}0`)) throw error;
    }
    const leafPath = `${prefix}0`;
    if (!existsSync(leafPath)) {
      throw new Error(`[prepare-macos-cua-helper] ${appPath} 没有可提取的签名证书`);
    }
    return createHash("sha256").update(readFileSync(leafPath)).digest("hex");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function helperSignatureIsValid(appPath) {
  try {
    runQuiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
    return true;
  } catch {
    return false;
  }
}

function readExistingSigningMeta() {
  if (!existsSync(signingMetaPath)) return null;
  try {
    return JSON.parse(readFileSync(signingMetaPath, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  let arch = process.env.TARGET_ARCH || process.arch;
  let version;
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === "--force") {
      force = true;
    } else if (entry === "--version") {
      version = argv[++index];
    } else if (!entry.startsWith("--")) {
      arch = entry;
    }
  }
  return { arch: arch === "x86_64" ? "x64" : arch, version, force };
}

export async function prepareMacosCuaHelper({ arch = process.env.TARGET_ARCH || process.arch, version, force = false } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("[prepare-macos-cua-helper] 只在 macOS 上执行");
  }
  const normalizedArch = arch === "x86_64" ? "x64" : arch;
  const targetDir = resolve(helperStagingRoot, normalizedArch);
  const helperAppPath = join(targetDir, HELPER_APP_NAME);
  const signingIdentity = process.env.ZCODE_CUA_HELPER_SIGNING_IDENTITY?.trim();

  const pkgJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const targetVersion = version || pkgJson.version;
  if (!targetVersion) {
    throw new Error("[prepare-macos-cua-helper] 无法确定目标版本（package.json 缺少 version）");
  }

  // 复用的前提是「签名仍然有效且证书与 meta 记录一致」；否则必须重建。
  if (!force && existsSync(helperAppPath)) {
    const meta = readExistingSigningMeta();
    if (
      meta?.arch === normalizedArch &&
      meta?.version === targetVersion &&
      helperSignatureIsValid(helperAppPath) &&
      meta?.certificateSha256 === readSigningCertificateSha256(helperAppPath)
    ) {
      log(`复用已签名 Helper：${helperAppPath}`);
      return meta;
    }
    log("已存在的 Helper 与本次构建不匹配（版本/签名/证书），重新准备");
  }

  if (!signingIdentity) {
    throw new Error(
      "[prepare-macos-cua-helper] 缺少 ZCODE_CUA_HELPER_SIGNING_IDENTITY。\n" +
        "  Helper 必须先打补丁再用固定的自签名证书重签，否则 macOS 会因签名失效直接杀掉进程。\n" +
        "  生成身份：bash scripts/create-cua-helper-signing-identity.sh\n" +
        "  导入身份：bash scripts/import-cua-helper-signing-identity.sh <p12 路径> <密码>",
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), "zcode-cua-helper-"));
  const zipPath = join(tmpRoot, "download.zip");
  const extractDir = join(tmpRoot, "extracted");

  try {
    const zipUrl =
      process.env.ZCODE_CUA_HELPER_DOWNLOAD_URL?.trim() ||
      `${CDN_BASE}/${targetVersion}/macos-${normalizedArch}/ZCode-${targetVersion}-mac-${normalizedArch}.zip`;
    log(`下载 ${zipUrl}`);
    run("/usr/bin/curl", ["-fSL", "--retry", "3", "--retry-delay", "5", "-o", zipPath, zipUrl]);

    // ditto 而非 unzip：保留 bundle 的符号链接、扩展属性与资源分叉，避免解包阶段就动坏签名。
    mkdirSync(extractDir, { recursive: true });
    log("解包（ditto）");
    run("/usr/bin/ditto", ["-x", "-k", zipPath, extractDir]);

    const sourceHelper = join(
      extractDir,
      "ZCode.app",
      "Contents",
      "Resources",
      "cua-helper",
      HELPER_APP_NAME,
    );
    if (!existsSync(sourceHelper)) {
      throw new Error(`[prepare-macos-cua-helper] 安装包里没有找到 ${HELPER_APP_NAME}: ${sourceHelper}`);
    }

    mkdirSync(targetDir, { recursive: true });
    rmSync(helperAppPath, { recursive: true, force: true });
    log("拷贝 Helper（ditto）");
    run("/usr/bin/ditto", [sourceHelper, helperAppPath]);

    const helperBin = join(helperAppPath, "Contents", "MacOS", HELPER_EXECUTABLE_NAME);
    if (!existsSync(helperBin)) {
      throw new Error(`[prepare-macos-cua-helper] Helper 主可执行缺失: ${helperBin}`);
    }
    assertMachOContainsArch(helperBin, normalizedArch);

    const infoPlistPath = join(helperAppPath, "Contents", "Info.plist");
    const buildId = readHelperBuildIdFromPlist(infoPlistPath);

    // 先摘出官方 entitlements，重签时原样带上；缺失属正常情况。
    let entitlementsPath = null;
    try {
      const entitlements = runQuiet("/usr/bin/codesign", ["-d", "--entitlements", ":-", helperBin]).trim();
      if (entitlements.startsWith("<?xml") || entitlements.startsWith("<plist")) {
        entitlementsPath = join(tmpRoot, "entitlements.plist");
        writeFileSync(entitlementsPath, entitlements);
      }
    } catch {
      // 官方 Helper 通常没有 entitlements；读不到就按无 entitlements 重签。
    }

    log("打补丁：allowUnsignedLauncherLocalDev -> true");
    const binary = readFileSync(helperBin);
    const occurrences = countOccurrences(binary, UNSIGNED_LAUNCHER_PATCH.from);
    if (occurrences !== 1) {
      throw new Error(
        `[prepare-macos-cua-helper] 补丁锚点出现 ${occurrences} 次（期望 1 次）。` +
          "官方 Helper 的构建方式可能已变化，请同步更新补丁，避免打不上却静默通过。",
      );
    }
    writeFileSync(helperBin, replaceOnce(binary, UNSIGNED_LAUNCHER_PATCH.from, UNSIGNED_LAUNCHER_PATCH.to));

    // ditto 会保留下载产物上的扩展属性；带残留 xattr 的 bundle 会让 codesign 报
    // "resource fork, Finder information, or similar detritus not allowed"，先清干净再签。
    try {
      run("/usr/bin/xattr", ["-cr", helperAppPath]);
    } catch {
      // 没有 xattr 可清时命令可能返回非零，不影响后续签名。
    }

    log(`重签 Helper（identity=${signingIdentity}）`);
    const signArgs = ["--force", "--sign", signingIdentity, "--identifier", "dev.zcode.cua-helper"];
    // CI 把身份放在临时 keychain 里；显式指定，避免 codesign 只在默认搜索列表里找不到自签名身份。
    const signingKeychainPath = process.env.ZCODE_CUA_HELPER_KEYCHAIN_PATH?.trim();
    if (signingKeychainPath) signArgs.push("--keychain", signingKeychainPath);
    if (entitlementsPath) signArgs.push("--entitlements", entitlementsPath);
    signArgs.push(helperAppPath);
    run("/usr/bin/codesign", signArgs);

    // 重签后必须自检：这一步就是上一版缺的。签名不通过时宁可让构建失败。
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", helperAppPath]);
    const certificateSha256 = readSigningCertificateSha256(helperAppPath);

    const meta = {
      schema: 1,
      arch: normalizedArch,
      version: targetVersion,
      buildId,
      certificateSha256,
      signingIdentity,
      signedAt: new Date().toISOString(),
    };
    writeFileSync(signingMetaPath, `${JSON.stringify(meta, null, 2)}\n`);
    log(`完成：buildId=${buildId} certSha256=${certificateSha256}`);
    log(`signing.json: ${signingMetaPath}`);
    return meta;
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    index = haystack.indexOf(needle, index);
    if (index < 0) return count;
    count += 1;
    index += needle.length;
  }
}

function replaceOnce(haystack, from, to) {
  const index = haystack.indexOf(from);
  if (index < 0) throw new Error("[prepare-macos-cua-helper] 补丁锚点缺失");
  const result = Buffer.alloc(haystack.length - from.length + to.length);
  haystack.copy(result, 0, 0, index);
  to.copy(result, index);
  haystack.copy(result, index + to.length, index + from.length);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  prepareMacosCuaHelper(options).then(
    (meta) => {
      console.log(JSON.stringify(meta));
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
