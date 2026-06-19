/**
 * pi-probe — 项目级扩展加载探针(本示例自带,位于 `examples/pi-probe-agent/.pi/extensions/`)。
 *
 * 当以本目录(`examples/pi-probe-agent`)为工作目录(cwd)运行、且项目被 trusted 时,
 * SDK 会发现并加载本扩展,从而:
 *   - 注册模型可调用的工具 `pi_probe_ping`;
 *   - 注册斜杠命令 `/pi-probe`(在 `get_commands` 里以 `source:"extension"` 出现);
 *   - 会话开始时弹一条通知,肉眼可见加载成功。
 *
 * 若这些都没出现 → `.pi/extensions` 未被加载,多半是 project trust 未放行
 * (经 pi-web server:建会话传 `trust:true`,或预置 `~/.pi/agent` 信任库;
 *  经 runner:`PI_WEB_TRUST_PROJECT=1` 或 `--trusted`)。详见仓库根 `docs/pi-trust-loading-design.md`。
 *
 * API 对齐当前 SDK(0.79.6)扩展写法:registerTool 用 `async execute(...)`;
 * `Type` 取自 `typebox`(已验证可在任意 cwd 的 `.pi/extensions` 中解析)。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "pi_probe_ping",
    label: "Pi Probe Ping",
    description:
      "证明 <cwd>/.pi/extensions 已加载的探针工具,返回固定标记字符串。",
    parameters: Type.Object({
      note: Type.Optional(Type.String({ description: "可选备注,会被回显" })),
    }),
    async execute(_toolCallId, params) {
      const note =
        typeof params.note === "string" && params.note.length > 0
          ? ` (note: ${params.note})`
          : "";
      return {
        content: [
          { type: "text", text: `✅ pi_probe_ping: .pi/extensions 已加载${note}` },
        ],
        details: undefined,
      };
    },
  });

  pi.registerCommand("pi-probe", {
    description: "显示项目级 .pi/extensions 探针处于激活状态",
    handler: async (_args, ctx) => {
      ctx.ui.notify("✅ /pi-probe 命令可用 → .pi/extensions 已加载", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("✅ .pi/extensions/pi-probe 已加载", "info");
  });
}
