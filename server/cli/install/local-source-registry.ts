/**
 * LocalSourceRegistry — 本地来源登记表的写入(spec cli-package-commands,任务 4.1,
 * Req 9.1–9.5)。
 *
 * 只拥有写入语义(登记/除名);读取与列表呈现归既有的 `RegistrySourceProvider`
 * (`packages/server/src/agent-source-list/registry-provider.ts`),本文件既不修改也不
 * 复用该文件的内部实现,只共享同一份 `sources.json` 文件形态与路径约定
 * (`PI_WEB_SOURCES_REGISTRY`,默认 `<agentDir>/sources.json`,由调用方注入)。
 *
 * 文件形态(与既有 provider 共享,不得偏离):
 *   { "sources": [ { source, name?, title?, description?, avatar? }, ... ], ...未知顶层字段 }
 *
 * 设计裁决(任务报告 DECISIONS 有完整说明,此处摘要):
 *
 * 1. 「有效包目录」判据 —— 复用 `probeEntry`(与既有 `scan-provider`/`resolver` 同一
 *    判据源,经 `@blksails/pi-web-server` 主入口重导出,barrel 注释已确认该函数不含
 *    pi SDK 值导入、可安全经此路径重导出)。目标必须存在且为目录,且 `probeEntry` 不
 *    抛 `EntryOverrideError`(即 `pi-web.json#entry` 声明的入口文件缺失)。**不要求**
 *    `package.json` 存在 —— `scan-provider` 本身对纯 cli 模式的目录(无入口文件、无
 *    `package.json`)一样接纳为可用源;登记表存在的目的是让「日后能被扫描/解析/启动
 *    的目录」出现在源列表里,判据理应与「resolver 是否会接纳它」一致,而非另立
 *    `TemplateCatalog` 那种面向随包分发模板的更严格标准(要求 `package.json` 含
 *    `pi-web` 字段)——那是不同的组件、不同的语义。
 *
 * 2. 未知字段保留 —— 读取时把整份 JSON 解析为 `unknown`,只在 `sources` 数组这一层
 *    做增删;顶层其余键与每个条目内部未识别字段一律原样透传(不经过既有 provider
 *    `parseEntries()` 的白名单裁剪,那是只读呈现层的关注点)。
 *
 * 3. 重复登记判据 —— 以目标目录的 realpath 为准,与既有条目 `source` 字段的
 *    realpath(该条目路径若已不存在则退化为原始字符串比较)做比较;避免同一物理目录
 *    经不同相对路径或符号链接被登记两次。
 *
 * 4. 坏 JSON 的登记表 —— 报错(`REGISTRY_FILE_CORRUPT`)而不是静默覆盖。既有只读
 *    provider 对坏 JSON 静默返回 `[]` 是安全的(只读,无副作用);但本组件是写路径,
 *    覆盖一份当前恰好损坏、但可能是用户或其他工具手写的文件,会造成不可逆的数据
 *    丢失。写路径的安全默认值与只读路径不同,故选择报错、不动文件,让用户自行修复。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { probeEntry, EntryOverrideError } from "@blksails/pi-web-server";

/** 本组件可产出的判别式错误(不抛异常)。 */
export interface LocalSourceRegistryError {
  readonly code:
    | "TARGET_NOT_FOUND"
    | "TARGET_NOT_A_DIRECTORY"
    | "INVALID_PACKAGE_DIRECTORY"
    | "REGISTRY_FILE_CORRUPT";
  readonly message: string;
}

export type LocalSourceRegistryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LocalSourceRegistryError };

export interface RegisterLocalSourceOptions {
  /** 登记表文件绝对路径(`PI_WEB_SOURCES_REGISTRY` 解析结果,由调用方注入)。 */
  readonly registryPath: string;
  /** 待登记的本地目录(绝对或相对路径均可,内部会 realpath 规范化)。 */
  readonly target: string;
}

export interface RegisterLocalSourceResult {
  /** 写入登记表的规范化 source(目标目录 realpath)。 */
  readonly source: string;
  /** true = 本次新增了一条;false = 已存在同一来源,未产生重复条目(幂等)。 */
  readonly created: boolean;
}

export interface UnregisterLocalSourceOptions {
  readonly registryPath: string;
  readonly target: string;
}

export interface UnregisterLocalSourceResult {
  /** true = 移除了一条已存在的条目;false = 本就不存在,无操作。 */
  readonly removed: boolean;
}

/** 未识别形态的登记表条目原样保留其全部字段,只需能读出 `source` 字符串(若有)做匹配。 */
type RawEntry = Record<string, unknown>;

interface RawRegistryFile {
  sources: RawEntry[];
  [key: string]: unknown;
}

