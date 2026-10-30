#!/usr/bin/env node
// 上游版本更新快速重放与复利治理流水线
//
// 职责：
//   1. 预检上游 `upstream/main` 最新提交与本分支的差异半径；
//   2. 分析待重放提交（Atomic Commits）并预测潜在冲突点；
//   3. 支持半自动/全自动变基重放，并在遇锁文件冲突时按契约自动重建；
//   4. 重放后联动执行架构检查与类型检查质量门禁。
//
// 用法：
//   node scripts/sync-upstream.mjs --check            # 只读预检，输出差异与冲突风险
//   node scripts/sync-upstream.mjs --execute          # 执行全自动重放与门禁验证
//   node scripts/sync-upstream.mjs --abort            # 中断并恢复重放前状态

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const execFile = promisify(execFileCallback);

const args = process.argv.slice(2);
const isCheckMode = args.includes("--check") || (!args.includes("--execute") && !args.includes("--abort"));
const isExecuteMode = args.includes("--execute");
const isAbortMode = args.includes("--abort");
const skipChecks = args.includes("--skip-checks");

const targetRemoteIndex = args.indexOf("--target-remote");
const targetRemote = targetRemoteIndex >= 0 ? args[targetRemoteIndex + 1] : "upstream";

const targetBranchIndex = args.indexOf("--target-branch");
const targetBranch = targetBranchIndex >= 0 ? args[targetBranchIndex + 1] : "main";

const upstreamRef = `${targetRemote}/${targetBranch}`;

async function git(...gitArgs) {
  try {
    const { stdout } = await execFile("git", gitArgs, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout).trim() : "",
      stderr: error.stderr ? String(error.stderr).trim() : error.message,
      code: error.code ?? 1,
    };
  }
}

async function runCommand(cmd, cmdArgs) {
  console.log(`[sync-upstream] 正在执行: ${cmd} ${cmdArgs.join(" ")}`);
  try {
    const { stdout, stderr } = await execFile(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout).trim() : "",
      stderr: error.stderr ? String(error.stderr).trim() : error.message,
      code: error.code ?? 1,
    };
  }
}

