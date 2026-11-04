#!/usr/bin/env node
/**
 * macOS 构建门禁：确认随包 Computer Use Helper 的签名有效，且证书与 build id 和构建期固定值一致。
 *
 * 存在的理由：上一版发布把「打过补丁但没重签」的 Helper 直接打进 DMG，用户侧启动即
 * SIGKILL（Code Signature Invalid），CUA 永远起不来，而流水线一路绿灯。这个脚本就是缺的那道门。
 *
 * 用法：
 *   node scripts/verify-macos-cua-helper-signing.mjs --dist packages/desktop/dist
 *   node scripts/verify-macos-cua-helper-signing.mjs --helper "/path/ZCode Computer Use.app"
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const HELPER_APP_NAME = "ZCode Computer Use.app";
const HELPER_EXECUTABLE_NAME = "ZCode Computer Use";
const signingMetaPath = resolve(repoRoot, "packages/desktop/bundled-cua-helper/signing.json");

function fail(message) {
  console.error(`[verify-macos-cua-helper-signing] ${message}`);
  process.exit(1);
}

function run(file, args) {
  return execFileSync(file, args, { stdio: "pipe", encoding: "utf8" });
}

function parseArgs(argv) {
  const options = { dist: resolve(repoRoot, "packages/desktop/dist"), helper: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dist") options.dist = resolve(argv[++index]);
    else if (argv[index] === "--helper") options.helper = resolve(argv[++index]);
  }
  return options;
}

function findHelperInDist(distDir) {
  if (!existsSync(distDir)) return null;
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("mac")) continue;
    const appDir = join(distDir, entry.name);
    for (const app of readdirSync(appDir, { withFileTypes: true })) {
      if (!app.isDirectory() || !app.name.endsWith(".app")) continue;
      const candidate = join(appDir, app.name, "Contents", "Resources", "cua-helper", HELPER_APP_NAME);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function readBuildId(plistPath) {
  return run("/usr/libexec/PlistBuddy", ["-c", "Print :ZCodeCUAHelperBuildId", plistPath]).trim();
}

function readCertificateSha256(appPath) {
  const directory = mkdtempSync(join(tmpdir(), "zcode-cua-verify-cert-"));
  try {
    const prefix = join(directory, "cert");
    try {
      run("/usr/bin/codesign", ["-d", "--extract-certificates", prefix, appPath]);
    } catch (error) {
      if (!existsSync(`${prefix}0`)) throw error;
    }
    return createHash("sha256").update(readFileSync(`${prefix}0`)).digest("hex");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  if (process.platform !== "darwin") fail("只在 macOS 上执行");
  const options = parseArgs(process.argv.slice(2));
  const helperAppPath = options.helper ?? findHelperInDist(options.dist);
  if (!helperAppPath || !existsSync(helperAppPath)) {
    fail(`找不到随包 Helper：${helperAppPath ?? options.dist}`);
  }
  if (!existsSync(signingMetaPath)) {
    fail(`缺少 ${signingMetaPath}；构建前必须先执行 scripts/prepare-macos-cua-helper.mjs`);
  }
  const meta = JSON.parse(readFileSync(signingMetaPath, "utf8"));

  try {
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", helperAppPath]);
  } catch (error) {
    fail(
      `Helper 代码签名无效（macOS 会直接 SIGKILL）：${helperAppPath}\n` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        "常见原因：打补丁后没有重签。请重新执行 scripts/prepare-macos-cua-helper.mjs --force",
    );
  }

  const certificateSha256 = readCertificateSha256(helperAppPath);
  if (meta.certificateSha256 && certificateSha256 !== meta.certificateSha256) {
    fail(
      `Helper 签名证书指纹不一致：实际 ${certificateSha256}，构建期固定 ${meta.certificateSha256}`,
    );
  }

  const buildId = readBuildId(join(helperAppPath, "Contents", "Info.plist"));
  if (meta.buildId && buildId !== meta.buildId) {
    fail(`Helper build id 不一致：实际 ${buildId}，构建期固定 ${meta.buildId}`);
  }

  const executable = join(helperAppPath, "Contents", "MacOS", HELPER_EXECUTABLE_NAME);
  if (!existsSync(executable)) fail(`Helper 主可执行缺失：${executable}`);

  console.log(
    `[verify-macos-cua-helper-signing] OK helper=${helperAppPath} buildId=${buildId} certSha256=${certificateSha256}`,
  );
}

main();
