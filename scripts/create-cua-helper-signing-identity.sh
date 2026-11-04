#!/usr/bin/env bash
# 生成 Computer Use Helper 的自签名代码签名身份（一次性操作）。
#
# 为什么需要它：本仓库没有 Apple Developer ID，随包 macOS Helper 必须先打补丁
# （放行未签名 launcher）再重签，否则系统会因签名失效直接 SIGKILL。重签所用的证书
# 指纹会被折叠进应用，宿主只信任「指纹一致」的 Helper（证书 pinning）。
#
# 用法：
#   bash scripts/create-cua-helper-signing-identity.sh [输出目录]
#
# 产物（输出目录内，勿提交）：
#   cua-helper-signing.p12      导入 CI / 本机 keychain 的证书+私钥
#   cua-helper-signing.p12.b64  GitHub Secret ZCODE_CUA_HELPER_SIGNING_CERT_P12 的值
#   cua-helper-signing.cn       GitHub Secret ZCODE_CUA_HELPER_SIGNING_IDENTITY 的值
#   cua-helper-signing.sha256   证书 SHA-256 指纹（与构建期写入 signing.json 的一致）
set -euo pipefail

OUT_DIR="${1:-$PWD/cua-helper-signing}"
CN="ZCode Computer Use Self-Signed"
P12_PASSWORD="${ZCODE_CUA_HELPER_SIGNING_CERT_PASSWORD:-zcode-cua-helper}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "[create-cua-helper-signing-identity] 缺少 openssl" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "[create-cua-helper-signing-identity] 生成 10 年期自签名代码签名证书：$CN"
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout cua-helper-signing.key \
  -out cua-helper-signing.crt \
  -subj "/CN=$CN/O=ZCode/C=US" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

# macOS 的 SecKeychainItemImport 不认 OpenSSL 3 默认的 PBES2/AES-256 p12，
# 会以 "MAC verification failed during PKCS12 import" 报错。显式退回 SHA1 + 3DES 的老算法。
openssl pkcs12 -export \
  -inkey cua-helper-signing.key \
  -in cua-helper-signing.crt \
  -name "$CN" \
  -keypbe PBE-SHA1-3DES \
  -certpbe PBE-SHA1-3DES \
  -macalg sha1 \
  -passout "pass:$P12_PASSWORD" \
  -out cua-helper-signing.p12

base64 < cua-helper-signing.p12 | tr -d '\n' > cua-helper-signing.p12.b64
printf '%s' "$CN" > cua-helper-signing.cn
openssl x509 -in cua-helper-signing.crt -noout -fingerprint -sha256 \
  | sed 's/^.*=//' | tr -d ':' | tr 'A-F' 'a-f' > cua-helper-signing.sha256

cat <<EOF

完成。请把以下内容配置到 GitHub Secrets（Settings → Secrets and variables → Actions）：

  ZCODE_CUA_HELPER_SIGNING_CERT_P12       = $(cat cua-helper-signing.p12.b64)
  ZCODE_CUA_HELPER_SIGNING_CERT_PASSWORD  = $P12_PASSWORD
  ZCODE_CUA_HELPER_SIGNING_IDENTITY       = $CN

证书 SHA-256 指纹：$(cat cua-helper-signing.sha256)
（构建脚本会把它写进 packages/desktop/bundled-cua-helper/signing.json，并由应用固定校验）

私钥仅存在于 $OUT_DIR，请勿提交仓库；配置完 Secret 后可删除本地文件。

本机调试可直接导入：
  bash scripts/import-cua-helper-signing-identity.sh "$OUT_DIR/cua-helper-signing.p12" "$P12_PASSWORD"
EOF
