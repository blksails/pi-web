/**
 * session-store-adapters — 序列化/解析/编码与版本归一(纯函数核心)。
 *
 * 三个 adapter 共享这一份格式逻辑,避免语义漂移。桶编码与文件名编码严格复刻
 * pi `~/.pi/agent/sessions` 既有规则,保证 fs adapter 与既有 pi 工具互通
 * (Req 10.1/10.2)。版本归一仅在读路径产出当前 version 语义,不回写存储
 * 原始数据(Req 9.2)。
 */
import {
  KNOWN_ENTRY_TYPES,
  SessionEntryParseError,
  UnknownSessionVersionError,
  type SessionEntry,
  type SessionEntryType,
  type SessionHeader,
  type SessionVersion,
} from "./types.js";

const ENTRY_TYPE_SET: ReadonlySet<string> = new Set<string>(KNOWN_ENTRY_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionVersion(value: unknown): value is SessionVersion {
  return value === 1 || value === 2 || value === 3;
}

/** 序列化会话头部为一行 JSON(不含换行)。 */
export function serializeHeader(header: SessionHeader): string {
  return JSON.stringify(header);
}

/** 序列化 entry 为一行 JSON(不含换行)。 */
export function serializeEntry(entry: SessionEntry): string {
  return JSON.stringify(entry);
}

/**
 * 工作目录 → 桶目录名。规则复刻 pi:去掉开头的路径分隔符,再把 `/ \ :` 换成 `-`,
 * 两侧包 `--`(Req 10.2)。
 */
export function bucketDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/**
 * 会话文件名。规则复刻 pi:ISO 时间戳里的 `:` `.` 换成 `-`,拼 `_<id>.jsonl`
 * (Req 10.1)。
 */
export function sessionFileName(timestampISO: string, id: string): string {
  return `${timestampISO.replace(/[:.]/g, "-")}_${id}.jsonl`;
}

/** 解析失败统一抛 {@link SessionEntryParseError}。 */
function fail(position: number | string, sessionId: string | undefined, cause?: unknown): never {
  throw new SessionEntryParseError({ position, sessionId, cause });
}

/** 校验并归一化 header 形态;version 非法抛 {@link UnknownSessionVersionError}(Req 9.3)。 */
export function parseHeader(value: unknown, position: number | string = 0): SessionHeader {
  if (!isRecord(value) || value["type"] !== "session") fail(position, undefined);
  const rec = value as Record<string, unknown>;
  if (!isSessionVersion(rec["version"])) throw new UnknownSessionVersionError(rec["version"]);
  if (typeof rec["id"] !== "string" || typeof rec["cwd"] !== "string" || typeof rec["timestamp"] !== "string") {
    fail(position, undefined);
  }
  return value as unknown as SessionHeader;
}

/** 校验并归一化 entry 信封:type 已知、id/timestamp 为字符串、parentId 缺省为 null(Req 5.5)。 */
export function parseEntry(
  value: unknown,
  position: number | string,
  sessionId?: string,
): SessionEntry {
  if (!isRecord(value)) fail(position, sessionId);
  const rec = value as Record<string, unknown>;
  const type = rec["type"];
  if (typeof type !== "string" || !ENTRY_TYPE_SET.has(type)) fail(position, sessionId);
  if (typeof rec["id"] !== "string" || typeof rec["timestamp"] !== "string") fail(position, sessionId);
  if (rec["parentId"] === undefined) rec["parentId"] = null;
  else if (rec["parentId"] !== null && typeof rec["parentId"] !== "string") fail(position, sessionId);
  return rec as unknown as SessionEntry;
}

/**
 * 宽松解析 entry:仅要求是已知 type 的对象,不要求 `id`/`timestamp`(供 v1 历史数据用——
 * 真实 v1 entry 无 id,id 由 v1 归一器按行号合成)。返回原始记录,字段补全交给归一器。
 */
export function parseEntryLoose(
  value: unknown,
  position: number | string,
  sessionId?: string,
): Record<string, unknown> {
  if (!isRecord(value)) fail(position, sessionId);
  const rec = value as Record<string, unknown>;
  const type = rec["type"];
  if (typeof type !== "string" || !ENTRY_TYPE_SET.has(type)) fail(position, sessionId);
  return rec;
}

/** 解析一行(header 或 entry,strict)。首行 position 给 0 表示当作 header 解析。 */
export function parseLine(
  line: string,
  position: number | string,
  sessionId?: string,
): SessionHeader | SessionEntry {
  const parsed = parseJson(line, position, sessionId);
  if (isRecord(parsed) && parsed["type"] === "session") return parseHeader(parsed, position);
  return parseEntry(parsed, position, sessionId);
}

/** JSON.parse 一行,失败抛 {@link SessionEntryParseError} 并带定位。 */
export function parseJson(line: string, position: number | string, sessionId?: string): unknown {
  try {
    return JSON.parse(line);
  } catch (cause) {
    fail(position, sessionId, cause);
  }
}

/** v1 历史 entry 的合成 id:取文件行号(header=0,与 pi 迁移的 entries 数组下标一致)。 */
export function v1EntryId(lineIndex: number): string {
  return `v1-${lineIndex}`;
}

/** v<3:把 message 的 `hookMessage` 角色归一为 `custom`(对照第三方 migrateV2ToV3,Req 9.1)。 */
function renameHookRole(entry: SessionEntry): SessionEntry {
  if (entry.type === "message") {
    const role = (entry.message as { role?: unknown }).role;
    if (role === "hookMessage") return { ...entry, message: { ...entry.message, role: "custom" } };
  }
  return entry;
}

/**
 * 读路径归一器(fs adapter 用)。输入为 JSON.parse 后的原始对象 + 文件行号,产出当前
 * version 语义的 entry,**不回写存储原始字节**(Req 9.2)。
 * - v≥3:strict 校验后恒等。
 * - v2:strict 校验 + hookMessage→custom。
 * - v1:宽松解析(真实 v1 无 id),按行号合成 `id`/`parentId` 链、把 compaction 的
 *   `firstKeptEntryIndex` 转 `firstKeptEntryId`、hookMessage→custom(对照第三方 migrateV1ToV2)。
 *
 * 归一器是有状态闭包(v1 需记忆上一行号),每次读会话各取一个新实例。
 */
export function makeReadNormalizer(
  version: SessionVersion,
  sessionId?: string,
): (raw: unknown, lineIndex: number) => SessionEntry {
  if (version >= 2) {
    const renameHook = version < 3;
    return (raw, lineIndex) => {
      const entry = parseEntry(raw, lineIndex, sessionId);
      return renameHook ? renameHookRole(entry) : entry;
    };
  }

  // v1
  let previousLine: number | null = null;
  return (raw, lineIndex) => {
    const rec = parseEntryLoose(raw, lineIndex, sessionId);
    rec["id"] = v1EntryId(lineIndex);
    rec["parentId"] = previousLine === null ? null : v1EntryId(previousLine);
    if (typeof rec["timestamp"] !== "string") rec["timestamp"] = "";
    previousLine = lineIndex;
    if (rec["type"] === "compaction") {
      const idx = rec["firstKeptEntryIndex"];
      if (typeof idx === "number") {
        rec["firstKeptEntryId"] = idx >= 1 ? v1EntryId(idx) : "";
        delete rec["firstKeptEntryIndex"];
      }
      if (typeof rec["firstKeptEntryId"] !== "string") rec["firstKeptEntryId"] = "";
    }
    return renameHookRole(rec as unknown as SessionEntry);
  };
}

/**
 * 已存条目归一器(sqlite/postgres adapter 用)。这些后端只持有本存储写入的、必带 `id`
 * 的条目,绝不含真实 v1 历史数据,因此不做行号 id 合成,仅在 v<3 时做 hookMessage→custom。
 */
export function makeStoredEntryNormalizer(version: SessionVersion): (entry: SessionEntry) => SessionEntry {
  if (version >= 3) return (entry) => entry;
  return (entry) => renameHookRole(entry);
}

/** 工具:把 entry `type` 收窄为联合(供 adapter 在已校验后使用)。 */
export function isKnownEntryType(type: string): type is SessionEntryType {
  return ENTRY_TYPE_SET.has(type);
}
