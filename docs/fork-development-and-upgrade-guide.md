# ZCode 魔改开发与上游升级范式指南
> **Core Principles: Upstream-First Baseline & Compounding Engineering**

本指南确立了在深度定制 ZCode 项目时，**如何持续引入新功能并无痛跟进官方版本**的标准化工程范式。

---

## 一、 核心哲学：第一性原理与复利最优

### 1. 为什么“反向合并官方（Reverse Merge）”是灾难？
* **基准不对称性（99% vs 1%）**：
  官方仓库是内部自洽的完整系统（占 99% 代码）。如果把官方主线代码合并到你的定制分支，Git 的 3-way merge 会试图将数以万计的代码变更去适配你历史累积的上下文，往往造成数千个文件被意外改写或污染。
* **因果归因模糊**：
  反向合并后出现报错，你无法判断是官方改动引入的、合并冲突解错的、本地缓存污染的，还是你原本的逻辑失效。排查复杂度从 $O(1)$ 骤升至 $O(N)$。

### 2. 纯净基线与补丁化（Upstream-First Baseline）
* **因果隔离**：
  永远以官方纯净 Release Tag 为底座。如果底座通过检查，在打上你的 1% 改动后出现问题，**原因必定且唯一来自于该改动的接触面**，排查成本降为常量。
* **正复利沉淀**：
  把定制功能抽象为自包含的“原子补丁（Atomic Commits）”。官方版本演进时，你的补丁只需重新在基线上“重放（Cherry-pick）”，实现长期的低成本演进与功能复利。

---

## 二、 架构规范：新功能编写原则

### 1. “新增代码全独立，官方代码只留孔”
* **严禁入侵**：不要在官方既有组件或长函数内部散落式插入多处 `if-else`。
* **外挂化封装**：
  * **前端 UI**：新建独立的组件、对话框或 Hook，存放在对应业务目录下。
  * **后端/服务**：在 `packages/services/src/` 中定义独立 Service、工具模块或下沉运行时。
* **单点挂载（Single Point of Injection）**：
  官方源码中只允许做 1~2 行的挂载调用（例如渲染一个包装组件、注册一条 RPC channel 或调用一个 hook）。
  * *收益*：哪怕官方内部重构该文件，你只需要在新文件的挂载点补上一行，极速恢复。

### 2. 优雅降级与环境守卫
* **多端运行安全**：
  服务与工具类代码如果可能在浏览器或 Web 环境执行，必须添加环境守卫：
  ```ts
  const pid = options?.pid ?? (typeof process !== "undefined" ? process.pid : undefined);
  ```
* **硬件/特性降级**：
  遇到特定环境下不可用的浏览器 API（如局域网 HTTP 下 `crypto.subtle` 缺失），采用纯 TS 标准实现无缝回退（参考 `packages/shared/src/pureSha256.ts`）。

---

## 三、 Git 规范：原子化提交与分支拓扑

### 1. 分支模型
* **基座分支**：直接基于官方 Release Tag 切出，如 `feat/v3.15.1-custom`。
* **保持线性历史**：禁止在定制分支中执行 `git merge`。所有定制 Commit 形成线性的链条。

### 2. 一功能一提交（Atomic Commits）
* 每一个独立的定制特性，最终在 Git 历史中**只保留 1 个语义自包含的 Commit**。
* 开发过程中的零散调试修改，在验证通过后使用 `git commit --amend` 或交互式 rebase 进行 Squash。
* **提交信息格式规范**：
  * `feat(scope): 简要描述`
  * `fix(scope): 简要描述`
  * `refactor(scope): 简要描述`
  * 正文中清晰列出变更的核心点与设计考量。

---

## 四、 新功能开发全流程（标准四步闭环）

```
[基于当前定制分支]
       │
1. 编写独立功能文件 + 最小挂载点
       │
2. 运行本地“守门三件套”验证 (100% 通过)
       │
3. 补充单元测试 (Vitest)
       │
4. 固化为 1 个原子 Commit
```

