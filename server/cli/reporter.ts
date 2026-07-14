/**
 * reporter — 阶段性进度输出 + 统一脱敏错误渲染(spec cli-package-commands,任务 1.2,
 * Req 3.10, 3.11, 10.3)。
 *
 * 设计约束(design.md `Error Handling`):全部子命令以判别联合表达错误
 * (`{ code, message, ...context }`),不得自行 `console.log` 拼错误文案 —— 一律经
 * `ProgressReporter.fail()` 渲染,使脱敏在唯一出口生效。`context.ts` 的 `CliContext`
 * 持有一个 reporter 实例,由各子命令注入使用而非各自 new 一个。
 */

/** 阶段名,子命令自定义(如 "install:resolve-source" / "publish:sign")。 */
export type ProgressStage = string;

/**
 * 子命令错误的判别联合基类型。各子域(scaffold/install/publish)在此基础上定义具体的
 * `code` 字面量与上下文字段(结构化子类型,仍可赋值给 `CliError`)。`message` 是留给
 * 用户的可操作文案 —— 但仍可能被上游(如子进程 stderr)污染凭据,故 reporter 渲染前
 * 统一过一遍 `redactSecrets`。
 */
export interface CliError {
  readonly code: string;
  readonly message: string;
}

/** 进度报告器:开始 / 完成 / 失败三态,输出可读的一行文本。 */
export interface ProgressReporter {
  start(stage: ProgressStage, detail?: string): void;
  complete(stage: ProgressStage, detail?: string): void;
  fail(stage: ProgressStage, error: CliError): void;
}

export interface ProgressReporterOptions {
  /** 行输出汇(缺省 `console.log`);测试注入以捕获输出。 */
  readonly write?: (line: string) => void;
}

/**
 * 脱敏(需求 3.11 / 10.3):从任意文本中抹去凭据与令牌,只保留可定位问题的结构。
 *
 * 覆盖四类形态。前两类与 `packages/server/src/extensions/cli/pi-cli.ts` 内部 `redact()`
 * 同策略(该函数未导出,故此处按同规则独立实现);后两类是本层的加固 —— 基线只脱敏
 * `KEY=value`,而 `Authorization: Bearer <token>`、JSON 的 `"apiKey":"sk-..."` 与裸露的
 * `sk-` 前缀令牌都会漏网,这三种恰是子进程与 HTTP 客户端错误信息里最常见的泄漏形态。
 *
 *  1. URL 内联凭据      `https://user:pass@host` → `https://[redacted]@host`
 *  2. 敏感键赋值        `API_KEY=xxx` / `"apiKey": "xxx"`(键名与值均可带引号)
 *  3. Bearer/Basic 令牌 `Authorization: Bearer xxx`
 *  4. 已知前缀的令牌字面量 `sk-…` / `ghp_…` / `xoxb-…`(脱离键值上下文亦抹除)
 */
const SENSITIVE_KEY = String.raw`[A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|credential)[A-Za-z0-9_-]*`;

export function redactSecrets(text: string): string {
  return (
    text
      // 1. URL 内联凭据
      .replace(/((?:https?|ssh|git):\/\/)[^/@\s]+@/gi, "$1[redacted]@")
      // 2. 敏感键赋值:键名与值均可被引号包裹
      .replace(
        new RegExp(String.raw`(["']?${SENSITIVE_KEY}["']?\s*[:=]\s*)(["']?)[^\s,;}"']+\2`, "gi"),
        "$1[redacted]",
      )
      // 3. Bearer / Basic 令牌
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
      // 4. 已知前缀的令牌字面量(兜底:无上下文亦抹除)
      .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{6,}/gi, "[redacted]")
      .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}/gi, "[redacted]")
      .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/gi, "[redacted]")
  );
}

function formatLine(kind: "start" | "done" | "fail", stage: ProgressStage, detail?: string): string {
  const marker = kind === "start" ? "▶" : kind === "done" ? "✔" : "✖";
  return detail !== undefined && detail.length > 0 ? `${marker} ${stage} — ${detail}` : `${marker} ${stage}`;
}

/** 生产实现:默认写 `console.log`,可注入 `write` 供测试捕获。 */
export function createProgressReporter(options: ProgressReporterOptions = {}): ProgressReporter {
  const write = options.write ?? ((line: string) => { console.log(line); });
  return {
    start(stage, detail) {
      write(formatLine("start", stage, detail));
    },
    complete(stage, detail) {
      write(formatLine("done", stage, detail));
    },
    fail(stage, error) {
      write(formatLine("fail", stage, `[${error.code}] ${redactSecrets(error.message)}`));
    },
  };
}
