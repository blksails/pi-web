/**
 * Runner 热重载(**仅 dev**)— 监视工具/agent 源码,变更时重启活跃会话的 runner 子进程。
 *
 * 背景:runner 是 per-session 常驻子进程,经 jiti 在进程内**只 import 一次** agent 入口
 * (→ `buildAigcTools()` 等)。改 tool-kit 源码后,已存在会话的 runner 仍跑旧代码,必须开新
 * 会话才生效。本模块给"改完即生效"补上触发点:watch 源码目录 → 防抖 → 让每个已注册的
 * {@link PiRpcProcess} 在**空闲时**重启子进程。新进程 = 全新 jiti = 重读源码(jiti 的 fsCache
 * 按内容 hash 自动重转译);会话 id 经 spawnSpec 复用,新 runner 从持久化 jsonl **续上对话**。
 *
 * 默认关闭。开启:`NODE_ENV !== production` 且 `PI_RUNNER_HOT_RELOAD=1`。
 * 监视目录默认 `packages/tool-kit/src`,可经 `PI_RUNNER_HOT_RELOAD_PATHS`(逗号分隔绝对路径)覆盖。
 */
import { watch, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** 可热重启的目标(由 PiRpcProcess 实现)。 */
export interface HotReloadTarget {
  /** 空闲时重启子进程;忙(有待决命令)时延迟到空闲。已退出则忽略。 */
  requestRestart(): void;
}

/** dev + 显式开关 才启用。 */
export function isHotReloadEnabled(): boolean {
  // CLI `pi-web --watch` 经 PI_WEB_WATCH 显式启用:不受 dev 门控限制,在 production
  // standalone 下也生效(仅当用户主动 --watch,不改默认行为)。见 spec pi-web-cli Req 8。
  if (process.env["PI_WEB_WATCH"] === "1") return true;
  return (
    process.env["NODE_ENV"] !== "production" &&
    process.env["PI_RUNNER_HOT_RELOAD"] === "1"
  );
}

const DEBOUNCE_MS = 200;

const targets = new Set<HotReloadTarget>();
let watchers: FSWatcher[] | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 解析要监视的源码目录(默认 packages/tool-kit/src)。 */
function watchPaths(): string[] {
  const override = process.env["PI_RUNNER_HOT_RELOAD_PATHS"];
  if (override && override.trim() !== "") {
    return override
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  // 本文件:packages/server/src/rpc-channel/hot-reload.ts → 仓库 packages/ 目录。
  // standalone bundle 里 import.meta.url 被内联成构建机路径,Windows 上 fileURLToPath 抛
  // ERR_INVALID_FILE_URL_PATH;失败则回退运行时 cwd 下的 packages。
  let packagesDir: string;
  try {
    packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  } catch {
    packagesDir = resolve(process.cwd(), "packages");
  }
  return [resolve(packagesDir, "tool-kit", "src")];
}

function triggerRestartAll(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (targets.size === 0) return;
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

function ensureWatching(): void {
  if (watchers) return;
  watchers = [];
  for (const dir of watchPaths()) {
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        // 只关心源码文件(忽略编辑器临时文件 / 非 ts/js)。
        if (filename && !/\.(ts|tsx|js|mjs|cjs|json)$/.test(String(filename))) {
          return;
        }
        triggerRestartAll();
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

/** 注册一个可热重启目标(仅在启用时实际生效);返回注销函数。 */
export function registerForHotReload(target: HotReloadTarget): () => void {
  if (!isHotReloadEnabled()) return () => {};
  ensureWatching();
  targets.add(target);
  return () => {
    targets.delete(target);
  };
}
