// Real-subprocess fixture (spec: source-settings-and-slots, Task 3.1): shape-(b)
// factory that captures the runner-injected `ctx.settings` and exposes it via an
// agent-declared-route (`get-settings`), so the integration test can read the
// value back over the non-LLM agent-routes RPC channel — the same technique as
// `attachment-profile-e2e-agent`. `pi-web.json` next to this file declares
// `settings.scope:"source"`, so the test seeds
// `<agentDir>/sources/<sourceKey("settings-assembly-source-e2e-agent")>/settings.json`
// before spawn and asserts the route echoes that value back through `ctx.settings`.
interface Ctx {
  cwd: string;
  agentDir?: string;
  env: Record<string, string | undefined>;
  settings: Readonly<Record<string, unknown>>;
}

export default (ctx: Ctx) => ({
  systemPrompt: "settings-assembly-source-e2e-agent (real-subprocess fixture)",
  routes: [
    {
      name: "get-settings",
      methods: ["GET" as const],
      handler: () => ({ settings: ctx.settings }),
    },
  ],
});
