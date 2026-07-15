/**
 * daily-work-agent — 「日常工作业务」agent source。
 *
 * 面向日常办公场景：号码生成(phonegen)、审核文件拷贝、批量核对、工作简报、定时任务。
 * 项目级 skills 在 `.pi/skills/*`；自定义工具 `phonegen` 包装本机 phonegen CLI。
 * 定时：显式加载 user-scope 的 `pi-schedule-prompt`，并在 `tools` 白名单放行 `schedule_prompt`。
 * 企微：安装 @blksails/pi-web-wecom（.pi/extensions/wecom.ts + 显式 extensions 路径）。
 * 文件 IO 仅 `bash`（OS 沙盒）；禁 read/ls/glob/write/edit/patch（Node 直访 FS）。
 *
 * model 故意省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { phonegen } from "./tools/phonegen.js";

const AGENT_ROOT = path.dirname(fileURLToPath(import.meta.url));

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
const extensions = [scheduleEntry, wecomEntry].filter(
  (p): p is string => typeof p === "string" && p.length > 0,
);

if (!wecomEntry) {
  console.warn(
    "[daily-work-agent] WeCom extension not found — wecom_* tools will be unavailable",
  );
} else {
  console.info("[daily-work-agent] WeCom extension:", wecomEntry);
}

export default defineAgent({
  systemPrompt: [
    "你是「日常工作业务」助手，协助处理日常办公与业务操作任务。",
    "",
    "能力与优先级：",
    "1. **号码生成 (phonegen)**：调用工具 `phonegen`，底层是本机",
    "   `/Users/hysios/Projects/phonegen`（`python3 main.py`，号段 phone.dic）。",
    "   按省/市/运营商筛选；禁止凭空编造号码。大批量必须指定 output 落盘。",
    "2. **审核文件拷贝**：用户要核对拷贝是否完整、路径是否正确、源/目标是否一致时，",
    "   遵循 skill `review-file-copy`：先列目录再比对（数量、体积、抽样 checksum），给出通过/风险清单。",
    "3. **批量文件核对**：大批量路径、清单对账时用 skill `batch-file-check`。",
    "4. **工作简报**：日/周小结、待办归并时用 skill `work-brief`。",
    "5. **定时任务 (pi-schedule-prompt)**：用户要「定时 / 提醒 / 每隔… / 延迟执行」时，",
    "   调用工具 `schedule_prompt`（action=add 时必须同时给 schedule + prompt）。",
    "   格式：相对时间 `+10m`/`+1h`、间隔 `5m`/`1h`、6 段 cron（含秒）、ISO 时间；",
    "   一次性用 type `once`，周期默认 cron。list/remove/enable/disable/update/cleanup 管理任务。",
    "   不要在「定时任务触发的 prompt 执行过程中」再创建新的定时任务（防循环）。",
    "6. **企业微信 (wecom_*)**：会话从企微通道进入时已绑定 thread（当前优先单聊）。",
    "   - 普通回复由网关自动写回，无需工具。",
    "   - 文本主动推送：`wecom_send`（delivery=active）。",
    "   - **发文件**：`wecom_send_file`（path 或 base64 + filename；单聊 userid）。",
    "   - **按钮菜单**：`wecom_send_menu`（title + buttons[{text,key}]；单聊 template_card）。",
    "   - 先可用 `wecom_get_binding` 确认绑定；连通性用 `wecom_gateway_health`。",
    "   - 定时任务结果要推企微时，在 prompt 里要求调用 wecom_send / wecom_send_file。",
    "",
    "通用纪律：",
    "- **文件与 shell 只允许工具 `bash`**（经 pi-sandbox OS 沙盒）。",
    "  已禁用内置 read/ls/glob/write/edit/patch（它们不走或绕过 OS 沙盒）。",
    "  列目录、读文件、写文件、拷贝审核一律用 bash（ls/find/cat/cp/shasum 等）。",
    "- 写操作（改文件、移动、删除）前先确认意图与路径。",
    "- 回复简洁，结论先行，细节用条目列出。",
    "- 涉及真实用户隐私（真号、真路径下的敏感文件）时先提醒脱敏，不把密钥写入仓库。",
  ].join("\n"),
  customTools: [phonegen],
  // Explicit extensions: schedule + WeCom (also discoverable via .pi/extensions/wecom.ts)
  ...(extensions.length > 0 ? { extensions } : {}),
  tools: [
    "bash",
    "fetch",
    "schedule_prompt",
    "wecom_send",
    "wecom_send_file",
    "wecom_send_menu",
    "wecom_get_binding",
    "wecom_gateway_health",
  ],
});
