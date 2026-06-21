/**
 * completion-provider-framework — 内置 file provider(trigger `@`, kind `file`)。
 *
 * complete:枚举会话 cwd 下文件(尊重 .gitignore、跳过重目录、遍历上限、TTL 缓存),
 *          按查询模糊匹配排序、限量,返回 `@file:<相对路径>` 候选。
 * resolve(v1):`@file:<rel>` → `@<rel>`(不读文件内容);经 realpath 断言路径在 cwd 内,
 *          越界(`../`/symlink 逃逸/不存在)→ 返回 null(保留原文本)。
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { CompletionItem } from "@pi-web/protocol";
import type {
  CompletionCtx,
  CompletionProvider,
  CompletionRef,
  ResolvedContext,
} from "../types.js";
import { serializeToken } from "../token.js";

export const FILE_PROVIDER_ID = "file";
export const FILE_KIND = "file";

/** 始终跳过的重目录(无论 .gitignore 是否声明)。 */
const ALWAYS_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".next-e2e",
  ".next-stub",
  "dist",
  "coverage",
  ".turbo",
]);

const DEFAULT_WALK_CAP = 20000;
const DEFAULT_RESULT_LIMIT = 20;
const DEFAULT_CACHE_TTL_MS = 5000;

export interface FileProviderOptions {
  readonly walkCap?: number;
  readonly resultLimit?: number;
  readonly cacheTtlMs?: number;
  readonly priority?: number;
  /** 注入时钟(测试用);默认 Date.now。 */
  readonly now?: () => number;
}

interface CacheEntry {
  readonly expires: number;
  readonly files: readonly string[];
  readonly truncated: boolean;
}

/** 轻量 .gitignore 匹配器:支持注释/空行、目录名、`*.ext` 后缀、根锚定 `/x`。近似实现。 */
function makeIgnoreMatcher(lines: readonly string[]): (rel: string) => boolean {
  const dirNames = new Set<string>();
  const exts = new Set<string>();
  const rootAnchored = new Set<string>();
  const plain = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    let pat = line;
    const anchored = pat.startsWith("/");
    if (anchored) pat = pat.slice(1);
    const isDir = pat.endsWith("/");
    if (isDir) pat = pat.slice(0, -1);
    if (pat.startsWith("*.")) {
      exts.add(pat.slice(1)); // ".ext"
    } else if (anchored) {
      rootAnchored.add(pat);
    } else if (isDir) {
      dirNames.add(pat);
    } else {
      plain.add(pat);
    }
  }
  return (rel: string): boolean => {
    const segs = rel.split("/");
    for (const ext of exts) if (rel.endsWith(ext)) return true;
    for (const seg of segs) {
      if (dirNames.has(seg)) return true;
      if (plain.has(seg)) return true;
    }
    if (rootAnchored.has(rel)) return true;
    if (rootAnchored.has(segs[0] as string)) return true;
    return false;
  };
}

async function loadGitignore(cwd: string): Promise<(rel: string) => boolean> {
  try {
    const content = await fs.readFile(path.join(cwd, ".gitignore"), "utf8");
    return makeIgnoreMatcher(content.split(/\r?\n/));
  } catch {
    return () => false;
  }
}

/** 遍历 cwd 收集相对 posix 路径(跳过重目录/被忽略项/符号链接;上限截断)。 */
async function walkFiles(
  cwd: string,
  cap: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const ignore = await loadGitignore(cwd);
  const files: string[] = [];
  let truncated = false;
  const stack: string[] = [""]; // 相对目录(posix)
  while (stack.length > 0) {
    const relDir = stack.pop() as string;
    const absDir = relDir === "" ? cwd : path.join(cwd, relDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue; // 不跟随,挡 symlink 逃逸
      const rel = relDir === "" ? ent.name : `${relDir}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(ent.name)) continue;
        if (ignore(rel)) continue;
        stack.push(rel);
      } else if (ent.isFile()) {
        if (ignore(rel)) continue;
        if (files.length >= cap) {
          truncated = true;
          return { files, truncated };
        }
        files.push(rel);
      }
    }
  }
  return { files, truncated };
}

/** 子序列模糊匹配 + 评分(basename 命中加权)。无 query 返回基础分。 */
function fuzzyScore(rel: string, q: string): number | null {
  if (q === "") return 1;
  const hay = rel.toLowerCase();
  const needle = q.toLowerCase();
  // 子序列检测
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  if (i < needle.length) return null;
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
  let score = 1;
  if (base.includes(needle)) score += 3;
  if (base.startsWith(needle)) score += 3;
  if (hay.includes(needle)) score += 2;
  // 路径越短略加分(更"近")
  score += Math.max(0, 2 - rel.split("/").length * 0.1);
  return score;
}

/** 创建内置 file provider。 */
export function createFileProvider(
  opts: FileProviderOptions = {},
): CompletionProvider {
  const walkCap = opts.walkCap ?? DEFAULT_WALK_CAP;
  const resultLimit = opts.resultLimit ?? DEFAULT_RESULT_LIMIT;
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  async function listing(cwd: string): Promise<CacheEntry> {
    const hit = cache.get(cwd);
    if (hit !== undefined && hit.expires > now()) return hit;
    const { files, truncated } = await walkFiles(cwd, walkCap);
    const entry: CacheEntry = { expires: now() + ttl, files, truncated };
    cache.set(cwd, entry);
    return entry;
  }

  return {
    id: FILE_PROVIDER_ID,
    trigger: "@",
    kind: FILE_KIND,
    extract: "wordTail",
    priority: opts.priority ?? 0,

    async complete({ query, ctx }): Promise<readonly CompletionItem[]> {
      const { files, truncated } = await listing(ctx.cwd);
      const scored: Array<{ rel: string; score: number }> = [];
      for (const rel of files) {
        const s = fuzzyScore(rel, query);
        if (s !== null) scored.push({ rel, score: s });
      }
      scored.sort((a, b) =>
        b.score !== a.score ? b.score - a.score : a.rel.localeCompare(b.rel),
      );
      const top = scored.slice(0, resultLimit);
      const items: CompletionItem[] = top.map(({ rel, score }) => ({
        providerId: FILE_PROVIDER_ID,
        kind: FILE_KIND,
        id: rel,
        label: rel,
        insertText: serializeToken({ trigger: "@", kind: FILE_KIND, id: rel }),
        score,
      }));
      if (truncated && items.length > 0) {
        items.push({
          providerId: FILE_PROVIDER_ID,
          kind: FILE_KIND,
          id: "__truncated__",
          label: "…(结果已截断,请细化查询)",
          detail: "file listing truncated",
          insertText: "",
          score: -1,
        });
      }
      return items;
    },

    async resolve(
      ref: CompletionRef,
      ctx: CompletionCtx,
    ): Promise<ResolvedContext | null> {
      const rel = ref.id;
      // realpath 安全:目标必须落在 cwd realpath 前缀内。
      let cwdReal: string;
      let targetReal: string;
      try {
        cwdReal = await fs.realpath(ctx.cwd);
        targetReal = await fs.realpath(path.resolve(ctx.cwd, rel));
      } catch {
        return null; // 不存在 / 无法解析 → 拒绝
      }
      const prefix = cwdReal.endsWith(path.sep) ? cwdReal : cwdReal + path.sep;
      if (targetReal !== cwdReal && !targetReal.startsWith(prefix)) {
        return null; // 逃逸出 cwd → 拒绝
      }
      // v1:不读内容,规约为 LLM 友好的 `@<rel>`。
      return { text: `@${rel}` };
    },
  };
}