/** 校验目标是否为「有效包目录」(9.5)。成功时返回 realpath。 */
async function validateTargetDirectory(
  target: string,
): Promise<LocalSourceRegistryResult<string>> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(target);
  } catch {
    return {
      ok: false,
      error: {
        code: "TARGET_NOT_FOUND",
        message: `Target directory does not exist: ${target}`,
      },
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      error: {
        code: "TARGET_NOT_A_DIRECTORY",
        message: `Target is not a directory: ${target}`,
      },
    };
  }
  const real = await fs.realpath(target);
  try {
    await probeEntry(real);
  } catch (err) {
    if (err instanceof EntryOverrideError) {
      return {
        ok: false,
        error: {
          code: "INVALID_PACKAGE_DIRECTORY",
          message: `Not a valid package directory (pi-web.entry override missing): ${real}`,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "INVALID_PACKAGE_DIRECTORY",
        message: `Not a valid package directory: ${real}`,
      },
    };
  }
  return { ok: true, value: real };
}

/**
 * 尽力规范化一个路径为其 realpath;不存在/不可解析时退化为原始字符串。
 *
 * 导出供 `agent-installer.ts` 的 `isRegisteredLocalSource()`(只读探测,spec
 * cli-package-commands 复核 Finding 2)复用 —— 两处判断「一个路径是否等同于登记表里
 * 某条目」的语义完全一致(realpath ?? raw),此前 `agent-installer.ts` 手写了一份
 * 等价实现(`tryRealpath(x) ?? x`),是会漂移的第二份副本;统一到这一份权威实现。
 */
export async function canonicalize(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

/** 读取登记表文件。文件不存在 → 空壳 `{ sources: [] }`;坏 JSON / 非对象顶层 → 报错。 */
async function readRegistryFile(
  registryPath: string,
): Promise<LocalSourceRegistryResult<RawRegistryFile>> {
  let raw: string;
  try {
    raw = await fs.readFile(registryPath, "utf8");
  } catch {
    return { ok: true, value: { sources: [] } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: {
        code: "REGISTRY_FILE_CORRUPT",
        message: `Registry file is not valid JSON: ${registryPath}`,
      },
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: {
        code: "REGISTRY_FILE_CORRUPT",
        message: `Registry file top level must be a JSON object: ${registryPath}`,
      },
    };
  }
  const obj = parsed as Record<string, unknown>;
  const sourcesRaw = obj["sources"];
  const sources: RawEntry[] = Array.isArray(sourcesRaw)
    ? sourcesRaw.filter(
        (item): item is RawEntry => typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
  return { ok: true, value: { ...obj, sources } };
}

/** 写回登记表文件(含父目录创建)。 */
async function writeRegistryFile(registryPath: string, file: RawRegistryFile): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/** 从条目中取出其 `source` 字符串(非法/缺失则 undefined)。 */
function entrySource(entry: RawEntry): string | undefined {
  const s = entry["source"];
  return typeof s === "string" && s.length > 0 ? s : undefined;
}

/** 登记一个本地目录为 agent 来源(9.2, 9.3, 9.5)。 */
export async function registerLocalSource(
  options: RegisterLocalSourceOptions,
): Promise<LocalSourceRegistryResult<RegisterLocalSourceResult>> {
  const validated = await validateTargetDirectory(options.target);
  if (!validated.ok) return validated;
  const canonicalTarget = validated.value;

  const fileResult = await readRegistryFile(options.registryPath);
  if (!fileResult.ok) return fileResult;
  const file = fileResult.value;

  for (const entry of file.sources) {
    const existingSource = entrySource(entry);
    if (existingSource === undefined) continue;
    const existingCanonical = await canonicalize(existingSource);
    if (existingCanonical === canonicalTarget) {
      // 已登记同一来源:幂等,不产生重复条目、不写文件(Req 9.3 观察态)。
      return { ok: true, value: { source: canonicalTarget, created: false } };
    }
  }

  const nextSources = [...file.sources, { source: canonicalTarget }];
  await writeRegistryFile(options.registryPath, { ...file, sources: nextSources });
  return { ok: true, value: { source: canonicalTarget, created: true } };
}

/** 撤销一个本地目录的登记(9.4)。目标不必存在(允许除名一个已被删除的目录)。 */
export async function unregisterLocalSource(
  options: UnregisterLocalSourceOptions,
): Promise<LocalSourceRegistryResult<UnregisterLocalSourceResult>> {
  const canonicalTarget = await canonicalize(options.target);

  const fileResult = await readRegistryFile(options.registryPath);
  if (!fileResult.ok) return fileResult;
  const file = fileResult.value;

  const nextSources: RawEntry[] = [];
  let removed = false;
  for (const entry of file.sources) {
    const existingSource = entrySource(entry);
    if (existingSource !== undefined) {
      const existingCanonical = await canonicalize(existingSource);
      if (existingCanonical === canonicalTarget) {
        removed = true;
        continue;
      }
    }
    nextSources.push(entry);
  }

  if (!removed) {
    // 除名不存在的条目为无操作(Req: 幂等),不写文件。
    return { ok: true, value: { removed: false } };
  }

  await writeRegistryFile(options.registryPath, { ...file, sources: nextSources });
  return { ok: true, value: { removed: true } };
}
