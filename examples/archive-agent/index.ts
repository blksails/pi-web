/**
 * archive-agent — 演示 zip / unzip / unrar 三个归档工具。
 *
 * 运算核在 `@blksails/pi-web-tool-kit/runtime`（archive 模块）；
 * 本 agent 仅用 defineTool 暴露给模型。
 *
 * model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { archiveTools } from "./tools/archive-tools.js";

export default defineAgent({
  systemPrompt: [
    "你是 archive-agent，负责在会话工作目录内创建与解压归档。",
    "可用工具：",
    "- zip: 将路径打包为 .zip",
    "- unzip: 解压 .zip（自动拒绝路径逃逸 entry）",
    "- unrar: 解压 .rar（依赖本机 unrar/unar/bsdtar；缺失时返回明确错误码）",
    "所有路径相对会话 cwd；禁止尝试访问工作区外路径。",
  ].join("\n"),
  customTools: [...archiveTools],
  // 自包含：不要系统 builtin 文件工具干扰演示
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
