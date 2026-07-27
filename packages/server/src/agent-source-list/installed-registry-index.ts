/**
 * installed-registry-index(spec: desktop-online-source-runnable,任务 1.2)——
 * 已安装线上源的本机索引。
 *
 * ## 职责与边界
 *
 * 扫描 agent 源根下的一级子目录,读取安装回执(`.pi-web-registry.json`),据此回答
 * 「某个 `sourceId` 是否已装在本机、装在哪」。两个消费方:
 *  - 扫描记录归一(任务 2.1):让已装目录认领它的线上身份,消除装后列表重复;
 *  - 线上源解析(任务 3.2):离线复用已装目录,不重复下载。
 *
 * ## 为什么这段代码在 packages/server 而非应用层
 *
 * 回执只是一个 JSON 文件 —— **读它不需要 `@pi-clouds/registry-client`,安装才需要**。
 * 据此把「判别 + 索引」下沉进包内、把「安装」留在应用层,P1 的范围铁律
 * (registry-client 不得进入 `packages/server/src`)无需破例。本文件因此只用 Node 内置模块。
 *
 * ## 降级优先
 *
 * 任何异常(无回执/JSON 损坏/缺必需字段/根不存在/不可读)一律视为「该目录不属于本通道」
 * 并返回 `undefined`,**绝不抛出**:一个坏目录不该拖垮整个源列表(延续 P1 Req 1.3 的
 * fail-soft 精神)。回执字段只取本层真正需要的两项,未知字段一律容忍 —— 这样
 * `cli-package-commands` 侧给回执新增字段不会破坏本特性。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** 安装回执文件名(与 `server/cli/install/registry-install.ts` 的 REGISTRY_RECEIPT_FILENAME 一致)。 */
export const REGISTRY_RECEIPT_FILENAME = ".pi-web-registry.json";

/** 回执中本层关心的字段(其余字段容忍但不解读)。 */
export interface InstalledReceipt {
  readonly sourceId: string;
  readonly channel: string;
  /** 实际安装版本,仅用于诊断;缺失不影响索引可用性。 */
  readonly version?: string;
}

export interface InstalledRegistryEntry {
  readonly dir: string;
  readonly receipt: InstalledReceipt;
}

export interface InstalledRegistryIndex {
  /** 按 sourceId 查已安装目录;不依赖网络与登录态。 */
  lookup(sourceId: string): InstalledRegistryEntry | undefined;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * 读取某目录的安装回执。
 *
 * 不存在 / 不可读 / JSON 损坏 / 缺 `sourceId` 或 `channel` / 字段类型不符 → `undefined`
 * (视为普通本地目录,保持既有语义)。
 */
export function readInstalledReceipt(dir: string): InstalledReceipt | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(dir, REGISTRY_RECEIPT_FILENAME), "utf8");
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

  const obj = parsed as { sourceId?: unknown; channel?: unknown; version?: unknown };
  const sourceId = nonEmptyString(obj.sourceId);
  const channel = nonEmptyString(obj.channel);
  if (sourceId === undefined || channel === undefined) return undefined;

  const version = nonEmptyString(obj.version);
  return version !== undefined ? { sourceId, channel, version } : { sourceId, channel };
}

/**
 * 建立索引:遍历各根的一级子目录,收集带合法回执者。
 *
 * 同一 `sourceId` 在多处命中时**先注册的根优先**,与 `createCompositeSourceProvider` 的
 * 「先见者胜」一致,避免两处对同一逻辑源给出不同答案。
 *
 * 索引在构造时一次性建立(源列表与建会话都是请求级动作,期间目录不会变);调用方每次请求
 * 重新构造即可反映新装的源。
 */
export function createInstalledRegistryIndex(opts: {
  readonly roots: readonly string[];
}): InstalledRegistryIndex {
  const bySourceId = new Map<string, InstalledRegistryEntry>();

  for (const root of opts.roots) {
    let entries: readonly string[];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // 根不存在/不可读 → 空贡献(不抛)。
      continue;
    }

    for (const name of entries) {
      const dir = join(root, name);
      const receipt = readInstalledReceipt(dir);
      if (receipt === undefined) continue;
      // 先见者胜:已存在则不覆盖。
      if (!bySourceId.has(receipt.sourceId)) {
        bySourceId.set(receipt.sourceId, { dir, receipt });
      }
    }
  }

  return {
    lookup(sourceId: string): InstalledRegistryEntry | undefined {
      return bySourceId.get(sourceId);
    },
  };
}
