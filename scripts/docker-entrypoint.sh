#!/usr/bin/env bash
set -e

DATA_DIR="${ZCODE_DATA_BASE_DIR:-/data}"
WORKSPACE_DIR="${ZCODE_SERVER_WORKSPACE:-/workspace}"

# 确保持久化数据与工作区目录存在
mkdir -p "$DATA_DIR" "$WORKSPACE_DIR"

# 如果第一个参数以 '-' 开头，当作 zcode --web 的参数处理
if [ "${1#-}" != "$1" ]; then
  set -- zcode --web "$@"
fi

# 如果没有指定命令，或直接请求默认 web 模式
if [ "$#" -eq 0 ] || [ "$1" = "zcode" -a "$2" = "--web" -a "$#" -eq 2 ]; then
  TOKEN_ARGS=("--no-token")
  if [ -n "$ZCODE_SERVER_AUTH_TOKEN" ]; then
    TOKEN_ARGS=("--token" "$ZCODE_SERVER_AUTH_TOKEN")
  fi

  exec zcode --web \
    --host "${HOST:-0.0.0.0}" \
    --port "${PORT:-3030}" \
    --workspace "$WORKSPACE_DIR" \
    --no-open \
    "${TOKEN_ARGS[@]}"
fi

exec "$@"
