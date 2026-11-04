import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Computer Use Helper 的构建身份（build id + 签名证书指纹）。
 *
 * 为什么需要单独一份：Helper 的 `ZCodeCUAHelperBuildId` 与签名证书指纹都是**随包产物的事实**，
 * 只能从实际打包进去的 Helper 读取（prepare-macos-cua-helper.mjs 写入 signing.json），
 * 不能在源码里硬编码。历史上把 build id 写死成占位值，正式包因此永远过不了
 * `verifyCuaHelperBundle` 的强校验，表现成 CUA 一直 `broker_not_accepting`。
 *
 * 优先级：显式环境变量 > signing.json（仅正式构建读取，避免 dev 拿到上一次发版留下的旧值）。
 */
export const CUA_HELPER_SIGNING_META_RELATIVE_PATH =
  "packages/desktop/bundled-cua-helper/signing.json";

const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CERT_SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function readSigningMeta(metaPath) {
  if (!existsSync(metaPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (error) {
    throw new Error(
      `[cua-helper-build-identity] 无法解析 ${metaPath}：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`[cua-helper-build-identity] ${metaPath} 不是对象`);
  }
  return parsed;
}

/**
 * @param {{ repoRoot?: string, env?: NodeJS.ProcessEnv, isProduction?: boolean }} [options]
 * @returns {{ buildId: string, certificateSha256: string, meta: Record<string, unknown> | null }}
 */
export function resolveCuaHelperBuildIdentity(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  // 正式打包的两条链路环境不同：desktop tsup 由 run-production-build 注入 NODE_ENV=production，
  // 而 node-repl-host 的 esbuild 跑在 bundle.mjs 的 buildEnv 下（只保证 ZCODE_TARGET_OS）。
  // 两者都必须读到 signing.json，否则宿主侧的 build id / 证书指纹会退回空串再次 fail-closed。
  const isProduction =
    options.isProduction ?? (env.NODE_ENV === "production" || Boolean(env.ZCODE_TARGET_OS?.trim()));
  const metaPath = resolve(repoRoot, CUA_HELPER_SIGNING_META_RELATIVE_PATH);
  const meta = isProduction ? readSigningMeta(metaPath) : null;

  const buildId =
    env.ZCODE_CUA_HELPER_BUILD_ID?.trim() ||
    (typeof meta?.buildId === "string" ? meta.buildId.trim() : "");
  const certificateSha256 = (
    env.ZCODE_CUA_HELPER_CERT_SHA256?.trim() ||
    (typeof meta?.certificateSha256 === "string" ? meta.certificateSha256.trim() : "")
  ).toLowerCase();

  if (buildId && !BUILD_ID_PATTERN.test(buildId)) {
    throw new Error(
      `[cua-helper-build-identity] build id ${JSON.stringify(buildId)} 不合法：只允许 1-128 位字母、数字、点、下划线或连字符`,
    );
  }
  if (certificateSha256 && !CERT_SHA256_PATTERN.test(certificateSha256)) {
    throw new Error(
      `[cua-helper-build-identity] 证书指纹 ${JSON.stringify(certificateSha256)} 不是 64 位小写十六进制 SHA-256`,
    );
  }

  return { buildId, certificateSha256, meta };
}
