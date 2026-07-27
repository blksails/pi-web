/**
 * online-source-id(spec: desktop-online-source-runnable,任务 1.1)——
 * 线上注册表源的 `sourceId@channel` 形态判别与解析。
 *
 * ## 为什么判别必须严格
 *
 * `identify()`(`source-type.ts:105`)把 `opts.sourceResolver.canHandle(source)` 放在**所有其他
 * 分支之前** —— 先于 `builtin:`、`git:`、本地目录判定。因此本模块一旦误判,就会把一个本地目录源
 * 劫持进线上安装通路(Req 8.1 回归)。判别宁可漏放(退回既有分支,行为不变)也不可错收。
 *
 * 采取**白名单式**判别而非黑名单:sourceId 段与 channel 段都必须由受限字符集构成。这样将来出现
 * 未预料的本地路径形态时,默认结果是「不命中」而非「命中」。
 *
 * 纯字符串处理:不读 fs、不读 env、不做网络。同输入恒同输出。
 */

/** `sourceId@channel` 的解析结果。 */
export interface OnlineSourceRef {
  readonly sourceId: string;
  readonly channel: string;
}

/**
 * sourceId 允许的字符:字母数字、`-`、`_`、`.`、以及作为作用域分隔的 `/`。
 * 刻意**不含** `@`(由分隔符独占)、空白、`\`、`:`、`~`。
 */
const SOURCE_ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** channel 允许的字符:字母数字加 `-`/`_`/`.`(如 `stable`、`beta`、`next-1`)。 */
const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * sourceId 最多允许的斜杠分段数(`作用域/名`)。
 *
 * 依据实测的真实清单:`e2e/aigc-canvas-agent`(2 段)、`code-review`、`canvas-watermark`(1 段)
 * —— 见各 example 目录下 `pi-web.json` 的 `id` 字段。若将来注册表放开更深层级,超限的标识会在
 * `identify()` 里落到 `SourceKindError` 而**响亮失败**(不是静默丢弃),届时放宽此处即可。
 */
const MAX_ID_SEGMENTS = 2;

function isValidSourceId(id: string): boolean {
  if (id.length === 0) return false;
  // 路径穿越与隐藏段:任一分段为 `.` / `..` 即拒绝。
  const segments = id.split("/");
  if (segments.length > MAX_ID_SEGMENTS) return false;
  for (const seg of segments) {
    if (seg === "." || seg === "..") return false;
    if (!SOURCE_ID_SEGMENT.test(seg)) return false;
  }
  return true;
}

/**
 * 判定 source 是否为线上注册表源形态。
 *
 * 命中条件(全部满足):恰有一个 `@`;其前为合法 sourceId(1–2 个受限字符集分段);其后为合法 channel。
 * 由此天然排除:本地路径(`/`、`./`、`../`、`~/` 开头或含 `.`/`..` 分段)、URL(含 `:`、`//`)、
 * `git:`/`builtin:` 前缀(含 `:`)、空/空白、含空字节的输入。
 */
export function isOnlineSourceRef(source: string): boolean {
  return parseOnlineSourceRef(source) !== undefined;
}

/** 解析 `sourceId@channel`;不合法形态返回 `undefined`(与 `isOnlineSourceRef` 判定一致)。 */
export function parseOnlineSourceRef(source: string): OnlineSourceRef | undefined {
  // 不 trim:前后空白本身即不合法形态(受限字符集不含空白),trim 反而会放宽判别。
  if (source.length === 0) return undefined;

  const at = source.indexOf("@");
  if (at === -1) return undefined;
  // 多个 `@` → 不命中(避免把 `user@host:path` 一类形态收进来)。
  if (source.indexOf("@", at + 1) !== -1) return undefined;

  const sourceId = source.slice(0, at);
  const channel = source.slice(at + 1);
  if (!isValidSourceId(sourceId)) return undefined;
  if (channel.length === 0 || !CHANNEL_PATTERN.test(channel)) return undefined;

  return { sourceId, channel };
}

/** 回写为可提交标识;与 `parseOnlineSourceRef` 互为逆运算。 */
export function formatOnlineSourceRef(ref: OnlineSourceRef): string {
  return `${ref.sourceId}@${ref.channel}`;
}
