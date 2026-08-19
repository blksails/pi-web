/**
 * Runner 热重载(**仅 dev**)— 监视工具/agent 源码,变更时重启活跃会话的 runner 子进程。
 *
 * 背景:runner 是 per-session 常驻子进程,经 jiti 在进程内**只 import 一次** agent 入口
 * (→ `buildAigcTools()` 等)。改 tool-kit 源码后,已存在会话的 runner 仍跑旧代码,必须开新
 * 会话才生效。本模块给"改完即生效"补上触发点:watch 源码目录 → 防抖 → 让每个已注册的
 * {@link PiRpcProcess} 在**空闲时**重启子进程。新进程 = 全新 jiti = 重读源码(jiti 的 fsCache
 * 按内容 hash 自动重转译);会话 id 经 spawnSpec 复用,新 runner 从持久化 jsonl **续上对话**。
 *
 * 当前产品策略永久关闭。保留模块与导出，避免旧调用方在启动时改变会话生命周期；
 * 任何环境变量（包括 `PI_RUNNER_HOT_RELOAD=1`、`PI_WEB_WATCH=1`）都不能重启 Agent。
 */
import { watch, existsSync, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLogger } from "@blksails/pi-web-logger";

// 命名空间 session:rpc —— 热重载侦测到源码变更、触发 runner 重启的里程碑。
const hotReloadLog = createLogger({ namespace: "session:rpc" });

/** 可热重启的目标(由 PiRpcProcess 实现)。 */
export interface HotReloadTarget {
  /** 空闲时重启子进程;忙(有待决命令)时延迟到空闲。已退出则忽略。 */
  requestRestart(): void;
  /** 当前 custom agent 源目录；仅 dev 热重载使用。 */
  hotReloadPaths?: readonly string[];
}

/** Agent runner 热重载永久关闭，避免长任务期间会话/聊天被重启。 */
export function isHotReloadEnabled(): boolean {
  return false;
}

const DEBOUNCE_MS = 200;

const targets = new Set<HotReloadTarget>();
let watchers: FSWatcher[] | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const targetWatchers = new Map<HotReloadTarget, FSWatcher[]>();
const targetDebounceTimers = new Map<HotReloadTarget, ReturnType<typeof setTimeout>>();

/** 解析要监视的源码目录(默认 packages/tool-kit/src),按**存在性**过滤。
 *
 * ⚠️ 不能只靠 `import.meta.url` 相对定位:Next dev 下本模块被 webpack **打进** route bundle,
 * `import.meta.url` 指向 `.next<dist>/server/app/api/.../route.js`,固定层数上跳算出的目录落在
 * `.next<dist>` 内、**不存在** → `fs.watch` 抛 ENOENT 被静默吞 → watcher 从不激活(形同虚设)。
 * 故:收集多个候选(cwd 相对 + 自 import.meta.url 逐层上跳探 `packages/tool-kit/src`),只留**真实
 * 存在**的目录;兼容 monorepo 源码 / dist / Next bundle / CLI standalone 各布局。 */
export function watchPaths(): string[] {
  const override = process.env["PI_RUNNER_HOT_RELOAD_PATHS"];
  if (override && override.trim() !== "") {
    return override
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  const candidates = new Set<string>();
  // ① cwd 相对:next dev / CLI 通常自仓库根(含 packages/)启动。
  candidates.add(resolve(process.cwd(), "packages", "tool-kit", "src"));
  candidates.add(resolve(process.cwd(), "tool-kit", "src"));
  // ② import.meta.url 相对:逐层上跳,每层探 `tool-kit/src` 与 `packages/tool-kit/src`
  //    (兼容 src/dist 布局深浅不一,及被打进 .next bundle 的深路径)。Windows fileURLToPath 可能抛。
  try {
    let here: string | undefined = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10 && here !== undefined; i += 1) {
      candidates.add(resolve(here, "tool-kit", "src"));
      candidates.add(resolve(here, "packages", "tool-kit", "src"));
      const parent = dirname(here);
      here = parent === here ? undefined : parent; // 到根即止
    }
  } catch {
    // fileURLToPath 抛(Windows 内联路径):仅靠 cwd 候选。
  }
  // 统一分隔符，兼容 Windows 下测试与日志的路径后缀判断；fs.watch 可接受两种形式。
  return [...candidates]
    .filter((p) => existsSync(p))
    .map((p) => p.replaceAll("\\", "/"));
}

