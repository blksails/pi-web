import type { CreateSkillInput } from "./types.js";

export const MAX_SKILL_BYTES = 512 * 1024;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HIDDEN_CHARACTER_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;

export type SkillValidationSeverity = "error" | "warning";

export type SkillValidationCode =
  | "invalid-name"
  | "frontmatter-missing"
  | "frontmatter-unclosed"
  | "frontmatter-line"
  | "frontmatter-duplicate"
  | "frontmatter-unknown"
  | "missing-name"
  | "name-mismatch"
  | "missing-description"
  | "description-too-long"
  | "empty-body"
  | "resource-too-large"
  | "control-character"
  | "hidden-character"
  | "path-traversal"
  | "prompt-injection"
  | "destructive-command"
  | "remote-code-execution"
  | "secret-exfiltration"
  | "suspicious-capability";

export interface SkillValidationDiagnostic {
  readonly severity: SkillValidationSeverity;
  readonly code: SkillValidationCode;
  readonly message: string;
  readonly line?: number;
}

export interface SkillValidationReport {
  readonly ok: boolean;
  readonly diagnostics: readonly SkillValidationDiagnostic[];
  readonly errors: readonly SkillValidationDiagnostic[];
  readonly warnings: readonly SkillValidationDiagnostic[];
}

export type SkillSubmission = Pick<CreateSkillInput, "name" | "title" | "description" | "content">;

function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through and report only structural problems; manager writes JSON-safe metadata.
    }
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function add(
  diagnostics: SkillValidationDiagnostic[],
  severity: SkillValidationSeverity,
  code: SkillValidationCode,
  message: string,
  line?: number,
): void {
  if (diagnostics.some((item) => item.code === code && item.severity === severity)) return;
  diagnostics.push({ severity, code, message, ...(line !== undefined ? { line } : {}) });
}

function scanPattern(
  diagnostics: SkillValidationDiagnostic[],
  text: string,
  severity: SkillValidationSeverity,
  code: SkillValidationCode,
  pattern: RegExp,
  message: string,
): void {
  const match = pattern.exec(text);
  if (match !== null) add(diagnostics, severity, code, message, lineOf(text, match.index));
}

function parseFrontmatter(
  text: string,
  expectedName: string,
  diagnostics: SkillValidationDiagnostic[],
): { readonly body: string } {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    add(diagnostics, "error", "frontmatter-missing", "Skill 必须以 YAML frontmatter 开始。", 1);
    return { body: text };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) {
    add(diagnostics, "error", "frontmatter-unclosed", "Skill frontmatter 缺少结束分隔线。", 1);
    return { body: lines.slice(1).join("\n") };
  }

  const values = new Map<string, string>();
  const allowed = new Set(["name", "description", "title"]);
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) continue;
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (match === null) {
      add(diagnostics, "error", "frontmatter-line", "Skill frontmatter 存在无法解析的行。", index + 1);
      continue;
    }
    const key = match[1]!;
    if (values.has(key)) {
      add(diagnostics, "error", "frontmatter-duplicate", `Skill frontmatter 字段重复：${key}。`, index + 1);
      continue;
    }
    if (!allowed.has(key)) {
      add(diagnostics, "warning", "frontmatter-unknown", `Skill frontmatter 字段未被 pi 使用：${key}。`, index + 1);
    }
    values.set(key, scalar(match[2]!));
  }

  const name = values.get("name");
  const description = values.get("description");
  if (name === undefined || name.length === 0) {
    add(diagnostics, "error", "missing-name", "Skill frontmatter 必须包含 name。", 2);
  } else if (name !== expectedName) {
    add(diagnostics, "error", "name-mismatch", "Skill frontmatter 的 name 必须与目录/提交名称一致。", 2);
  }
  if (description === undefined || description.length === 0) {
    add(diagnostics, "error", "missing-description", "Skill frontmatter 必须包含非空 description，否则 pi 不会加载。", 2);
  } else if (description.length > 1024) {
    add(diagnostics, "error", "description-too-long", "Skill description 不得超过 1024 个字符。", 2);
  }

  return { body: lines.slice(closingIndex + 1).join("\n") };
}

function buildSkillMarkdown(input: SkillSubmission): string {
  const name = input.name.trim();
  const title = input.title?.trim() || undefined;
  const description = input.description?.trim() ?? "";
  const metadata = [
    "---",
    `name: ${name}`,
    ...(title !== undefined ? [`title: ${JSON.stringify(title)}`] : []),
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
  ];
  return `${metadata.join("\n")}\n${input.content.trimEnd()}\n`;
}

