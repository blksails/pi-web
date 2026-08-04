// Real-subprocess fixture (spec: source-settings-and-slots, Task 3.1, Req 4.5):
// regression fixture — no `pi-web.json`/no `settings` declaration at all (the
// "existing agent, zero behavior change" case). Same `get-settings` route
// technique as the sibling fixtures; the test asserts `ctx.settings` resolves
// to `{}` (empty object) here.
interface Ctx {
  cwd: string;
  agentDir?: string;
  env: Record<string, string | undefined>;
  settings: Readonly<Record<string, unknown>>;
}

export default (ctx: Ctx) => ({
  systemPrompt: "settings-assembly-none-e2e-agent (real-subprocess fixture)",
  routes: [
    {
      name: "get-settings",
      methods: ["GET" as const],
      handler: () => ({ settings: ctx.settings }),
    },
  ],
});
