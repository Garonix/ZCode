# syntax=docker/dockerfile:1

# =============================================================
# 阶段 1：构建阶段（编译 Web 前端、Server 后端和 Agent 运行时）
# =============================================================
FROM node:24-bookworm AS builder

ARG PNPM_VERSION=10.33.2
ARG NPM_REGISTRY=""

ENV CI=1 \
    HUSKY=0 \
    PNPM_HOME="/pnpm" \
    PATH="/pnpm:${PATH}"

# 激活指定版本 pnpm 并根据需要配置镜像源
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate && \
    if [ -n "$NPM_REGISTRY" ]; then pnpm config set registry "$NPM_REGISTRY"; fi

WORKDIR /build

# 复制工程源码
COPY . .

# 安装依赖、编译基础模块并打包统一发行包
RUN pnpm install --frozen-lockfile && \
    pnpm exec tsc -b packages/shared packages/rpc packages/services packages/client --force && \
    node scripts/build-zcode.mjs --base-url http://localhost/

# =============================================================
# 阶段 2：运行阶段（轻量化单容器镜像，内置 SQLite 支持）
# =============================================================
FROM node:24-bookworm-slim AS runner

# 安装常用系统命令行工具（供 Agent 编程与基础 CLI 调用）
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从构建阶段提取打包好的 zcode 发行版产物并解压
COPY --from=builder /build/dist/zcode/releases/*/*.tar.gz /tmp/zcode.tar.gz
RUN tar -xzf /tmp/zcode.tar.gz -C / && \
    mv /zcode/* /app/ && \
    rm -rf /zcode /tmp/zcode.tar.gz && \
    ln -sf /app/bin/zcode.mjs /usr/local/bin/zcode

# 复制容器入口脚本
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 创建数据持久化目录和默认工作区
RUN mkdir -p /data /workspace

# 环境变量设置
# - PORT: 容器内服务监听端口（默认 3030）
# - HOST: 监听地址（0.0.0.0 允许宿主机及局域网访问）
# - ZCODE_DATA_BASE_DIR: 数据与 SQLite 数据库持久化根目录（存放于 /data/.zcode）
# - ZCODE_SERVER_WORKSPACE: 默认工作空间目录
ENV PORT=3030 \
    HOST=0.0.0.0 \
    ZCODE_DATA_BASE_DIR=/data \
    ZCODE_SERVER_WORKSPACE=/workspace

# 挂载卷定义：
# - /data: 持久化配置、会话记录及内置 SQLite 数据库（tasks-index.sqlite）
# - /workspace: 工作空间目录（可映射宿主机本地项目代码）
VOLUME ["/data", "/workspace"]

# 暴露服务端口
EXPOSE 3030

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["zcode", "--web"]
