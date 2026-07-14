/**
 * semver-lite — 极简版本范围校验(spec cli-component-add,任务 2.1,Req 4.4)。
 *
 * 仓内无 semver 依赖(全 workspace 均未引入),peer 校验的需求面又极窄
 * (research §1.4),故自带 ~60 行纯函数实现,**只支持四种写法**:
 *   - 精确    `1.2.3`         → 完全相等
 *   - `>=`    `>=1.2.3`       → 逐位比较不小于
 *   - `^`     `^1.2.3`        → 同主版本且 >= 基准(主版本为 0 时按生态惯例锁次版本)
 *   - `~`     `~1.2.3`        → 同主次版本且 >= 基准
 * 其余写法(range 组合、`<`、`x`/`*` 通配、prerelease 等)一律返回
 * `range_unsupported` —— 不猜语义(Req 4.4:报稳定码与写法原文)。
 *
 * 版本串只接受 `x.y.z` 三段纯数字(允许 `v` 前缀);prerelease/build 后缀视为不可解析。
 */

export type SemverTriple = readonly [number, number, number];

export type SemverRange = {
  readonly kind: "exact" | "gte" | "caret" | "tilde";
  readonly version: SemverTriple;
};

export type RangeParseError = {
  readonly error: "range_unsupported";
  /** 写法原文(错误呈现用)。 */
  readonly raw: string;
};

const TRIPLE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** 解析 `x.y.z`(可带 `v` 前缀);不合形态返回 null。 */
export function parseVersion(raw: string): SemverTriple | null {
  const m = TRIPLE.exec(raw.trim());
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 解析范围表达式;仅四种写法,其余 `range_unsupported`。 */
export function parseRange(raw: string): SemverRange | RangeParseError {
  const trimmed = raw.trim();
  const unsupported: RangeParseError = { error: "range_unsupported", raw };

  let kind: SemverRange["kind"];
  let rest: string;
  if (trimmed.startsWith(">=")) {
    kind = "gte";
    rest = trimmed.slice(2);
  } else if (trimmed.startsWith("^")) {
    kind = "caret";
    rest = trimmed.slice(1);
  } else if (trimmed.startsWith("~")) {
    kind = "tilde";
    rest = trimmed.slice(1);
  } else {
    kind = "exact";
    rest = trimmed;
  }
  const version = parseVersion(rest);
  if (version === null) return unsupported;
  return { kind, version };
}

function compare(a: SemverTriple, b: SemverTriple): number {
  for (let i = 0; i < 3; i += 1) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

/** 版本是否满足范围。version 不可解析时视为不满足(调用方自行呈现 actual)。 */
export function satisfies(version: string, range: SemverRange): boolean {
  const v = parseVersion(version);
  if (v === null) return false;
  const base = range.version;
  switch (range.kind) {
    case "exact":
      return compare(v, base) === 0;
    case "gte":
      return compare(v, base) >= 0;
    case "caret": {
      if (compare(v, base) < 0) return false;
      // ^0.y.z 按生态惯例锁次版本(0.x 之间互不兼容);^x(x>=1) 锁主版本。
      if (base[0] === 0) return v[0] === 0 && v[1] === base[1];
      return v[0] === base[0];
    }
    case "tilde":
      return compare(v, base) >= 0 && v[0] === base[0] && v[1] === base[1];
  }
}
