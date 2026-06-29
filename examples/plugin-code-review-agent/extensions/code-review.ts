import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "code_review",
    label: "Code Review",
    description: "Review a code snippet and return structured findings.",
    parameters: Type.Object({
      code: Type.String({ description: "The code to review." }),
      language: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const findings = reviewCode(params.code, params.language);
      return {
        content: [{ type: "text", text: `${findings.length} issues found.` }],
        details: { findings, language: params.language },
      };
    },
  });

  pi.registerCommand("review", {
    description: "Lint the given code locally and report findings via ctx.ui",
    // `/review [code]`:本地启发式检视,经 ctx.ui 即时反馈(不触发 LLM turn —— fire-and-forget
    // 命令不订阅 turn 输出流,故命令自身的可见反馈必须走 ctx.ui ambient,不能依赖一轮对话)。
    // 富卡(code_review 工具渲染)请走自然语言提问让 agent 调用工具(正常 prompt 流渲染)。
    handler: async (args, ctx) => {
      const argStr = typeof args === "string" ? args.trim() : "";
      const code = argStr.length > 0 ? argStr : "var x = 1; if (x == 1) {}";
      const findings = reviewCode(code);
      ctx.ui.notify(
        findings.length > 0
          ? `代码检视:发现 ${findings.length} 个问题 — ${findings.join("；")}`
          : "代码检视:未发现问题 ✅",
        findings.length > 0 ? "warning" : "info",
      );
    },
  });
}

function reviewCode(code: string, _lang?: string): string[] {
  const findings: string[] = [];
  if (/\bvar\b/.test(code)) findings.push("使用了 var,建议 let/const");
  if (/==[^=]/.test(code)) findings.push("使用了 ==,建议 ===");
  return findings;
}
