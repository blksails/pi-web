/** webext-contrib-agent UI 扩展:Tier 3 slash + @mention 贡献点(经 ui-rpc 回 agent)。 */
import { defineWebExtension, type UiRpcClient } from "@blksails/pi-web-kit";

export default defineWebExtension({
  manifestId: "webext-contrib",
  capabilities: ["contributions"],
  contributions: {
    slash: {
      async list(query: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "slash", action: "list", payload: { query } });
        const result = (res.ok ? res.result : []) as Array<{ id: string; title: string; description?: string }>;
        return result;
      },
      async execute(id: string, rpc: UiRpcClient) {
        await rpc.request({ point: "slash", action: "execute", payload: { id } });
      },
    },
    mention: {
      trigger: "@",
      async query(q: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "mention", action: "resolve", payload: { q } });
        return (res.ok ? res.result : []) as Array<{ id: string; label: string }>;
      },
    },
    autocomplete: {
      async complete(ctx: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "autocomplete", action: "complete", payload: { ctx } });
        return (res.ok ? res.result : []) as Array<{ label: string; insertText: string }>;
      },
    },
    inlineComplete: {
      async complete(ctx: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "inlineComplete", action: "complete", payload: { ctx } });
        return (res.ok ? res.result : undefined) as string | undefined;
      },
    },
    keybindings: [{ combo: "Mod+k", commandId: "deploy" }],
  },
});
