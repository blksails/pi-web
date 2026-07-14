/**
 * peer-check — peer 基线校验(spec cli-component-add,任务 2.4,Req 4.1, 4.2, 4.4)。
 *
 * 版本探测 = 自目标 source 目录逐级向上找 `node_modules/<pkg>/package.json` 读
 * `version`(research §3-3):monorepo 下命中根 node_modules 的 workspace 链接,
 * 恰是「目标 source 实际可解析到的版本」语义。不实现 node resolution 全集
 * (exports/自引用等)——版本探测只需 package.json。
 *
 * 一次遍历**聚合全部**不满足项(Req 4.2:包名、要求范围、实际版本或未找到,一次看全)。
 * 范围写法不支持(Req 4.4)是独立错误码 `peer_range_unsupported`——那是清单作者的问题,
 * 与目标环境不满足(`peer_unsatisfied`)分开呈现。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseRange, satisfies } from "./semver-lite.js";

export type PeerIssue = {
  readonly pkg: string;
  readonly required: string;
  /** 实际解析到的版本;null = 未找到。 */
  readonly actual: string | null;
};

export type PeerCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "peer_unsatisfied" | "peer_range_unsupported";
      readonly issues: readonly PeerIssue[];
    };

export interface PeerCheckDeps {
  /** 读文件文本;失败返回 null。测试注入。 */
  readonly readText?: (file: string) => string | null;
  readonly exists?: (p: string) => boolean;
}

function defaultReadText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** 自 fromDir 逐级向上解析 pkg 的已安装版本;未找到返回 null。 */
export function resolvePeerVersion(pkg: string, fromDir: string, deps: PeerCheckDeps = {}): string | null {
  const exists = deps.exists ?? existsSync;
  const readText = deps.readText ?? defaultReadText;
  let dir = path.resolve(fromDir);
  for (;;) {
    const pkgJson = path.join(dir, "node_modules", ...pkg.split("/"), "package.json");
    if (exists(pkgJson)) {
      const text = readText(pkgJson);
      if (text !== null) {
        try {
          const parsed = JSON.parse(text) as { version?: unknown };
          if (typeof parsed.version === "string") return parsed.version;
        } catch {
          // 坏 package.json:继续向上找(不视为命中)。
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 校验全部 peer 声明。范围写法不支持优先于环境不满足呈现(作者错先于环境错)。 */
export function checkPeers(
  peer: Readonly<Record<string, string>>,
  targetDir: string,
  deps: PeerCheckDeps = {},
): PeerCheckResult {
  const rangeIssues: PeerIssue[] = [];
  const unsatisfied: PeerIssue[] = [];

  for (const [pkg, required] of Object.entries(peer)) {
    const range = parseRange(required);
    if ("error" in range) {
      rangeIssues.push({ pkg, required, actual: null });
      continue;
    }
    const actual = resolvePeerVersion(pkg, targetDir, deps);
    if (actual === null || !satisfies(actual, range)) {
      unsatisfied.push({ pkg, required, actual });
    }
  }

  if (rangeIssues.length > 0) return { ok: false, code: "peer_range_unsupported", issues: rangeIssues };
  if (unsatisfied.length > 0) return { ok: false, code: "peer_unsatisfied", issues: unsatisfied };
  return { ok: true };
}
