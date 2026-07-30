// Real-subprocess fixture (spec: source-settings-and-slots, Task 3.1): same
// technique as the sibling `settings-assembly-source-e2e-agent` fixture, but
// `pi-web.json` declares `settings.scope:"project"` — exercises the
// `<cwd>/.pi/source-settings/<sourceKey>.json` codepath and its project-trust
// gate (untrusted project → ctx.settings stays `{}` even if the file exists).
interface Ctx {
  cwd: string;
  agentDir?: string;
  env: Record<string, string | undefined>;
  settings: Readonly<Record<string, unknown>>;
}

export default (ctx: Ctx) => ({
  systemPrompt: "settings-assembly-project-e2e-agent (real-subprocess fixture)",
  routes: [
    {
      name: "get-settings",
      methods: ["GET" as const],
      handler: () => ({ settings: ctx.settings }),
    },
  ],
});
