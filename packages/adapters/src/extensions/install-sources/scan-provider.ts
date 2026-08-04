/**
 * ScanInstallSourceProvider — 可安装来源枚举端口的**本地实现**
 * (spec agent-plugin-commands,任务 1.2;整体迁自 `routes/install-sources.ts`)。
 *
 * 按解析基准目录浅层扫描"可作为 `local:` 安装源"的目录(含 index.ts/index.js/package.json/.pi
 * 任一标志文件),返回相对路径候选。realpath 归一 + 越界防护:仅返回 realpath 仍位于基准目录
 * 内的目录,不泄露基准之外的路径。
 *
 * 行为(标志文件集合、深度与条数上限、噪声目录跳过、越界防护)与迁移前逐条一致 —— 这是
 * 本次迁移的验收条件,勿"顺手优化"。
 */
import { promises as fs } from "node:fs";
import { PI_WEB_MANIFEST_FILENAME } from "@blksails/pi-web-protocol";
import * as path from "node:path";
import type {
  InstallSourceProvider,
  InstallSourceQuery,
  InstallSourceRecord,
} from "./types.js";

/** 安装候选目录的默认判定标志文件。 */
const DEFAULT_MARKERS = ["index.ts", "index.js", "package.json", ".pi"] as const;
/** 安装候选的 insertText 前缀(`local:<rel>` 是安装命令认识的来源语法)。 */
const DEFAULT_INSERT_PREFIX = "local:";
/** 扫描深度(相对基准目录的最大层数)与候选上限。 */
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_ITEMS = 30;
/** 跳过的噪声目录。 */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
]);

export interface ScanInstallSourceOptions {
  /** 扫描深度上限;缺省 2。仅测试需要覆盖。 */
  readonly maxDepth?: number;
  /** 候选条数上限;缺省 30。仅测试需要覆盖。 */
  readonly maxItems?: number;
  /**
   * 候选目录的判定标志文件;缺省 `["index.ts","index.js","package.json",".pi"]`。
   * publish 用的是「含发布清单」这条**不同**的判据(spec publish-host-command,任务 3.1)——
   * 直接沿用安装那套会把不可发布的目录也列成候选。
   */
  readonly markers?: readonly string[];
  /**
   * `insertText` 前缀;缺省 `"local:"`(安装命令认识的来源语法)。
   * publish 接受的是**目录路径本身**,故传 `""`。
   */
  readonly insertPrefix?: string;
}

async function hasMarker(dir: string, markers: readonly string[]): Promise<boolean> {
  for (const m of markers) {
    try {
      await fs.access(path.join(dir, m));
      return true;
    } catch {
      // 不存在,试下一个标志。
    }
  }
  return false;
}

/** 本地文件系统实现:基准目录不存在/不可 realpath → 返回 []。 */
export function createScanInstallSourceProvider(
  opts: ScanInstallSourceOptions = {},
): InstallSourceProvider {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
  const markers = opts.markers ?? DEFAULT_MARKERS;
  const insertPrefix = opts.insertPrefix ?? DEFAULT_INSERT_PREFIX;

  return {
    async list(query: InstallSourceQuery): Promise<readonly InstallSourceRecord[]> {
      let cwdReal: string;
      try {
        cwdReal = await fs.realpath(query.cwd);
      } catch {
        return [];
      }
      const q = query.query.toLowerCase();
      const out: InstallSourceRecord[] = [];

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > maxDepth || out.length >= maxItems) return;
        let entries: import("node:fs").Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (out.length >= maxItems) return;
          if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) {
            continue;
          }
          const abs = path.join(dir, e.name);
          // 越界防护:realpath 必须仍在基准目录内。
          let real: string;
          try {
            real = await fs.realpath(abs);
          } catch {
            continue;
          }
          if (real !== cwdReal && !real.startsWith(cwdReal + path.sep)) continue;

          const rel = path.relative(cwdReal, real);
          if (await hasMarker(abs, markers)) {
            const relNorm = `./${rel.split(path.sep).join("/")}`;
            if (q.length === 0 || relNorm.toLowerCase().includes(q)) {
              out.push({ path: relNorm, insertText: `${insertPrefix}${relNorm}` });
            }
          }
          await walk(abs, depth + 1);
        }
      }

      await walk(cwdReal, 1);
      return out.slice(0, maxItems);
    },
  };
}

/**
 * publish 候选目录枚举(spec publish-host-command,任务 3.1)。
 *
 * 与安装候选只差两点:判据是**含发布清单**(而非入口/包描述文件),`insertText` 是
 * **目录路径本身**(publish 接受目录,不是 `local:` 来源语法)。故复用同一份扫描实现,
 * 不新写第二套 —— 越界防护、深度/条数上限、噪声目录跳过因此天然一致。
 *
 * 端口类型仍是 `InstallSourceProvider`:它本质是「按基准目录枚举候选目录」,与用途无关,
 * 改名会波及三处装配与既有测试而无实际收益。
 */
export function createScanPublishSourceProvider(
  opts: Omit<ScanInstallSourceOptions, "markers" | "insertPrefix"> = {},
): InstallSourceProvider {
  return createScanInstallSourceProvider({
    ...opts,
    markers: [PI_WEB_MANIFEST_FILENAME],
    insertPrefix: "",
  });
}
