/**
 * contributions-controller — Tier3 贡献点宿主控制器(任务 5.3 / Req 4.2, 4.3)。
 *
 * 把扩展声明的贡献点(slash/mention/autocomplete/inlineComplete/keybindings)与注入的
 * UiRpcClient 绑定,暴露宿主可直接调用的方法。控制器只编排:调用扩展 provider(其内部
 * 经 rpc 回 agent),返回候选/结果。错误被收敛为安全空结果,不抛(Req 4.5)。
 */
import type { WebExtension } from "@blksails/web-kit";
import type { UiRpcClient } from "@blksails/web-kit";
import type {
  SlashCommandItem,
  MentionItem,
  CompletionItem,
  Keybinding,
} from "@blksails/web-kit";

export interface ContributionsController {
  readonly hasSlash: boolean;
  readonly hasMention: boolean;
  readonly hasAutocomplete: boolean;
  readonly hasInlineComplete: boolean;
  readonly mentionTrigger: string;
  readonly keybindings: readonly Keybinding[];
  listSlash(query: string): Promise<readonly SlashCommandItem[]>;
  executeSlash(id: string): Promise<void>;
  queryMentions(q: string): Promise<readonly MentionItem[]>;
  autocomplete(ctx: string): Promise<readonly CompletionItem[]>;
  inlineComplete(ctx: string): Promise<string | undefined>;
}

export function createContributionsController(
  ext: WebExtension | undefined,
  rpc: UiRpcClient,
): ContributionsController {
  const c = ext?.contributions;
  return {
    hasSlash: c?.slash !== undefined,
    hasMention: c?.mention !== undefined,
    hasAutocomplete: c?.autocomplete !== undefined,
    hasInlineComplete: c?.inlineComplete !== undefined,
    mentionTrigger: c?.mention?.trigger ?? "@",
    keybindings: c?.keybindings ?? [],
    async listSlash(query): Promise<readonly SlashCommandItem[]> {
      if (c?.slash === undefined) return [];
      try {
        return await c.slash.list(query, rpc);
      } catch {
        return [];
      }
    },
    async executeSlash(id): Promise<void> {
      try {
        await c?.slash?.execute?.(id, rpc);
      } catch {
        // 收敛错误,不抛(Req 4.5)
      }
    },
    async queryMentions(q): Promise<readonly MentionItem[]> {
      if (c?.mention === undefined) return [];
      try {
        return await c.mention.query(q, rpc);
      } catch {
        return [];
      }
    },
    async autocomplete(ctx): Promise<readonly CompletionItem[]> {
      if (c?.autocomplete === undefined) return [];
      try {
        return await c.autocomplete.complete(ctx, rpc);
      } catch {
        return [];
      }
    },
    async inlineComplete(ctx): Promise<string | undefined> {
      if (c?.inlineComplete === undefined) return undefined;
      try {
        return await c.inlineComplete.complete(ctx, rpc);
      } catch {
        return undefined;
      }
    },
  };
}
