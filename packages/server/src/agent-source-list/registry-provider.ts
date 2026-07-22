/**
 * RegistrySourceProvider — 读一个 JSON 清单显式登记的源(Req 3.1–3.4)。
 *
 * manifest 形态: { "sources": [ { source, name?, description? }, ... ] }
 *
 * - 文件不存在 → 返回 [](Req 3.2);JSON 解析失败 → [](Req 3.3)。
 * - 逐条校验:非对象/缺 source 的条目跳过,其余保留(Req 3.3)。
 * - kind 由 `identify(source)` 派生;git 条目标 kind=git 且**不 clone/不 resolve**(Req 3.4)。
 * - 只读:仅读文件,无写、无 spawn、无 network。
 */
import path from "node:path";
import { identify } from "../agent-source/index.js";
import { createLocalWorkspaceNamespace } from "../workspace/index.js";
import type {
  AgentSourceProvider,
  AgentSourceRecord,
  RegistryProviderOptions,
} from "./types.js";

interface RawEntry {
  source: string;
  name?: string;
  title?: string;
  description?: string;
  avatar?: string;
}

/** 从原始 JSON 中提取合法登记项(坏条目静默跳过)。 */
function parseEntries(parsed: unknown): RawEntry[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const sources = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];
  const out: RawEntry[] = [];
  for (const item of sources) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as {
      source?: unknown;
      name?: unknown;
      title?: unknown;
      description?: unknown;
      avatar?: unknown;
    };
    if (typeof rec.source !== "string" || rec.source.length === 0) continue;
    const s = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 ? v : undefined;
    const entry: RawEntry = { source: rec.source };
    const name = s(rec.name);
    if (name !== undefined) entry.name = name;
    const title = s(rec.title);
    if (title !== undefined) entry.title = title;
    const description = s(rec.description);
    if (description !== undefined) entry.description = description;
    const avatar = s(rec.avatar);
    if (avatar !== undefined) entry.avatar = avatar;
    out.push(entry);
  }
  return out;
}

/** 从 source 字符串派生 (id, kind, 默认名)。枚举阶段绝不 clone/resolve。 */
function deriveMeta(source: string): {
  id: string;
  kind: "dir" | "git";
  fallbackName: string;
} {
  let identified: ReturnType<typeof identify>;
  try {
    identified = identify(source);
  } catch {
    // 无法识别(既非本地路径也非 git URL):按目录处理,id 用原串。
    return { id: source, kind: "dir", fallbackName: path.basename(source) };
  }
  if (identified.kind === "git") {
    const g = identified.git;
    const seg = g.repoPath.replace(/\/+$/, "").split("/").pop();
    return {
      id: `${g.url}@${g.ref}`,
      kind: "git",
      fallbackName: seg !== undefined && seg.length > 0 ? seg : g.host,
    };
  }
  if (identified.kind === "dir") {
    return {
      id: identified.path,
      kind: "dir",
      fallbackName: path.basename(identified.path),
    };
  }
  // plugin/default:退化为目录语义。
  return { id: source, kind: "dir", fallbackName: path.basename(source) || source };
}

export function createRegistrySourceProvider(
  opts: RegistryProviderOptions,
): AgentSourceProvider {
  return {
    async list(): Promise<AgentSourceRecord[]> {
      // M4(host-contract-stores-on-workspace):经 LocalWorkspace 读注册表 —— 把 registryPath 拆成
      // namespace(dirname) + key(basename),落盘文件不变(含 PI_WEB_SOURCES_REGISTRY 覆盖的任意路径),
      // 只是读经 workspace。缺文件/坏 JSON/任何读错误 → [](保持现状全 catch 静默降级,行为零变化)。
      let parsed: unknown;
      try {
        const ns = createLocalWorkspaceNamespace(path.dirname(opts.registryPath));
        parsed = await ns.readJson(path.basename(opts.registryPath));
      } catch {
        return []; // 缺文件/坏 JSON/io 一律视为零登记(Req 3.2/3.3)
      }
      const entries = parseEntries(parsed);
      return entries.map((e) => {
        const { id, kind, fallbackName } = deriveMeta(e.source);
        return {
          id,
          source: e.source,
          name: e.name ?? fallbackName,
          kind,
          origin: "registry" as const,
          // 注册表条目乐观标注 custom(枚举不 clone/探测远端);dir 条目由 Composite 无从探测,
          // 保持 custom 标注即可(选中后真正建会话时 mode 由 resolver 权威判定)。
          mode: "custom" as const,
          ...(e.title !== undefined ? { title: e.title } : {}),
          ...(e.description !== undefined ? { description: e.description } : {}),
          ...(e.avatar !== undefined ? { avatar: e.avatar } : {}),
        };
      });
    },
  };
}
