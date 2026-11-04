# Computer Use 真实运行时集成与全平台构建规范

状态：设计与实现中（2026-10-28）
适用范围：`packages/zcode-cua`、`packages/desktop`、`.github/workflows/release.yml`

## 1. Feature Summary / Impact Brief

| 字段 | 内容 |
| --- | --- |
| 开发者意图 | 替换 `@zcode/zcode-cua` 占位包为真实 Producer 运行时，打通 PiP 视窗与 Agent 电脑控制能力，放宽画面防伪签名限制，适配全平台（Windows/macOS/Linux）GitHub Actions 编译打包 |
| 核心能力 | Computer Use tool-call 执行、Broker Wire IPC 通信、PiP 画中画会话、Windows/macOS Helper 随包打包 |
| 变更分层 | `packages/zcode-cua`（Producer 运行时与 Helper 资产）、`packages/desktop`（打包与 Helper 准备）、`.github/workflows`（CI 打包流水线） |
| 破坏性变更 | 移除 `packages/zcode-cua` 占位包标记；`isRealComputerUseProducerInstalled` 判定由 false 变为 true |

## 2. 状态所有者与接口契约

### 2.1 状态与归属所有者

| 状态/事实 | 权威 Owner | 读写边界 |
| --- | --- | --- |
| CUA Producer 真实性 | `packages/zcode-cua/package.json`（无 `zcodeCuaPlaceholder: true`） | `packages/desktop/scripts/computer-use-producer.mjs` 读取 |
| Broker Socket | 宿主环境 `ZCODE_CUA_PERMISSION_BROKER_SOCKET` | `broker.js` / `broker-server.js` 创建与分发，`node-repl-host` 消费 |
| PiP 画中画事件流 | `@zcode/zcode-cua/pip-session` 与 `pip-session/node` | Desktop `cuaPipFocusRouter.ts` / Services `cuaPipSessionService.ts` 消费 |
| 画面帧与防伪契约 | `@zcode/zcode-cua/frame-contract` | 放宽校验，`preserveOfficialCuaFrameResult` 纯 Pass-through，不拦截未签名帧 |

### 2.2 跨平台 Helper 资源组织

1. **Windows**：
   - 源码路径：`packages/zcode-cua/dist/windows-helper.js` + `packages/zcode-cua/build/Release/ax_native.node`
   - 清单声明：`packages/zcode-cua/package.json` 中的 `zcodeCuaRuntime`：
     ```json
     "zcodeCuaRuntime": {
       "schema": 1,
       "windows": {
         "entry": "dist/windows-helper.js",
         "nativeAddon": "build/Release/ax_native.node"
       }
     }
     ```
   - 打包映射：`packages/desktop/scripts/prepare-windows-cua-helper.mjs` 准备至 `bundled-tools/win32-x64/cua-helper`，由 `electron-builder` 打入 `tools/cua-helper`。
2. **macOS**：
   - 资源路径：`packages/desktop/bundled-cua-helper/${targetArch}/ZCode Computer Use.app`
   - 提取策略：CI 与本地构建脚本 `scripts/prepare-macos-cua-helper.mjs` 按当前版本号从官方 CDN 解包提取（`ditto`）至 `bundled-cua-helper`；不再提供低版本兜底，取不到目标版本即失败。
   - **签名与信任模型（2026-11-04 起）**：官方 Helper 的 launcher 校验要求 Z.ai 的 Apple Team，本仓库没有 Apple Developer ID，只能打开 Helper 内编译期的 `allowUnsignedLauncherLocalDev` 逃逸；而对已公证的 Mach-O 做任何原地改写都会让 `codesign` 失效、被内核 SIGKILL。因此固定流程是：解包 → 打补丁 → **用固定的自签名证书重签** → `codesign --verify --deep --strict` 自检 → 写出 `bundled-cua-helper/signing.json`（`buildId` + 证书 SHA-256）。
   - 构建期把 `signing.json` 折叠为 `__ZCODE_CUA_HELPER_BUILD_ID__` / `__ZCODE_CUA_HELPER_CERT_SHA256__`；运行时 `verifyCuaHelperBundle()` 走「指纹固定」模式（`pinned_self_signed`）：要求签名自洽且叶子证书指纹与构建期一致，不再要求 Apple TeamIdentifier，也不做公证（spctl）评估。禁止在源码里硬编码 build id 或证书指纹。
   - 流水线门禁：`scripts/verify-macos-cua-helper-signing.mjs` 在打包后复核随包 Helper 的签名、证书指纹与 build id；没有签名身份时 macOS 包不携带 Helper（CUA 明确不可用），不得把签名无效的产物打进安装包。
3. **Linux**：
   - 保持兼容：运行时加载标准 Producer 逻辑，不打包原生 Windows/macOS Helper，fail-open 或回退至通用截屏。

## 3. 防伪签名放宽说明（Frame Integrity Bypass）

官方闭源设计在 `frame-contract` 中要求模型消费截屏帧时必须携带 producer 签发的完整性元数据（`image_ref pairing`、HMAC 签名、sha256 摘要）。
在开源/自主编译构建中：
- `preserveOfficialCuaFrameResult`: 保持透传，无论帧是否带官方签名，均不阻断。
- `attestOfficialCuaFrameContent`: 安全通过类型比对，允许普通 MCP 截屏直接投递给模型。

## 4. 验收标准

1. `pnpm typecheck`：全仓类型检查通过，包含 `packages/zcode-cua` 与 `packages/desktop`。
2. `pnpm architecture:check --changed`：架构分层合规，0 违规。
3. `packages/desktop/scripts/computer-use-producer.mjs`：判定 `isRealComputerUseProducerInstalled` 为 `true`。
4. Windows 资产准备：在配置了 `zcodeCuaRuntime` 的前提下，`windows-cua-helper-assets.mjs` 能成功通过规范校验。
5. GitHub Actions `release.yml`：集成 macOS Helper 准备步骤，多平台编译矩阵配置无缝对接。
