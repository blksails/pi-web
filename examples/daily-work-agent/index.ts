/**
 * daily-work-agent — 「日常工作业务」agent source。
 *
 * 面向日常办公 + 经 pi-gateway 的 IM 通道：号码生成、sendaction 手动回传、
 * 域名审核上传、定时任务、企微、长期记忆；
 * 并内置「主动认知 / 工作循环」人格（见 prompts/system-prompt.md）。
 *
 * 非 builtin:default-agent — 通用编码请用 default-agent；通道/日常工作用本目录路径作 agentSource。
 *
 * model 故意省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineAgent, type ExtensionFactory } from "@blksails/pi-web-agent-kit";
import { memoryExtension, visionExtension } from "@blksails/pi-web-tool-kit/runtime";
import { phonegen } from "./tools/phonegen.js";
import { sendaction } from "./tools/sendaction.js";
import { uploadDomainReview } from "./tools/upload-domain-review.js";

const AGENT_ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadSystemPrompt(): string {
  const p = path.join(AGENT_ROOT, "prompts/system-prompt.md");
  try {
    return readFileSync(p, "utf8").trim();
  } catch {
    return [
      "你是「日常工作业务」助手。使用 memory_* 管理长期认知；不要使用 todo 工具。",
      "能力：phonegen、sendaction 手动回传、upload_domain_review 域名审核上传、schedule_prompt、wecom_*、memory_*。文件 IO 仅 bash。",
    ].join("\n");
  }
}

/**
 * 解析 pi-schedule-prompt 扩展入口。
 * 优先 PI_CODING_AGENT_DIR（pi-web spawn 注入），否则 ~/.pi/agent。
 */
function resolveSchedulePromptEntry(): string | undefined {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR?.trim() ||
    path.join(homedir(), ".pi", "agent");
  const candidates = [
    path.join(agentDir, "npm/node_modules/pi-schedule-prompt/src/index.ts"),
    path.join(agentDir, "npm/node_modules/pi-schedule-prompt/dist/index.js"),
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Resolve WeCom extension entry (installed for this agent).
 * Order: project .pi/extensions → monorepo package → cwd fallback.
 */
function resolveWecomExtensionEntry(): string | undefined {
  const candidates = [
    path.join(AGENT_ROOT, ".pi/extensions/wecom.ts"),
    path.resolve(AGENT_ROOT, "../../packages/wecom-extension/src/index.ts"),
    path.resolve(process.cwd(), "packages/wecom-extension/src/index.ts"),
    path.resolve(process.cwd(), "examples/daily-work-agent/.pi/extensions/wecom.ts"),
  ];
  return candidates.find((p) => existsSync(p));
}

const scheduleEntry = resolveSchedulePromptEntry();
const wecomEntry = resolveWecomExtensionEntry();
const pathExtensions = [scheduleEntry, wecomEntry].filter(
  (p): p is string => typeof p === "string" && p.length > 0,
);
/** In-process factories + optional path-based extensions (schedule / wecom). */
const extensions: Array<string | ExtensionFactory> = [
  memoryExtension,
  // 本 agent 主模型是纯文本（qwen 系）；图片经 image_vision 交给视觉模型看，
  // 主模型只读回文字结论 —— 图片字节不进主模型 content，故不会触发 400。
  visionExtension,
  ...pathExtensions,
];

if (!wecomEntry) {
  console.warn(
    "[daily-work-agent] WeCom extension not found — wecom_* tools will be unavailable",
  );
} else {
  console.info("[daily-work-agent] WeCom extension:", wecomEntry);
}

export default defineAgent({
  systemPrompt: loadSystemPrompt(),
  customTools: [phonegen, sendaction, uploadDomainReview],
  // Explicit extensions: memory (in-process) + schedule + WeCom paths
  extensions,
  tools: [
    "bash",
    "fetch",
    "schedule_prompt",
    "wecom_send",
    "wecom_send_file",
    "wecom_send_menu",
    "wecom_get_binding",
    "wecom_gateway_health",
    "wecom_admin_whoami",
    "wecom_admin_list",
    "wecom_admin_grant",
    "wecom_admin_revoke",
    "wecom_gateway_status",
    "wecom_admin_sandbox_get",
    "wecom_admin_sandbox_add_domains",
    "wecom_admin_sandbox_remove_domains",
    "wecom_admin_file_manager_settings_get",
    "wecom_admin_file_manager_settings_patch",
    // memory-extension（tools allowlist 必须显式放行扩展工具名）
    "memory_write",
    "memory_read",
    "memory_list",
    "memory_search",
    "memory_delete",
    // vision-extension：看企微等通道传来的图片附件（att_ id）
    "image_vision",
  ],
});