### 步骤 1：编写独立功能与挂载
1. 新建独立功能文件（如 `MyNewFeatureDialog.tsx`）。
2. 在官方入口处做最少行数的挂载（如引入组件、绑定按钮事件）。

### 步骤 2：执行本地守门三件套（必须全部 Exit 0）
在提交前，严格依次运行以下三项检查：
```bash
# 1. 架构合规检查（禁止违反单向依赖与模块边界）
pnpm architecture:check

# 2. 代码 Lint 检查
pnpm lint

# 3. 全量类型系统检查（ZCode 为大型 Monorepo，必须配置 4GB 内存防 OOM）
NODE_OPTIONS="--max-old-space-size=4096" pnpm typecheck
```

### 步骤 3：编写针对性单元测试
为新增的核心算法、状态或适配逻辑添加单元测试（统一使用 `vitest`）：
```bash
npx vitest run packages/<package-name>/test/<your-test>.test.ts
```

### 步骤 4：固化原子提交
```bash
git add packages/...
git commit -m "feat(module): 你的功能描述"
```

---

## 五、 升级 SOP：未来如何跟进官方大版本

当官方发布了新的 Release 版本（例如 `v3.16.0` 对应 Tag 为 `v3.16.0`）：

### 阶段 1：准备纯净新基线
```bash
# 1. 拉取官方最新 Tag
git fetch upstream --tags

# 2. 从官方目标 Tag 创建新的干净工作分支
git checkout -b feat/v3.16.0-custom v3.16.0
```

### 阶段 2：预检官方基线健康度
```bash
# 检查官方基线是否有漏掉的 baseline 或测试文件
pnpm architecture:check
NODE_OPTIONS="--max-old-space-size=4096" pnpm typecheck
```
*注：若官方自身有规则遗漏（如漏写 contract.test.ts），在此处单独立一个 Commit 修复，确保基底全绿。*

### 阶段 3：按次序重放你的定制 Commit 链
查询你上一版本累积的所有原子 Commit（按拓扑顺序从旧到新）：
```bash
# 将你所有的魔改 Commit 一键重放到新分支上
git cherry-pick <first-custom-commit-hash>^..<last-custom-commit-hash>
```

### 阶段 4：冲突收敛与验收
* 因为每个功能都是外挂化、新文件为主的，冲突只可能发生在**少数几个挂载点（如 Sidebar、Root、Vite 配置等）**。
* 依次解决挂载点的小冲突后 `git cherry-pick --continue`。
* 重新跑一遍“守门三件套”，确认全绿后，升级即告完成！

---

## 六、 避坑与故障排查清单（FAQ）

### Q1: `pnpm typecheck` 报错 `JavaScript heap out of memory` (Exit Code 134)
* **原因**：Monorepo 内含 14 个包，全量 `tsc -b` 内存消耗超出了 Node 默认的 2GB 上限。
* **解决**：运行命令前附加内存环境变量：
  ```bash
  NODE_OPTIONS="--max-old-space-size=4096" pnpm typecheck
  ```

### Q2: 官方新拉下的纯净代码，跑 `pnpm architecture:check` 直接报错
* **原因**：官方主线在快速迭代中可能新增了某个子模块但遗漏了 contract 测试文件（如 v3.15.1 遗漏了 `packages/services/src/gen-ui/contract.test.ts`）。
* **解决**：在模块目录下补上一个最小的 `contract.test.ts` 验证导出频道名称，即可合法通过架构门禁，无需破坏 `.architecture-baseline.json`。

### Q3: 局域网 Web 模式下上传附件或图片崩溃
* **原因**：非 HTTPS 的内网 HTTP 环境被浏览器视为非安全上下文，`globalThis.crypto?.subtle` 会被浏览器强制置空。
* **解决**：引入纯 TS 实现的标准 SHA-256 降级方案：
  ```ts
  import { sha256HexAsync } from "@zcode/shared";
  const hex = await sha256HexAsync(bytes);
  ```
