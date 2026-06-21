/**
 * contrib-slash — webext-contrib-agent 的「slash 贡献走 pi 原生 extension」原型。
 *
 * 对照 `.pi/web/web.config.tsx` 里 `contributions.slash`(走 pi-web 专属 ui-rpc,真实
 * agent 无 handler、仅 stub 应答):本文件用 **pi 原生 `registerCommand`** 注册同样的
 * `/deploy` `/rollback`。它们经真实 agent 的 `get_commands` RPC → `GET /sessions/:id/commands`
 * 以 `source:"extension"` 流到浏览器,**不需要 stub**,且 pi CLI 同样可用(CLI/web 对等)。
 *
 * 加载前提(均已满足,见 docs/pi-trust-loading-design.md):
 *  - 项目 trusted:仓库内 `.pi/`(含 examples/*)经 pi-handler 默认信任,开箱加载。
 *  - 面板可见:扩展命令默认隐藏,需 NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST=deploy,rollback
 *    (或 =all)才在前端 slash 面板显形;服务端 /commands 端点不受此前端 policy 影响。
 *
 * API 对齐 SDK 0.79.6(参照 examples/pi-probe-agent/.pi/extensions/pi-probe.ts)。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("deploy", {
    description: "Deploy the app(原生 extension 贡献,对照 ui-rpc slash)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("✅ /deploy(原生 registerCommand)已执行", "info");
    },
  });

  pi.registerCommand("rollback", {
    description: "Roll back(原生 extension 贡献,对照 ui-rpc slash)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("✅ /rollback(原生 registerCommand)已执行", "info");
    },
  });

  // 会话开始弹一条通知,肉眼确认本原生扩展已加载(同 pi-probe 习惯)。
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("✅ .pi/extensions/contrib-slash 已加载(原生 slash:/deploy /rollback)", "info");
  });
}
