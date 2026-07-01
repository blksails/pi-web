/**
 * ScanSourceProvider — 扫描根目录一级子目录发现本地 agent source(Req 2.1–2.5, 6.2)。
 *
 * - 枚举每个根的一级子目录;复用 agent-source 的 `probeEntry` 判定 custom(entry)/cli(none)。
 * - realpath 门控:候选目录 realpath 后必须仍落在 `realpath(root)+sep` 之内,否则(符号链接
 *   逃逸等)剔除。root 不存在/无法解析→跳过该 root;非目录条目忽略。
 * - 只读:无写、无 spawn、无 network。id/source = 候选目录 realpath 绝对路径。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { probeEntry } from "../agent-source/index.js";
import type {
  AgentSourceProvider,
  AgentSourceRecord,
  ScanProviderOptions,
} from "./types.js";

/** 读取子目录 package.json 的 name(失败静默返回 undefined)。 */
interface PkgMeta {
  name?: string;
  title?: string;
  description?: string;
  avatar?: string;
}

/** 取字符串字段(非空才取)。 */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * 读子目录 package.json 的展示元数据(失败静默返回 {})。展示信息优先取 `pi-web` 字段
 * (与 `pi-web.entry` 同处),回退到 package.json 顶层 name/description:
 * - title  = pi-web.title
 * - name   = package.json name(技术名/兜底)
 * - description = pi-web.description ?? package.json description
 * - avatar = pi-web.avatar
 */
async function readPkgMeta(dir: string): Promise<PkgMeta> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const rec = parsed as {
      name?: unknown;
      description?: unknown;
      ["pi-web"]?: unknown;
    };
    const piweb =
      typeof rec["pi-web"] === "object" && rec["pi-web"] !== null
        ? (rec["pi-web"] as {
            title?: unknown;
            description?: unknown;
            avatar?: unknown;
          })
        : {};
    const out: PkgMeta = {};
    const name = str(rec.name);
    if (name !== undefined) out.name = name;
    const title = str(piweb.title);
    if (title !== undefined) out.title = title;
    const description = str(piweb.description) ?? str(rec.description);
    if (description !== undefined) out.description = description;
    const avatar = str(piweb.avatar);
    if (avatar !== undefined) out.avatar = avatar;
    return out;
  } catch {
    return {};
  }
}

/** 某候选路径 realpath 后是否仍落在根之内(含根自身)。 */
function isWithin(rootReal: string, candReal: string): boolean {
  return candReal === rootReal || candReal.startsWith(rootReal + path.sep);
}

/** 有界并发 map:最多 `limit` 个任务在飞,避免大目录一次性打开过多 fd(Req 6.3)。 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item);
    }
  };
  const size = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}

const SCAN_CONCURRENCY = 8;

async function scanRoot(root: string): Promise<AgentSourceRecord[]> {
  let rootReal: string;
  try {
    rootReal = await fs.realpath(root);
  } catch {
    return []; // root 不存在/不可解析 → 跳过
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootReal, { withFileTypes: true });
  } catch {
    return [];
  }

  // 符号链接可能指向目录:isDirectory() 对 symlink 为 false,故不能只靠 dirent 类型。
  // 统一用 realpath + stat 判定,既解决 symlink 也顺带完成越界门控。有界并发(Req 6.3)。
  const probed = await mapWithConcurrency(
    entries,
    SCAN_CONCURRENCY,
    async (ent): Promise<AgentSourceRecord | undefined> => {
      const cand = path.join(rootReal, ent.name);
      let candReal: string;
      try {
        candReal = await fs.realpath(cand);
      } catch {
        return undefined;
      }
      if (!isWithin(rootReal, candReal)) return undefined; // 逃逸根 → 剔除(Req 2.5/6.2)

      let isDir = false;
      try {
        isDir = (await fs.stat(candReal)).isDirectory();
      } catch {
        return undefined;
      }
      if (!isDir) return undefined;

      let mode: "custom" | "cli";
      try {
        const probe = await probeEntry(candReal);
        mode = probe.kind === "entry" ? "custom" : "cli";
      } catch {
        // EntryOverrideError 等:该目录声明了不存在的入口 → 不是可用源,排除。
        return undefined;
      }

      const meta = await readPkgMeta(candReal);
      return {
        id: candReal,
        source: candReal,
        name: meta.name ?? path.basename(candReal),
        kind: "dir",
        origin: "scan",
        mode,
        ...(meta.title !== undefined ? { title: meta.title } : {}),
        ...(meta.description !== undefined
          ? { description: meta.description }
          : {}),
        ...(meta.avatar !== undefined ? { avatar: meta.avatar } : {}),
      };
    },
  );
  return probed.filter((r): r is AgentSourceRecord => r !== undefined);
}

export function createScanSourceProvider(
  opts: ScanProviderOptions,
): AgentSourceProvider {
  return {
    async list(): Promise<AgentSourceRecord[]> {
      const perRoot = await Promise.all(opts.roots.map((r) => scanRoot(r)));
      return perRoot.flat();
    },
  };
}
