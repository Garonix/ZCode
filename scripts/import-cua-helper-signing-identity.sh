#!/usr/bin/env bash
# 把 Computer Use Helper 的自签名身份导入临时 keychain，供 codesign 使用。
#
# CI 用法（release.yml 的 macOS job）：
#   ZCODE_CUA_HELPER_SIGNING_CERT_P12_BASE64 / _PASSWORD / _IDENTITY 由 Secrets 提供，
#   本脚本创建 build.keychain-db 并把身份名写入 $GITHUB_ENV。
# 本机用法：
#   bash scripts/import-cua-helper-signing-identity.sh <p12 路径> <密码>
set -euo pipefail

P12_PATH="${1:-}"
P12_PASSWORD="${2:-${ZCODE_CUA_HELPER_SIGNING_CERT_PASSWORD:-}}"
KEYCHAIN_PASSWORD="${ZCODE_CUA_HELPER_KEYCHAIN_PASSWORD:-zcode-cua-helper-keychain}"
KEYCHAIN_PATH="$HOME/Library/Keychains/zcode-cua-helper.keychain-db"

if [ -z "$P12_PATH" ] || [ ! -f "$P12_PATH" ]; then
  echo "[import-cua-helper-signing-identity] 用法：$0 <p12 路径> <密码>" >&2
  exit 1
fi
if [ -z "$P12_PASSWORD" ]; then
  echo "[import-cua-helper-signing-identity] 缺少 p12 密码" >&2
  exit 1
fi

# CI 会把 p12 以 base64 放进环境变量，这里统一落成临时文件，避免命令行泄露私钥内容。
if [ -n "${ZCODE_CUA_HELPER_SIGNING_CERT_P12_BASE64:-}" ]; then
  P12_PATH="$(mktemp -t zcode-cua-helper-p12).p12"
  printf '%s' "$ZCODE_CUA_HELPER_SIGNING_CERT_P12_BASE64" | base64 --decode > "$P12_PATH"
fi

echo "[import-cua-helper-signing-identity] 创建 keychain：$KEYCHAIN_PATH"
security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "[import-cua-helper-signing-identity] 导入 p12"
security import "$P12_PATH" -k "$KEYCHAIN_PATH" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
# 无头环境下 codesign 读取私钥需要 partition list，否则会静默失败或被钥匙串拦下。
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

EXISTING_KEYCHAINS="$(security list-keychains -d user | tr -d '"' | tr '\n' ' ')"
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN_PATH" $EXISTING_KEYCHAINS

IDENTITY="${ZCODE_CUA_HELPER_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | sed -n 's/.*"\(.*\)"/\1/p' | head -n 1)"
fi
if [ -z "$IDENTITY" ]; then
  echo "[import-cua-helper-signing-identity] keychain 里没有可用的代码签名身份" >&2
  security find-identity -v -p codesigning "$KEYCHAIN_PATH" >&2 || true
  exit 1
fi

echo "[import-cua-helper-signing-identity] 可用身份：$IDENTITY"
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "ZCODE_CUA_HELPER_SIGNING_IDENTITY=$IDENTITY"
    echo "ZCODE_CUA_HELPER_KEYCHAIN_PATH=$KEYCHAIN_PATH"
  } >> "$GITHUB_ENV"
else
  echo "export ZCODE_CUA_HELPER_SIGNING_IDENTITY=\"$IDENTITY\""
  echo "export ZCODE_CUA_HELPER_KEYCHAIN_PATH=\"$KEYCHAIN_PATH\""
fi