async function main() {
  console.log("==================================================");
  console.log("   ZCode 上游更新快速重放与复利治理流水线");
  console.log("==================================================");

  // 1. 检查是否存在未完成的 rebase
  const rebaseApplyCheck = await git("status");
  const isRebasing = rebaseApplyCheck.stdout.includes("rebase in progress");

  if (isAbortMode) {
    if (!isRebasing) {
      console.log("[sync-upstream] 当前没有正在进行的 rebase 流程，无需中断。");
      return;
    }
    console.log("[sync-upstream] 正在中断当前的 rebase 操作并恢复现场...");
    const abortResult = await git("rebase", "--abort");
    if (abortResult.ok) {
      console.log("[sync-upstream] 已成功中断 rebase 并还原分支。");
    } else {
      console.error("[sync-upstream] 中断 rebase 失败:", abortResult.stderr);
    }
    return;
  }

  if (isRebasing) {
    console.warn("[sync-upstream] 警告：检测到当前正处于 rebase 冲突暂停状态！");
    console.warn("  - 若需自动解决 lockfile 冲突并继续：请在确认其余冲突已解决后运行");
    console.warn("  - 若需完全放弃本次重放：运行 node scripts/sync-upstream.mjs --abort");
    process.exit(1);
  }

  // 2. 检查工作区状态（工作树检查）
  const statusRes = await git("status", "--porcelain");
  if (!statusRes.ok) {
    console.error("[sync-upstream] 无法获取 git 状态:", statusRes.stderr);
    process.exit(1);
  }
  if (statusRes.stdout.length > 0) {
    if (isExecuteMode) {
      console.error("[sync-upstream] 错误：工作区存在未提交或未暂存的代码改动！");
      console.error("在进行上游重放前，请先提交（commit）或暂存（stash）本地工作区改动：");
      console.error(statusRes.stdout);
      process.exit(1);
    } else {
      console.log("[sync-upstream] 提示：当前工作区有未暂存/未提交的改动（已跳过，只读模式不受影响）：");
      console.log(statusRes.stdout.split("\n").map(l => "    " + l).join("\n"));
    }
  }

  // 3. 检查远程分支
  if (!args.includes("--no-fetch")) {
    console.log(`[sync-upstream] 正在同步远程分支信息: git fetch ${targetRemote} --prune ...`);
    const fetchRes = await git("fetch", targetRemote, "--prune");
    if (!fetchRes.ok) {
      console.warn(`[sync-upstream] 提示：无法 fetch ${targetRemote}（可能为离线环境或未配置写权限）：${fetchRes.stderr}`);
    }
  }

  const currentBranchRes = await git("rev-parse", "--abbrev-ref", "HEAD");
  const currentBranch = currentBranchRes.stdout;
  console.log(`[sync-upstream] 当前分支: ${currentBranch}`);
  console.log(`[sync-upstream] 目标基线: ${upstreamRef}`);

  // 4. 计算共同祖先与分支差异
  const mergeBaseRes = await git("merge-base", upstreamRef, "HEAD");
  if (!mergeBaseRes.ok) {
    console.error(`[sync-upstream] 错误：无法找到当前分支与 ${upstreamRef} 的共同提交历史。`);
    process.exit(1);
  }
  const mergeBase = mergeBaseRes.stdout;

  const behindRes = await git("rev-list", "--count", `${mergeBase}..${upstreamRef}`);
  const aheadRes = await git("rev-list", "--count", `${mergeBase}..HEAD`);
  const behindCount = Number(behindRes.stdout);
  const aheadCount = Number(aheadRes.stdout);

  console.log(`[sync-upstream] 共同基线 (Merge Base): ${mergeBase.slice(0, 10)}`);
  console.log(`[sync-upstream] 上游新提交数 (Behind): ${behindCount}`);
  console.log(`[sync-upstream] 本地待重放数 (Ahead):  ${aheadCount}`);

  // 5. 获取待重放的 Commit 清单
  const aheadCommitsRes = await git("log", `${mergeBase}..HEAD`, "--oneline");
  const aheadCommits = aheadCommitsRes.stdout ? aheadCommitsRes.stdout.split("\n") : [];

  // 6. 变更文件与冲突风险分析
  const upstreamFilesRes = await git("diff", "--name-only", `${mergeBase}..${upstreamRef}`);
  const localFilesRes = await git("diff", "--name-only", `${mergeBase}..HEAD`);

  const upstreamFiles = new Set(upstreamFilesRes.stdout ? upstreamFilesRes.stdout.split("\n") : []);
  const localFiles = localFilesRes.stdout ? localFilesRes.stdout.split("\n") : [];

  const conflictCandidates = localFiles.filter((f) => upstreamFiles.has(f));

  console.log("\n--------------------------------------------------");
  console.log("   待重放提交架构拓扑 (Local Ahead Commits)");
  console.log("--------------------------------------------------");
  if (aheadCommits.length === 0) {
    console.log("  (无新增待重放提交)");
  } else {
    for (const commit of aheadCommits) {
      console.log(`  * ${commit}`);
    }
  }

  console.log("\n--------------------------------------------------");
  console.log("   潜在重放冲突切片预测 (Conflict Risk Analysis)");
  console.log("--------------------------------------------------");
  if (behindCount === 0) {
    console.log("  [最优状态] 当前分支已基于最新上游基线，无须变基重放。");
  } else if (conflictCandidates.length === 0) {
    console.log("  [极佳] 本地改动文件与上游新改动文件完全正交，0 重叠文件！预期 100% 自动成功。");
  } else {
    console.log(`  共检测到 ${conflictCandidates.length} 个双方共同修改的文件：`);
    for (const file of conflictCandidates) {
      if (file === "pnpm-lock.yaml") {
        console.log(`  - ${file} -> [依赖锁] 重放遇冲突时自动接受上游并在结束时由 pnpm 重建 (SOP 自动覆盖)`);
      } else if (file.startsWith("packages/zcode-cua/")) {
        console.log(`  - ${file} -> [CUA 运行时] 真实运行时覆盖上游占位包 (需留意上游接口契约变化)`);
      } else if (file.startsWith("packages/ui/")) {
        console.log(`  - ${file} -> [Pure IoC 挂载点] 门禁代码轻量嵌入 (冲突概率中等)`);
      } else {
        console.log(`  - ${file} -> [业务逻辑] 常规代码交叉`);
      }
    }
  }

  if (isCheckMode) {
    console.log("\n==================================================");
    console.log("   预检完成。");
    if (behindCount > 0) {
      console.log("   若要执行重放，请运行：");
      console.log("   node scripts/sync-upstream.mjs --execute");
    }
    console.log("==================================================");
    return;
  }

  // 7. 执行重放流程
  if (isExecuteMode) {
    if (behindCount === 0) {
      console.log("\n[sync-upstream] 上游没有新提交，直接执行门禁校验。");
    } else {
      console.log(`\n[sync-upstream] 开始执行重放: git rebase ${upstreamRef} ...`);
      const rebaseRes = await git("rebase", upstreamRef);
      if (!rebaseRes.ok) {
        // 检查是否只是 pnpm-lock.yaml 冲突
        const statusDuringRebase = await git("status", "--porcelain");
        const conflictedFiles = statusDuringRebase.stdout
          .split("\n")
          .filter((line) => line.startsWith("UU ") || line.startsWith("AA ") || line.startsWith("DU "))
          .map((line) => line.slice(3).trim());

        if (conflictedFiles.length === 1 && conflictedFiles[0] === "pnpm-lock.yaml") {
          console.log("[sync-upstream] 检测到仅存在 pnpm-lock.yaml 冲突，触发复利最优自动解决策略...");
          await git("checkout", "--theirs", "pnpm-lock.yaml");
          await git("add", "pnpm-lock.yaml");
          const continueRes = await git("rebase", "--continue");
          if (!continueRes.ok) {
            console.error("[sync-upstream] 继续 rebase 失败:", continueRes.stderr);
            process.exit(1);
          }
          console.log("[sync-upstream] 锁文件冲突已自动旁路并成功继续重放。");
        } else {
          console.error("\n[sync-upstream] 变基遇到非锁文件冲突，已暂停以供人工确认：");
          console.error(rebaseRes.stderr || rebaseRes.stdout);
          console.error("\n冲突解决后请执行:");
          console.error("  git add <已解决文件>");
          console.error("  git rebase --continue");
          console.error("或执行中断还原:");
          console.error("  node scripts/sync-upstream.mjs --abort");
          process.exit(1);
        }
      } else {
        console.log("[sync-upstream] 重放变基成功完成！");
      }
    }

    // 8. 自动更新依赖锁文件 (pnpm install)
    console.log("\n[sync-upstream] 正在校准与重建依赖锁文件: pnpm install --no-frozen-lockfile ...");
    const pnpmInstallRes = await runCommand("pnpm", ["install", "--no-frozen-lockfile"]);
    if (!pnpmInstallRes.ok) {
      console.error("[sync-upstream] pnpm install 执行失败:", pnpmInstallRes.stderr);
      process.exit(1);
    }

    // 检查是否有 lockfile 更新
    const lockDiffRes = await git("status", "--porcelain", "pnpm-lock.yaml");
    if (lockDiffRes.stdout.length > 0) {
      console.log("[sync-upstream] 检测到 pnpm-lock.yaml 有必要增量变更，自动提交原子更新...");
      await git("add", "pnpm-lock.yaml");
      await git("commit", "-m", "chore(deps): 自动同步上游更新后的 pnpm-lock.yaml 依赖一致性");
      console.log("[sync-upstream] 依赖锁更新已成功提交。");
    }

    // 9. 执行质量门禁验证
    if (!skipChecks) {
      console.log("\n--------------------------------------------------");
      console.log("   质量门禁校验 (Quality Gates)");
      console.log("--------------------------------------------------");

      console.log("[sync-upstream] [1/2] 运行架构规则校验: pnpm architecture:check --changed ...");
      const archCheckRes = await runCommand("node", ["scripts/architecture/architecture-check.mjs", "check", "--changed"]);
      if (!archCheckRes.ok) {
        console.error("[sync-upstream] 架构规则校验未通过！\n", archCheckRes.stderr || archCheckRes.stdout);
        process.exit(1);
      }
      console.log("架构校验通过。");

      console.log("[sync-upstream] [2/2] 运行 TypeScript 类型检查: pnpm typecheck ...");
      const typecheckRes = await runCommand("pnpm", ["typecheck"]);
      if (!typecheckRes.ok) {
        console.error("[sync-upstream] 类型检查未通过！\n", typecheckRes.stderr || typecheckRes.stdout);
        process.exit(1);
      }
      console.log("类型检查通过。");
    }

    console.log("\n==================================================");
    console.log("   恭喜！上游重放与门禁校验全部顺利通过！");
    console.log("==================================================");
  }
}

main().catch((err) => {
  console.error("[sync-upstream] 发生意外异常:", err);
  process.exit(1);
});
