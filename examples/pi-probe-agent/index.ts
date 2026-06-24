/**
 * pi-probe-agent — 验证「项目级 `.pi/` 资源是否被正确加载」的探针 agent。
 *
 * 与 hello-agent 同构(单文件、default export 一个 AgentDefinition,由 bootstrap
 * runner 经 jiti 加载),但**刻意保留 `.pi/` 资源发现**用于测试:
 *  - `noTools: "builtin"` 去掉内置工具噪音 → 工具列表里任何**非** `agent_selfcheck`
 *    的工具就一定来自 `.pi/extensions/*`(如 `pi_probe_ping`),一眼可判加载是否成功。
 *  - **不覆盖 `skills`**(不像 hello-agent 那样清空)→ 保留默认发现,`.pi/skills` 可被加载。
 *  - 不设 `allowExtensions` / 不设 `noTools:"all"` → 保留 `.pi/extensions`、`.pi/agents` 发现。
 *
 * 配套探针资源放在被测工作目录的 `.pi/` 下(本仓库为仓库根 `.pi/`):
 *  - `.pi/extensions/pi-probe.ts` → 注册工具 `pi_probe_ping` + 命令 `/pi-probe` + 启动通知
 *  - `.pi/agents/pi-probe-subagent.md` → 测试子代理
 *  - `.pi/skills/pi-probe/SKILL.md` → 测试技能
 *
 * ⚠️ 前提:项目级 `.pi/` 受 **project trust** 门控。经 pi-web server 启动时,
 * 当前 trust 未打通(见 `docs/pi-trust-loading-design.md` 的 P1/P2/P3),预期
 * `.pi/` **加载不到**;此夹具同时是「修复前复现 / 修复后验证」的回归夹具。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const selfcheck = defineTool({
  name: "agent_selfcheck",
  label: "Self Check",
  description:
    "返回固定标记,确认 pi-probe-agent 本体在运行(与 .pi 是否加载无关)。",
  parameters: Type.Object({}),
  async execute() {
    return {
      content: [{ type: "text", text: "pi-probe-agent OK(custom 工具可达)" }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的默认 provider/model。
  systemPrompt: [
    "你是 pi-probe-agent,唯一职责是报告当前可用的工具与子代理。",
    "首轮请列出你能调用的每一个工具(仅名称)和每一个可派发的子代理。",
    "若存在名为 `pi_probe_ping` 的工具 → 说明项目级 .pi/extensions 已加载,请明确指出。",
    "若存在名为 `pi-probe-subagent` 的子代理 → 说明项目级 .pi/agents 已加载,请明确指出。",
    "不要执行其它任何工作。",
  ].join("\n"),
  customTools: [selfcheck],
  // 去内置工具噪音;保留 custom + `.pi/extensions/*` 工具。不影响 .pi 的 agents/skills 发现。
  noTools: "builtin",
  // 注意:此处**故意不设置** `skills` 覆盖与 `allowExtensions`,以保留 `.pi/` 默认全量发现。
});
