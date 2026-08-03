/**
 * 入口探测与优先级(Req 3.1–3.5)。
 *
 * - `package.json#pi-web.entry` 覆盖优先;覆盖文件不存在 → EntryOverrideError(不静默回退)。
 * - 否则按 `index.ts` > `index.js` > `index.mjs` 取首个存在者。
 * - 命中返回绝对路径;均无 → { kind: "none" }。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { EntryOverrideError } from "./errors.js";
import type { EntryProbe } from "./types.js";

/**
 * 约定入口的优先级序列。**导出**是刻意的:发布期(`server/cli/publish`)需要在
 * 「探测不到入口」的错误提示里列出候选文件名,若各自维护一份字面量,两处会漂移。
 * 判定逻辑本身仍只有 `probeEntry` 一处实现。
 */
export const ENTRY_PRIORITY = ["index.ts", "index.js", "index.mjs"] as const;

async function isFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

interface PiWebManifest {
  ["pi-web"]?: { entry?: unknown };
}

async function readEntryOverride(dir: string): Promise<string | undefined> {
  const pkgPath = path.join(dir, "package.json");
  let raw: string;
  try {
    raw = await fs.readFile(pkgPath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const entry = (parsed as PiWebManifest)["pi-web"]?.entry;
  return typeof entry === "string" && entry.length > 0 ? entry : undefined;
}

/**
 * 在目标目录探测入口。
 * @param dir 已解析为本地目录的目标目录(绝对路径)。
 */
export async function probeEntry(dir: string): Promise<EntryProbe> {
  const override = await readEntryOverride(dir);
  if (override !== undefined) {
    const abs = path.isAbsolute(override) ? override : path.resolve(dir, override);
    if (!(await isFile(abs))) {
      throw new EntryOverrideError(abs);
    }
    return { kind: "entry", path: abs };
  }

  for (const name of ENTRY_PRIORITY) {
    const abs = path.join(dir, name);
    if (await isFile(abs)) {
      return { kind: "entry", path: abs };
    }
  }
  return { kind: "none" };
}