export function validateSkillSubmission(input: SkillSubmission): SkillValidationReport {
  const diagnostics: SkillValidationDiagnostic[] = [];
  const source = buildSkillMarkdown(input);
  const text = normalize(source);

  if (!NAME_PATTERN.test(input.name.trim())) {
    add(diagnostics, "error", "invalid-name", "Skill 名称须为 1-64 位 ASCII 字母、数字、'.'、'_' 或 '-'。", 2);
  }
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_BYTES) {
    add(diagnostics, "error", "resource-too-large", `Skill 不得超过 ${MAX_SKILL_BYTES} bytes。`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(text)) {
    add(diagnostics, "error", "control-character", "Skill 含不可见控制字符。", lineOf(text, CONTROL_CHARACTER_PATTERN.exec(text)?.index ?? 0));
  }
  if (HIDDEN_CHARACTER_PATTERN.test(text)) {
    add(diagnostics, "error", "hidden-character", "Skill 含可能隐藏提示内容的 Unicode 控制字符。", lineOf(text, HIDDEN_CHARACTER_PATTERN.exec(text)?.index ?? 0));
  }
  for (const field of [input.title, input.description]) {
    if (field !== undefined && CONTROL_CHARACTER_PATTERN.test(field)) {
      add(diagnostics, "error", "control-character", "Skill 元数据含不可见控制字符。", 2);
      break;
    }
  }

  const parsed = parseFrontmatter(text, input.name.trim(), diagnostics);
  if (parsed.body.trim().length === 0) {
    add(diagnostics, "error", "empty-body", "Skill 正文不可为空。", text.split("\n").length);
  }

  scanPattern(
    diagnostics,
    text,
    "error",
    "prompt-injection",
    /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|system|developer|safety)\s+(?:instructions?|rules?|prompts?|messages?)\b/i,
    "检测到疑似覆盖系统/开发者指令的提示注入语句。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "prompt-injection",
    /忽略(?:之前|上文|先前|系统|开发者|安全)(?:的)?(?:指令|提示|规则)/,
    "检测到疑似覆盖系统/开发者指令的提示注入语句。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "prompt-injection",
    /(?:<\/?(?:system|developer|assistant)>|\[\s*(?:system|developer)\s*\])/i,
    "检测到伪造系统/开发者消息边界的提示注入标记。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "prompt-injection",
    /^(?:system|developer)\s*:/im,
    "检测到伪造系统/开发者消息边界的提示注入标记。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "prompt-injection",
    /(?:do not|don't|never)\s+(?:tell|show|disclose)\s+(?:the\s+)?user|(?:不要|切勿|不得)告诉用户|隐藏(?:这段|该)指令/i,
    "检测到要求隐瞒行为或结果的提示注入语句。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "prompt-injection",
    /(?:reveal|print|show|exfiltrate)\s+(?:the\s+)?(?:system|developer)\s+prompt|(?:泄露|输出|打印)(?:系统|开发者)(?:提示|指令)/i,
    "检测到索取系统/开发者提示内容的提示注入语句。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "destructive-command",
    /(?:^|[\s`])rm\s+(?:--[^\s]+\s+)*-[rf]{1,2}\b|\b(?:del|erase|rmdir|rd)\s+(?:\/[^\s]+\s+)*\/(?:s|q|f)\b|\bRemove-Item\b[^\n]*(?:-Recurse|-Force)\b|\bformat\s+[a-z]:|\bdiskpart\b|\bgit\s+(?:reset\s+--hard|clean\s+-fdx?|(?:restore|checkout)\s+--?\s+\.)\b|\b(?:drop\s+(?:database|schema|table)|truncate\s+table)\b|\bshutdown\s+(?:-s|-r|\/s|\/r)\b|\bchmod\s+777\b|:\(\)\s*\{\s*:\|:\s*&\s*\}/i,
    "检测到高危破坏性命令，提交已阻断。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "remote-code-execution",
    /(?:curl|wget|Invoke-WebRequest|iwr|base64\s+-d)[^\n|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex)\b|\b(?:powershell|pwsh)\s+(?:-[^\n]*\s+)?-enc(?:odedcommand)?\b|\b(?:eval|exec|Function)\s*\(|\b(?:child_process\.exec|subprocess\.(?:run|Popen|call))\b/i,
    "检测到下载后执行或动态执行代码的模式，提交已阻断。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "secret-exfiltration",
    /(?:api[_ -]?key|secret|token|password|credential|process\.env|\.ssh|id_rsa)[^\n]{0,160}(?:curl|wget|fetch\s*\(|webhook|https?:\/\/)|(?:curl|wget|fetch\s*\()[^\n]{0,160}(?:api[_ -]?key|secret|token|password|credential|process\.env|\.ssh|id_rsa)/i,
    "检测到读取凭据并向外部地址发送的模式，提交已阻断。",
  );
  scanPattern(
    diagnostics,
    text,
    "error",
    "path-traversal",
    /(?:^|[\s"'`(])\.\.[\\/]|(?:^|[\s"'`(])(?:\/(?:etc|root|var|home)\/|[A-Za-z]:[\\/](?:Windows|Users|Program Files))/i,
    "检测到可能越界访问或覆盖系统路径的模式，提交已阻断。",
  );

  scanPattern(
    diagnostics,
    text,
    "warning",
    "suspicious-capability",
    /\b(?:process\.env|child_process|subprocess|powershell|Invoke-WebRequest|curl|wget|fetch\s*\(|base64|eval\s*\(|exec\s*\()/i,
    "Skill 含外部进程、网络、编码或动态执行能力，建议人工复核。",
  );
  scanPattern(
    diagnostics,
    text,
    "warning",
    "suspicious-capability",
    /(?:api[_ -]?key|secret|token|password|credential|\.ssh|id_rsa)/i,
    "Skill 提及凭据或敏感文件，建议确认其用途与最小权限。",
  );
  scanPattern(
    diagnostics,
    text,
    "warning",
    "suspicious-capability",
    /(?:[A-Za-z0-9+/]{96,}={0,2})/,
    "Skill 含较长编码载荷，建议人工复核是否为隐藏指令。",
  );

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  return { ok: errors.length === 0, diagnostics, errors, warnings };
}

export class SkillValidationError extends Error {
  readonly report: SkillValidationReport;

  constructor(report: SkillValidationReport) {
    super("Skill validation failed.");
    this.name = "SkillValidationError";
    this.report = report;
  }
}

export function assertValidSkillSubmission(input: SkillSubmission): SkillValidationReport {
  const report = validateSkillSubmission(input);
  if (!report.ok) throw new SkillValidationError(report);
  return report;
}

export { buildSkillMarkdown };
