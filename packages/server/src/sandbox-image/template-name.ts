/**
 * sandbox-image · source 标识派生(`sandbox-baked-agent-image` spec,任务 1.1;Req 2.6/3.2)。
 *
 * 从 resolver 的稳定来源标识(policySource 语义:dir 绝对路径 / git url / `builtin:<name>`)
 * 派生命名安全的 slug、专属镜像名与沙箱模板名——构建期(bake-plan / build-agent-image.mjs)与
 * 会话期(template-resolve)共用同一实现,保证两侧命名恒一致。
 *
 * 派生形态(design.md §template-name):
 * - `slug   = sanitize(basename) + "-" + sha256(policySource).slice(0, 8)`
 * - 镜像名 `piweb-agent/<slug>:<tag>`
 * - 模板名 `piweb-agent-<slug>.<tag>`
 *
 * 不变式:
 * - 纯函数,不读 env / fs;同输入恒同输出(Req 3.2「同一 source 每次派生结果一致」)。
 * - slug 仅含 `[a-z0-9-]` 且首尾非连字符、**不含 `.`**——模板名以 `.` 分隔 slug 与 tag,
 *   与 agent-sandbox dynamic 规则 `piweb-agent-(?P<name>.+)\.(?P<version>.+)$` →
 *   `piweb-agent/<name>:<version>` 互逆的前提即是分隔符唯一。
 * - tag 由调用方传入;含 `.` 时**归一为 `-`**(而非抛错),镜像名与模板名一致归一,
 *   保证互逆无歧义(design 未指定抛错/归一,此处选择归一并以测试钉住)。
 * - 同 basename 不同标识(如两处同名 agent 目录)由 8 位内容哈希后缀区分,不会冲突。
 */
import { createHash } from "node:crypto";

export interface SourceIdentityInput {
  /** resolver 稳定来源标识(dir 绝对路径 / git url / builtin:<name>)。 */
  readonly policySource: string;
}

/** builtin 型标识前缀(`builtin:<name>`)。 */
const BUILTIN_PREFIX = "builtin:";

/** sanitize 后为空(basename 全非法字符,如纯中文)时的占位前缀。 */
const FALLBACK_BASE = "agent";

/** 哈希后缀长度(sha256 hex 前 8 位)。 */
const HASH_LEN = 8;

/** 校验 policySource 非空,返回 trim 后的稳定标识。 */
function requireIdentity(input: SourceIdentityInput): string {
  const id = input.policySource.trim();
  if (id === "") {
    throw new TypeError(
      "deriveSlug: policySource must be a non-empty source identity (dir path / git url / builtin:<name>)",
    );
  }
  return id;
}

/**
 * 从标识提取「人类可读前缀」的原始 basename:
 * - builtin 型:剥 `builtin:` 前缀取名;
 * - 其余(dir / git url):剥 URL fragment/query 与尾部 `/`,剥 `.git` 后缀,
 *   取最后一个 `/` 之后的段;scp 式(`git@host:user/repo.git`)再剥最后一个 `:` 之前的部分。
 */
function extractBasename(identity: string): string {
  if (identity.startsWith(BUILTIN_PREFIX)) {
    return identity.slice(BUILTIN_PREFIX.length);
  }
  let s = identity;
  // git url 可能携带 fragment(#ref)或 query,不参与命名
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash);
  const query = s.indexOf("?");
  if (query >= 0) s = s.slice(0, query);
  // 尾部路径分隔符不影响 basename
  s = s.replace(/\/+$/, "");
  if (s.endsWith(".git")) s = s.slice(0, -".git".length);
  const lastSlash = s.lastIndexOf("/");
  if (lastSlash >= 0) s = s.slice(lastSlash + 1);
  // scp 式 git 标识(git@host:repo)在无 `/` 时以 `:` 分段
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0) s = s.slice(lastColon + 1);
  return s;
}

/**
 * 归一为命名安全段:小写化,非 `[a-z0-9]` 一律折叠为单个 `-`(含 `.`——slug 不得含点,
 * 见模块头不变式),去首尾 `-`;归一后为空则回退 {@link FALLBACK_BASE}。
 */
function sanitize(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? FALLBACK_BASE : cleaned;
}

/** 校验并归一 tag:非空;`.` 归一为 `-`(镜像名与模板名共用,保证互逆无歧义)。 */
function normalizeTag(tag: string): string {
  const t = tag.trim();
  if (t === "") {
    throw new TypeError("deriveImageName/deriveTemplateName: tag must be non-empty");
  }
  return t.replace(/\./g, "-");
}

/**
 * 派生命名安全 slug:`sanitize(basename) + "-" + sha256(标识).slice(0, 8)`。
 * 同输入恒同输出;输出满足 `^[a-z0-9][a-z0-9-]*[a-z0-9]$` 且不含 `.`。
 */
export function deriveSlug(input: SourceIdentityInput): string {
  const identity = requireIdentity(input);
  const base = sanitize(extractBasename(identity));
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, HASH_LEN);
  return `${base}-${hash}`;
}

/** 派生专属镜像名:`piweb-agent/<slug>:<tag>`(tag 含 `.` 归一为 `-`)。 */
export function deriveImageName(input: SourceIdentityInput, tag: string): string {
  return `piweb-agent/${deriveSlug(input)}:${normalizeTag(tag)}`;
}

/**
 * 派生沙箱模板名:`piweb-agent-<slug>.<tag>`——与 agent-sandbox dynamic 规则
 * `piweb-agent-(?P<name>.+)\.(?P<version>.+)$` 互逆:提取的 name/version 分别等于
 * slug 与(归一后)tag,`piweb-agent/<name>:<version>` 即还原出镜像名。
 */
export function deriveTemplateName(input: SourceIdentityInput, tag: string): string {
  return `piweb-agent-${deriveSlug(input)}.${normalizeTag(tag)}`;
}
