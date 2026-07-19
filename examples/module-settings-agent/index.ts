/**
 * module-settings-agent — 面⑦ per-source 设置面板本地验收 fixture(spec:
 * source-settings-and-slots,任务 5.1;Requirements 5.1, 5.4, 5.5, 13.3)。
 *
 * 覆盖 M1 全链闭环:
 *  - `pi-web.json#settings`(title/icon/scope/widgets)→ GET/PUT `/api/config/source/:sourceKey`
 *    动态长出面板(任务 2.2/4.1)。
 *  - `settings/schema.json` 覆盖普通 string(`apiBase`)、secret 三态(`apiToken`)、
 *    声明 widget 的字段(`defaultEntity`,渲染器由 per-source scoped registry 命中,任务
 *    4.2)、liveReload 标记字段(`notifyEmail`,仅声明,M3 才消费,Req 7.3)。
 *  - 本工厂(shape-(b),`(ctx) => AgentDefinition`)消费 runner 装配期注入的
 *    `ctx.settings`(任务 3.1),把 `apiBase`/`defaultEntity` 体现进 `systemPrompt`,并经
 *    `get-settings` route 原样回吐,供非 LLM 的 agent-declared-routes RPC 通道断言。
 *  - `entities` route 是 `defaultEntity` widget 的动态选项数据源——本模块自己供数,
 *    证明面⑤(动态控件)与面⑥(声明式 routes)互为供给,不依赖第三方 webext。
 *
 * NOTE: `model` 故意省略 → 继承 ~/.pi/agent/settings.json 默认(与 hello-agent 同姿态)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import type { AgentContext, AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { entitiesRoute } from "./routes/entities.js";

function buildSystemPrompt(settings: Readonly<Record<string, unknown>>): string {
  const apiBase = typeof settings["apiBase"] === "string" ? settings["apiBase"] : undefined;
  const defaultEntity =
    typeof settings["defaultEntity"] === "string" ? settings["defaultEntity"] : undefined;
  const lines = [
    "You are module-settings-agent, a pi-web example showcasing per-source settings (面⑦).",
    "Keep chat replies concise.",
  ];
  if (apiBase !== undefined) lines.push(`Configured apiBase: ${apiBase}`);
  if (defaultEntity !== undefined) lines.push(`Configured defaultEntity: ${defaultEntity}`);
  return lines.join("\n");
}

export default (ctx: AgentContext) => {
  // 装配期消费:runner 已把该 source 落盘的 per-source settings 值解析进 ctx.settings
  // (scope:"source" 声明,故与 cwd 无关,per-source×per-user 稳定)——本行是「消费」的唯一
  // 证据点,systemPrompt 与 get-settings route 均由此派生,不重新读盘。
  const settings = ctx.settings;

  const getSettingsRoute: AgentRouteDecl = {
    name: "get-settings",
    description: "回吐 runner 装配期注入的 ctx.settings(非 LLM RPC 通道,e2e 断言用)",
    handler: () => ({ settings }),
  };

  return defineAgent({
    systemPrompt: buildSystemPrompt(settings),
    routes: [getSettingsRoute, entitiesRoute],
  });
};
