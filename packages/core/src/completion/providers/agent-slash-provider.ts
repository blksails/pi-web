/**
 * agent-slash-provider — 通用命令补全 provider(spec agent-slash-completion)。
 *
 * 触发符 `/`、行首提取(`lineStart`)。候选来自**会话 agent 装配期声明**的静态
 * slash 命令(`PiSession.getSlashCompletions()`,经 `slash_completions` 帧缓存),按
 * 命令名前缀过滤。选中在前端**只填入** `insertText`(不执行);补词后走正常消息流交
 * 给 LLM。
 *
 * per-agent gating 自动成立:未声明候选的会话 `getSlashCompletions()` 为空 → 返回空。
 */
import type {
  CompletionItem,
  SlashCompletionDecl,
} from "@blksails/pi-web-protocol";
import type { CompletionProvider } from "../types.js";

export const AGENT_SLASH_PROVIDER_ID = "agent-slash";
const AGENT_SLASH_KIND = "agent-slash";

/** 会话侧只读能力:供 provider 取该会话声明的 slash 候选。 */
export interface SlashCompletionSource {
  getSlashCompletions(): readonly SlashCompletionDecl[];
}

/**
 * 构造 agent-slash 补全 provider。
 *
 * @param getSession 按 sessionId 取会话的 slash 候选来源(通常 `(id) => store.get(id)`)。
 */
export function createAgentSlashProvider(
  getSession: (sessionId: string) => SlashCompletionSource | undefined,
): CompletionProvider {
  return {
    id: AGENT_SLASH_PROVIDER_ID,
    trigger: "/",
    extract: "lineStart",
    kind: AGENT_SLASH_KIND,

    async complete({ query, ctx }): Promise<readonly CompletionItem[]> {
      const decls = getSession(ctx.sessionId)?.getSlashCompletions() ?? [];
      const q = query.toLowerCase();
      return decls
        .filter((d) => d.name.toLowerCase().startsWith(q))
        .map((d) => {
          const item: CompletionItem = {
            providerId: AGENT_SLASH_PROVIDER_ID,
            kind: AGENT_SLASH_KIND,
            id: d.name,
            label: `/${d.name}`,
            insertText: d.insertText ?? `/${d.name} `,
          };
          if (d.description !== undefined) item.detail = d.description;
          return item;
        });
    },
  };
}
