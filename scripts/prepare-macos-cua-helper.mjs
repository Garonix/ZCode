#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const desktopPackageRoot = resolve(repoRoot, "packages", "desktop");
const CDN_BASE = process.env.ZCODE_CUA_CDN_BASE || "https://cdn-zcode.z.ai/zcode/electron/releases";

export async function prepareMacosCuaHelper({
  arch = process.env.TARGET_ARCH || process.arch,
  version,
} = {}) {
  const normalizedArch = arch === "x86_64" ? "x64" : arch;
  const targetDir = resolve(desktopPackageRoot, "bundled-cua-helper", normalizedArch);
  const helperAppPath = join(targetDir, "ZCode Computer Use.app");

  if (existsSync(helperAppPath)) {
    console.log(`[prepare-macos-cua-helper] helper already present at ${helperAppPath}`);
    return;
  }

  const pkgJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const targetVersion = version || pkgJson.version || "3.16.2";

  console.log(`[prepare-macos-cua-helper] preparing macOS CUA helper for ${targetVersion} (${normalizedArch})...`);

  const candidateVersions = [targetVersion];
  if (targetVersion !== "3.14.3") candidateVersions.push("3.14.3");

  const tmpRoot = join(tmpdir(), `zcode-cua-download-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  const zipPath = join(tmpRoot, "download.zip");

  let downloaded = false;
  for (const ver of candidateVersions) {
    const zipUrl = `${CDN_BASE}/${ver}/macos-${normalizedArch}/ZCode-${ver}-mac-${normalizedArch}.zip`;
    console.log(`[prepare-macos-cua-helper] attempting download from ${zipUrl}...`);
    try {
      execFileSync("curl", ["-fSL", "--retry", "2", "-o", zipPath, zipUrl], { stdio: "inherit" });
      downloaded = true;
      break;
    } catch {
      console.warn(`[prepare-macos-cua-helper] failed to fetch from ${zipUrl}, trying next candidate...`);
    }
  }

  if (!downloaded) {
    throw new Error(`[prepare-macos-cua-helper] unable to download macOS CUA helper from CDN for ${normalizedArch}`);
  }

  try {

    const extractDir = join(tmpRoot, "extracted");
    mkdirSync(extractDir, { recursive: true });

    console.log("[prepare-macos-cua-helper] unzipping helper...");
    execFileSync(
      "unzip",
      ["-q", zipPath, "ZCode.app/Contents/Resources/cua-helper/*", "-d", extractDir],
      { stdio: "inherit" },
    );

    const sourceHelper = join(
      extractDir,
      "ZCode.app",
      "Contents",
      "Resources",
      "cua-helper",
      "ZCode Computer Use.app",
    );
    if (!existsSync(sourceHelper)) {
      throw new Error(`[prepare-macos-cua-helper] helper not found in extracted zip: ${sourceHelper}`);
    }

    mkdirSync(targetDir, { recursive: true });
    rmSync(helperAppPath, { recursive: true, force: true });

    // Use cp -R or ditto
    execFileSync("cp", ["-R", sourceHelper, helperAppPath], { stdio: "inherit" });

    // Patch helper local dev flag if on macOS or python3 is available
    try {
      const helperBin = join(helperAppPath, "Contents", "MacOS", "ZCode Computer Use");
      if (existsSync(helperBin)) {
        execFileSync(
          "python3",
          [
            "-c",
            `
import sys
path = sys.argv[1]
data = open(path, "rb").read()
old = b"var allowUnsignedLauncherLocalDev = false;"
new = b"var allowUnsignedLauncherLocalDev = true; "
if old in data:
    open(path, "wb").write(data.replace(old, new, 1))
    print("[prepare-macos-cua-helper] patched allowUnsignedLauncherLocalDev -> true")
`,
            helperBin,
          ],
          { stdio: "inherit" },
        );
      }
    } catch {
      // Non-fatal if python3 patch fails
    }

    console.log(`[prepare-macos-cua-helper] successfully staged helper to ${helperAppPath}`);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archArg = process.argv[2] || process.env.TARGET_ARCH || process.arch;
  prepareMacosCuaHelper({ arch: archArg }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