function triggerRestartAll(path?: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (targets.size === 0) return;
    hotReloadLog.info("hot-reload triggered", {
      reason: "source-changed",
      ...(path !== undefined ? { path } : {}),
    });
    process.stderr.write(
      `[runner-hot-reload] source changed → restarting ${targets.size} runner(s)\n`,
    );
    for (const t of targets) {
      try {
        t.requestRestart();
      } catch {
        // 单个目标重启失败不影响其它。
      }
    }
  }, DEBOUNCE_MS);
  if (typeof debounceTimer.unref === "function") debounceTimer.unref();
}

function isSourceFile(filename: string | Buffer | null | undefined): boolean {
  if (filename === null || filename === undefined) return true;
  const value = String(filename).replaceAll("\\", "/");
  const parts = value.split("/");
  const basename = parts[parts.length - 1] ?? "";
  // Agent 目录含 node_modules、Vitest/Vite 缓存与临时编译文件；把这些误判为
  // 源码会在测试/构建期间反复重启 runner，最终与旧 stdin 写竞争并触发 EPIPE。
  if (parts.some((part) =>
    part === "node_modules" || part === ".vite" || part === ".iteration" || part === ".pi" || part === "coverage" || part === "test-results")) {
    return false;
  }
  if (/^vitest\.config\.ts\.timestamp-/.test(basename) || basename === "results.json") {
    return false;
  }
  return /\.(ts|tsx|js|mjs|cjs|json)$/.test(basename);
}

function triggerRestartTarget(target: HotReloadTarget, path?: string): void {
  const previous = targetDebounceTimers.get(target);
  if (previous !== undefined) clearTimeout(previous);
  const timer = setTimeout(() => {
    targetDebounceTimers.delete(target);
    if (!targets.has(target)) return;
    hotReloadLog.info("agent hot-reload triggered", {
      reason: "agent-source-changed",
      ...(path !== undefined ? { path } : {}),
    });
    try {
      target.requestRestart();
    } catch {
      // 单个目标重启失败不影响其它会话。
    }
  }, DEBOUNCE_MS);
  targetDebounceTimers.set(target, timer);
  if (typeof timer.unref === "function") timer.unref();
}

function watchTarget(target: HotReloadTarget): void {
  const dirs = target.hotReloadPaths ?? [];
  if (dirs.length === 0) return;
  const targetWatchersForTarget: FSWatcher[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        if (!isSourceFile(filename)) return;
        triggerRestartTarget(target, filename ? String(filename) : undefined);
      });
      w.on("error", () => {});
      if (typeof w.unref === "function") w.unref();
      targetWatchersForTarget.push(w);
      process.stderr.write(`[runner-hot-reload] watching agent ${dir}\n`);
    } catch {
      // 目录消失或当前平台不支持 recursive watch 时跳过。
    }
  }
  targetWatchers.set(target, targetWatchersForTarget);
}

function unwatchTarget(target: HotReloadTarget): void {
  const timer = targetDebounceTimers.get(target);
  if (timer !== undefined) clearTimeout(timer);
  targetDebounceTimers.delete(target);
  for (const watcher of targetWatchers.get(target) ?? []) watcher.close();
  targetWatchers.delete(target);
}

function ensureWatching(): void {
  if (watchers) return;
  watchers = [];
  const dirs = watchPaths();
  if (dirs.length === 0) {
    process.stderr.write(
      "[runner-hot-reload] no tool-kit/src dir found to watch (set PI_RUNNER_HOT_RELOAD_PATHS)\n",
    );
  }
  for (const dir of dirs) {
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        if (!isSourceFile(filename)) return;
        triggerRestartAll(filename ? String(filename) : undefined);
      });
      w.on("error", () => {
        /* 监视器错误(目录消失等):静默,dev-only。 */
      });
      if (typeof w.unref === "function") w.unref();
      watchers.push(w);
      process.stderr.write(`[runner-hot-reload] watching ${dir}\n`);
    } catch {
      // 目录不存在等:跳过该路径。
    }
  }
}

/** 注册接口保留给稳定 ABI；当前永远返回空操作，不建立 watcher。 */
export function registerForHotReload(target: HotReloadTarget): () => void {
  void target;
  return () => {};
}
