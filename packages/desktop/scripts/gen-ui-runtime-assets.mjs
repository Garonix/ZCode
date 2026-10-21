import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const source = new URL(
  "../../../apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/",
  import.meta.url,
);

/** Inline 和导出共用实际资源文件，避免维护另一份有细节差异的运行时。 */
export async function copyGenUiRuntimeAssets(destination) {
  const manifest = JSON.parse(await readFile(new URL("vendor/manifest.json", source), "utf8"));
  const vendorFiles = new Map();
  for (const resource of manifest.resources) {
    vendorFiles.set(resource.file, resource.sha256);
    vendorFiles.set(resource.licenseFile, resource.licenseSha256);
  }
  // 离线运行依赖完整的固定快照；构建时发现缺失或漂移，不能把失败留到用户首次打开。
  const verifiedBuffers = new Map();
  await Promise.all(
    [...vendorFiles].map(async ([file, expectedHash]) => {
      if (!/^[a-zA-Z0-9.-]+$/.test(file)) throw new Error(`Invalid Gen UI vendor file: ${file}`);
      const rawBytes = await readFile(new URL(`vendor/${file}`, source));
      let hash = createHash("sha256").update(rawBytes).digest("hex");
      let finalBytes = rawBytes;
      if (hash !== expectedHash) {
        // 兼容处理 Windows 下 git 默认 autocrlf=true 将换行符转为 \r\n 导致的哈希校验偏差
        const normalized = Buffer.from(rawBytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
        if (createHash("sha256").update(normalized).digest("hex") === expectedHash) {
          hash = expectedHash;
          finalBytes = normalized;
        }
      }
      if (hash !== expectedHash)
        throw new Error(`Gen UI vendor hash mismatch: ${file}`);
      verifiedBuffers.set(`vendor/${file}`, finalBytes);
    }),
  );
  await mkdir(destination, { recursive: true });
  await mkdir(join(destination, "vendor"), { recursive: true });
  await Promise.all([
    ...[
      "visualize.css",
      "visualize.html",
      "calendar.js",
      "vendor/manifest.json",
    ].map((file) => copyFile(new URL(file, source), join(destination, file))),
    ...[...verifiedBuffers.entries()].map(([relativePath, bytes]) =>
      writeFile(join(destination, relativePath), bytes),
    ),
  ]);
}
